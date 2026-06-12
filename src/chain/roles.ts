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
import { encodeFunctionData, pad, toHex, type Address, type Hex } from "viem";
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
 *   Matches(AbiEncoded)
 *     Or(Static)              ← param 0: to must be one of whitelist
 *       EqualTo(SUPPLIER_A)
 *       EqualTo(SUPPLIER_B)
 *       ...
 *     LessThan(cap+1)(Static) ← param 1: amount < cap+1 ≡ amount <= cap
 *
 * The cap+1 trick: Roles v2 has LessThan but not LessThanOrEqual. Adding 1 to
 * the exclusive upper bound achieves the same semantic as a cap check.
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
    paramType: ParameterType.AbiEncoded,
    operator: Operator.Matches,
    children: [destinationCondition, amountCondition],
  };

  return flattenCondition(root);
}

// ─── Roles Modifier bytecode (from zodiac-roles-sdk typechain) ─────────────────

/**
 * Lazily loads the Roles__factory bytecode from zodiac-roles-sdk's typechain.
 * Kept lazy so the import only happens in the chain layer (never in tests of
 * pure src/types, src/policy, src/mandate).
 */
export function getRolesBytecode(): Hex {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Roles__factory } = require("zodiac-roles-sdk/typechain") as {
    Roles__factory: { bytecode: string };
  };
  return Roles__factory.bytecode as Hex;
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
  const conditions = rawConditions.map((c) => ({
    ...c,
    compValue: (c.compValue ?? "0x00") as Hex,
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
