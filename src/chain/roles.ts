/**
 * Zodiac Roles Modifier configuration helpers.
 *
 * Destination-locking is the core safety property: the executor cannot call
 * transfer() to any address not in the whitelist. This module builds the
 * on-chain condition tree that enforces that invariant.
 *
 * Only src/chain/ may import zodiac-roles-sdk. src/types, src/policy, and
 * src/mandate must never import chain-layer libraries.
 */
import {
  encodeFunctionData,
  keccak256,
  pad,
  toFunctionSelector,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import {
  encodeKey,
  ExecutionOptions,
  flattenCondition,
  Operator,
  ParameterType,
  rolesAbi,
  type Condition,
} from "zodiac-roles-sdk";

import { TRANSFER_SELECTOR, USDC_ADDRESS } from "./constants.js";

// ─── role key ─────────────────────────────────────────────────────────────────

/** ASCII bytes32 encoding of "EXECUTOR" — the single role the executor EOA holds. */
export const EXECUTOR_ROLE_KEY: Hex = encodeKey("EXECUTOR");

// ─── condition builders ───────────────────────────────────────────────────────

/**
 * Pads an address to 32 bytes for use as a compValue in an EqualTo condition.
 * EVM ABI encodes address as uint256 (left-padded with zeros).
 */
function padAddress(addr: Address): Hex {
  return pad(addr, { size: 32 }) as Hex;
}

/**
 * Pads a bigint to 32 bytes for use as a compValue in a LessThan condition.
 */
function padUint256(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

/**
 * Builds the condition tree for USDC transfer(address to, uint256 amount):
 *
 *   Matches(Calldata)
 *     Or(Static)              ← param 0: to must be one of whitelist
 *       EqualTo(SUPPLIER_A)
 *       EqualTo(SUPPLIER_B)
 *       ...
 *     LessThan(cap+1)(Static) ← param 1: amount < cap+1 ≡ amount <= cap
 *
 * The cap+1 trick: Roles v2 has LessThan but not LessThanOrEqual. Adding 1 to
 * the exclusive upper bound achieves the same semantic as a cap check.
 *
 * The root MUST be ParameterType.Calldata (5), not AbiEncoded (6). Calldata is
 * the root type for scoping a function's own arguments; AbiEncoded describes a
 * nested abi.encode() blob carried inside a parameter. The on-chain Integrity
 * library rejects an AbiEncoded root, so scopeFunction reverts.
 *
 * Returns a flat ConditionFlat[] ready for scopeFunction's conditions param.
 * Throws if whitelist is empty (would produce an unreachable Or condition).
 */
export function buildTransferConditions(
  whitelist: readonly Address[],
  perTxCapBaseUnits: bigint,
): ReturnType<typeof flattenCondition> {
  if (whitelist.length === 0) {
    throw new Error("buildTransferConditions: whitelist must not be empty");
  }

  const destinationChildren: Condition[] = whitelist.map((addr) => ({
    paramType: ParameterType.Static,
    operator: Operator.EqualTo,
    compValue: padAddress(addr),
  }));

  const destinationCondition: Condition =
    destinationChildren.length === 1
      ? destinationChildren[0]! // single address: use EqualTo directly — Or([X]) ≡ X
      : {
          paramType: ParameterType.Static,
          operator: Operator.Or,
          children: destinationChildren,
        };

  const amountCondition: Condition = {
    paramType: ParameterType.Static,
    operator: Operator.LessThan,
    compValue: padUint256(perTxCapBaseUnits + 1n),
  };

  const root: Condition = {
    paramType: ParameterType.Calldata,
    operator: Operator.Matches,
    children: [destinationCondition, amountCondition],
  };

  return flattenCondition(root);
}

// ─── Roles Modifier mastercopy + proxy deployment ─────────────────────────────

/**
 * The Roles Modifier is NOT deployed from bytecode. The Roles artifact shipped
 * in zodiac-roles-sdk compiles to 25,286 bytes of runtime code, which exceeds
 * the EIP-170 contract size limit of 24,576 bytes — it cannot be deployed on
 * any EIP-170 chain. See docs/adr/0002.
 *
 * Instead we follow the canonical Zodiac pattern: a minimal EIP-1167 proxy
 * pointing at a pre-deployed, audited mastercopy, created through the Zodiac
 * ModuleProxyFactory. The mastercopy address is resolved from the vendor
 * registry — never hardcoded — and verified on-chain before use.
 */

/** Semver range for the Roles mastercopy. v2 is the condition-tree ABI this code targets. */
export const ROLES_MASTERCOPY_VERSION_RANGE = "^2.0.0";

/**
 * Function selectors that MUST be present in the mastercopy's runtime code.
 * These are exactly the calls the guardrail depends on: role assignment,
 * target/function scoping (destination-locking), and scoped execution. If any
 * is missing, the address is not a Roles v2 implementation and we must not
 * deploy against it.
 */
const REQUIRED_ROLES_FUNCTIONS = [
  "scopeTarget",
  "scopeFunction",
  "assignRoles",
  "setDefaultRole",
  "execTransactionWithRole",
] as const;

/**
 * Resolves the canonical Roles mastercopy address from the @gnosis-guild/zodiac
 * registry. `sanityCheckZodiacModuleAddress` rejects both unknown addresses and
 * addresses the vendor has flagged as FAULTY (Roles 2.1.0 is flagged), so a
 * faulty mastercopy can never be selected here.
 *
 * Throws rather than returning a fallback: there is no safe default.
 */
export async function resolveRolesMastercopy(): Promise<{ address: Address; range: string }> {
  const { KnownContracts, getZodiacModuleAddress, sanityCheckZodiacModuleAddress } =
    await import("@gnosis-guild/zodiac");
  const address = getZodiacModuleAddress(
    KnownContracts.ROLES,
    ROLES_MASTERCOPY_VERSION_RANGE,
  ) as Address;
  // getZodiacModuleAddress already sanity-checks; assert again so the guarantee
  // is local and survives any change in the vendor's internals.
  sanityCheckZodiacModuleAddress(address);
  return { address, range: ROLES_MASTERCOPY_VERSION_RANGE };
}

/** Minimal client surface needed to verify a mastercopy. */
type CodeReader = {
  getCode: (args: { address: Address }) => Promise<Hex | undefined>;
};

export type MastercopyVerification = {
  address: Address;
  codeSizeBytes: number;
  codeHash: Hex;
};

/**
 * Verifies on-chain that `address` holds a real Roles v2 implementation on the
 * connected network. FAILS LOUDLY — never returns a partial result — because a
 * wrong or undeployed mastercopy would silently destroy destination-locking
 * while every off-chain test still passed.
 *
 * Checks: (1) code is present, (2) every selector the guardrail depends on is
 * present in that code. Returns the codehash so the deployment record pins
 * exactly what was deployed against.
 */
export async function verifyRolesMastercopy(
  client: CodeReader,
  address: Address,
  chainLabel: string,
): Promise<MastercopyVerification> {
  const code = await client.getCode({ address });
  if (code == null || code === "0x") {
    throw new Error(
      `Roles mastercopy NOT DEPLOYED at ${address} on ${chainLabel}. ` +
        `Refusing to deploy a proxy pointing at an address with no code.`,
    );
  }

  const missing: string[] = [];
  for (const name of REQUIRED_ROLES_FUNCTIONS) {
    const item = (rolesAbi as unknown as Abi).find((a) => a.type === "function" && a.name === name);
    if (!item) {
      missing.push(`${name} (absent from rolesAbi)`);
      continue;
    }
    const selector = toFunctionSelector(item as never).slice(2);
    if (!code.includes(selector)) missing.push(`${name} (0x${selector})`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Address ${address} on ${chainLabel} does not look like a Roles v2 mastercopy. ` +
        `Missing required function selectors: ${missing.join(", ")}. Refusing to deploy.`,
    );
  }

  return {
    address,
    codeSizeBytes: (code.length - 2) / 2,
    codeHash: keccak256(code),
  };
}

/**
 * setUp(bytes) params for a Roles instance: (owner, avatar, target).
 * All three are the Safe: the Safe owns the modifier (so only the Safe can
 * change scoping — the kill switch), and is both the avatar and the execution
 * target.
 */
function rolesSetupArgs(safe: Address) {
  return {
    types: ["address", "address", "address"],
    values: [safe, safe, safe],
  };
}

export type ProxyDeployment = {
  to: Address;
  data: Hex;
  predictedAddress: Address;
};

/**
 * Encodes the ModuleProxyFactory call that deploys the Roles proxy and runs
 * setUp in the same transaction, and predicts the resulting address.
 *
 * The factory address is derived by @gnosis-guild/zodiac-core (CREATE2 from the
 * ERC-2470 singleton factory) — it is not a hardcoded literal.
 */
export async function encodeRolesProxyDeployment(args: {
  mastercopy: Address;
  safe: Address;
  saltNonce: bigint;
}): Promise<ProxyDeployment> {
  const { encodeDeployProxy, predictProxyAddress } = await import("@gnosis-guild/zodiac-core");
  const setupArgs = rolesSetupArgs(args.safe);

  const tx = encodeDeployProxy({
    mastercopy: args.mastercopy,
    setupArgs,
    saltNonce: args.saltNonce,
  });
  const predictedAddress = predictProxyAddress({
    mastercopy: args.mastercopy,
    setupArgs,
    saltNonce: args.saltNonce,
  }) as Address;

  if (!tx.to || !tx.data) {
    throw new Error("encodeDeployProxy returned an incomplete transaction request");
  }
  return { to: tx.to as Address, data: tx.data as Hex, predictedAddress };
}

// ─── setup call encoders ──────────────────────────────────────────────────────

/** Encodes assignRoles(executor, [EXECUTOR_ROLE_KEY], [true]) calldata. */
export function encodeAssignRoles(executor: Address): Hex {
  return encodeFunctionData({
    abi: rolesAbi,
    functionName: "assignRoles",
    args: [executor, [EXECUTOR_ROLE_KEY], [true]],
  });
}

/** Encodes setDefaultRole(executor, EXECUTOR_ROLE_KEY) calldata. */
export function encodeSetDefaultRole(executor: Address): Hex {
  return encodeFunctionData({
    abi: rolesAbi,
    functionName: "setDefaultRole",
    args: [executor, EXECUTOR_ROLE_KEY],
  });
}

/** Encodes scopeTarget(EXECUTOR_ROLE_KEY, USDC_ADDRESS) calldata. */
export function encodeScopeTarget(): Hex {
  return encodeFunctionData({
    abi: rolesAbi,
    functionName: "scopeTarget",
    args: [EXECUTOR_ROLE_KEY, USDC_ADDRESS],
  });
}

/**
 * Encodes scopeFunction for USDC transfer with destination + amount conditions.
 * This is the central on-chain destination-locking call.
 */
export function encodeScopeTransfer(whitelist: readonly Address[], perTxCapBaseUnits: bigint): Hex {
  const rawConditions = buildTransferConditions(whitelist, perTxCapBaseUnits);
  // flattenCondition returns compValue as string; the ABI requires 0x-prefixed Hex.
  // Nodes whose operator takes no operand (Matches, Or, Pass) MUST carry a
  // ZERO-LENGTH compValue. "0x00" is one byte, not empty, and the on-chain
  // Integrity library rejects it with UnsuitableCompValue(index).
  const conditions = rawConditions.map((c) => ({
    ...c,
    compValue: (c.compValue ?? "0x") as Hex,
  }));
  return encodeFunctionData({
    abi: rolesAbi,
    functionName: "scopeFunction",
    args: [EXECUTOR_ROLE_KEY, USDC_ADDRESS, TRANSFER_SELECTOR, conditions, ExecutionOptions.None],
  });
}

// ─── execution helper ─────────────────────────────────────────────────────────

/**
 * Encodes execTransactionWithRole calldata for the Roles Modifier.
 * The executor calls this on the Roles Modifier; it checks permissions and
 * forwards to the Safe via execTransactionFromModule.
 *
 * @param to       Destination of the inner call (e.g., USDC_ADDRESS)
 * @param data     Inner calldata (e.g., encoded transfer(...))
 * @param shouldRevert  If true, the whole tx reverts on permission failure
 */
export function encodeExecWithRole(to: Address, data: Hex, shouldRevert = true): Hex {
  return encodeFunctionData({
    abi: rolesAbi,
    functionName: "execTransactionWithRole",
    args: [
      to,
      0n, // no ETH value
      data,
      0, // operation: Call
      EXECUTOR_ROLE_KEY,
      shouldRevert,
    ],
  });
}

// ─── USDC transfer calldata builder ───────────────────────────────────────────

/** Encodes ERC-20 transfer(to, amount) calldata. */
export function encodeTransfer(to: Address, amount: bigint): Hex {
  return (TRANSFER_SELECTOR +
    pad(to, { size: 32 }).slice(2) +
    toHex(amount, { size: 32 }).slice(2)) as Hex;
}
