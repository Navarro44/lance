/**
 * deploy.ts — Deploy and configure the on-chain guardrail stack.
 *
 * Deploys (Ethereum Sepolia testnet only):
 *   1. A new Safe (1-of-1, owner = signer key)
 *   2. A Zodiac Roles Modifier — minimal EIP-1167 proxy to the canonical
 *      mastercopy (owner/avatar/target = Safe address), via ModuleProxyFactory
 *   3. Enables the Roles Modifier as a Safe module
 *   4. Scopes the EXECUTOR role:
 *      - Assigns role to executor EOA
 *      - Scopes USDC: only transfer() is callable (approve is implicitly blocked)
 *      - Conditions on transfer: destination ∈ whitelist AND amount <= perTxCap
 *
 * Writes deployment.json with all deployed addresses for the adapter and tests.
 *
 * Usage:  tsx scripts/deploy.ts
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Safe from "@safe-global/protocol-kit";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { CHAIN, CHAIN_ID, DEFAULT_RPC_URL, USDC_ADDRESS } from "../src/chain/constants.js";
import {
  encodeAssignRoles,
  encodeRolesProxyDeployment,
  encodeSetDefaultRole,
  encodeScopeTarget,
  encodeScopeTransfer,
  resolveRolesMastercopy,
  verifyRolesMastercopy,
} from "../src/chain/roles.js";

// ─── config ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env["RPC_URL"] ?? DEFAULT_RPC_URL;
const SIGNER_PRIVATE_KEY = process.env["SIGNER_PRIVATE_KEY"] as Hex | undefined;
const EXECUTOR_PRIVATE_KEY = process.env["EXECUTOR_PRIVATE_KEY"] as Hex | undefined;

/** Whitelisted payee addresses (test addresses — no real funds). */
const WHITELIST: Address[] = (process.env["WHITELIST"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Address => /^0x[0-9a-fA-F]{40}$/.test(s));

/**
 * Per-tx cap in USDC base units (6 decimals).
 * Default: 1 USDC = 1_000_000 base units.
 */
const PER_TX_CAP_BASE_UNITS = BigInt(process.env["PER_TX_CAP_BASE_UNITS"] ?? "1000000");

/**
 * Optional: reuse an already-deployed Roles proxy instead of deploying a new one.
 * Set this to resume a deployment that was interrupted (e.g. a transient RPC
 * failure) without paying for a second proxy or leaving a stale, unconfigured
 * module enabled on the Safe.
 */
const EXISTING_ROLES_MODIFIER = process.env["ROLES_MODIFIER_ADDRESS"] as Address | undefined;

// ─── validation ───────────────────────────────────────────────────────────────

function requireEnv(): { signerKey: Hex; executorKey: Hex } {
  if (!SIGNER_PRIVATE_KEY) throw new Error("SIGNER_PRIVATE_KEY not set in .env");
  if (!EXECUTOR_PRIVATE_KEY) throw new Error("EXECUTOR_PRIVATE_KEY not set in .env");
  if (WHITELIST.length === 0)
    throw new Error(
      "WHITELIST not set (comma-separated addresses). e.g. WHITELIST=0xabc...,0xdef...",
    );
  return { signerKey: SIGNER_PRIVATE_KEY, executorKey: EXECUTOR_PRIVATE_KEY };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function waitForTx(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
  label: string,
): Promise<void> {
  process.stdout.write(`  waiting for ${label} (${hash.slice(0, 10)}...)...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} REVERTED`);
  console.log(` ✓ block ${receipt.blockNumber}`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(` Lance — Phase 2 deployment (${CHAIN.name}, chainId ${CHAIN_ID})`);
  console.log("═══════════════════════════════════════════════════════════\n");

  const { signerKey, executorKey } = requireEnv();

  const signerAccount = privateKeyToAccount(signerKey);
  const executorAccount = privateKeyToAccount(executorKey);

  console.log("Signer address  :", signerAccount.address);
  console.log("Executor address:", executorAccount.address);
  console.log("Whitelist       :", WHITELIST);
  console.log("Per-tx cap      :", PER_TX_CAP_BASE_UNITS.toString(), "base units");
  console.log("RPC             :", RPC_URL, "\n");

  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    account: signerAccount,
    chain: CHAIN,
    transport: http(RPC_URL),
  });

  // ── step 1: predict Safe address ────────────────────────────────────────────
  console.log("Step 1: Predicting Safe address...");
  const predictedSafeSdk = await Safe.init({
    provider: RPC_URL,
    signer: signerKey,
    predictedSafe: {
      safeAccountConfig: {
        owners: [signerAccount.address],
        threshold: 1,
      },
    },
  });
  const predictedSafeAddress = (await predictedSafeSdk.getAddress()) as Address;
  console.log("  Predicted Safe address:", predictedSafeAddress);

  const safeAlreadyDeployed = await publicClient
    .getCode({ address: predictedSafeAddress })
    .then((code) => code != null && code !== "0x");

  // ── step 2a: resolve + verify the Roles mastercopy ──────────────────────────
  // The Roles Modifier is deployed as a minimal proxy to a canonical mastercopy,
  // NOT from bytecode (the shipped artifact is 25,286 bytes — over the EIP-170
  // 24,576 limit). The mastercopy address comes from the vendor registry and is
  // verified on-chain before anything is deployed against it. See docs/adr/0002.
  console.log("\nStep 2a: Resolving Roles mastercopy from registry...");
  const { address: mastercopyAddress, range } = await resolveRolesMastercopy();
  console.log("  version range :", range);
  console.log("  mastercopy    :", mastercopyAddress, "(registry-resolved, not hardcoded)");

  console.log(`\nStep 2b: Verifying mastercopy on-chain (${CHAIN.name})...`);
  const verification = await verifyRolesMastercopy(publicClient, mastercopyAddress, CHAIN.name);
  console.log("  code size     :", verification.codeSizeBytes, "bytes");
  console.log("  codehash      :", verification.codeHash);
  console.log("  ✓ all required Roles v2 selectors present");

  // ── step 2c: deploy the Roles proxy via the Module Proxy Factory ────────────
  // setUp(owner=Safe, avatar=Safe, target=Safe) runs atomically in the same tx.
  console.log("\nStep 2c: Deploying Roles proxy via ModuleProxyFactory...");
  let rolesAddress: Address;
  let rolesTxHash: Hash | null = null;
  let saltNonce: bigint | null = null;
  let factoryAddress: Address;

  if (EXISTING_ROLES_MODIFIER) {
    // Resuming: adopt the existing proxy instead of deploying another.
    const existingCode = await publicClient.getCode({ address: EXISTING_ROLES_MODIFIER });
    if (existingCode == null || existingCode === "0x") {
      throw new Error(
        `ROLES_MODIFIER_ADDRESS=${EXISTING_ROLES_MODIFIER} has no code on ${CHAIN.name}. Refusing to continue.`,
      );
    }
    rolesAddress = EXISTING_ROLES_MODIFIER;
    factoryAddress = (
      await encodeRolesProxyDeployment({
        mastercopy: mastercopyAddress,
        safe: predictedSafeAddress,
        saltNonce: 0n,
      })
    ).to;
    console.log(
      "  reusing existing proxy:",
      rolesAddress,
      `(${(existingCode.length - 2) / 2} bytes)`,
    );
  } else {
    saltNonce = BigInt(Date.now());
    const proxyDeployment = await encodeRolesProxyDeployment({
      mastercopy: mastercopyAddress,
      safe: predictedSafeAddress,
      saltNonce,
    });
    factoryAddress = proxyDeployment.to;
    console.log("  factory       :", proxyDeployment.to, "(CREATE2-derived)");
    console.log("  saltNonce     :", saltNonce.toString());
    console.log("  predicted     :", proxyDeployment.predictedAddress);

    rolesTxHash = await walletClient.sendTransaction({
      to: proxyDeployment.to,
      data: proxyDeployment.data,
    });
    await waitForTx(publicClient, rolesTxHash, "Roles proxy deploy");

    rolesAddress = proxyDeployment.predictedAddress;

    // The predicted address is only trustworthy if code actually landed there.
    const proxyCode = await publicClient.getCode({ address: rolesAddress });
    if (proxyCode == null || proxyCode === "0x") {
      throw new Error(
        `Roles proxy deploy: no code at predicted address ${rolesAddress}. Refusing to continue.`,
      );
    }
    console.log("  Roles Modifier address:", rolesAddress, `(${(proxyCode.length - 2) / 2} bytes)`);
  }

  // ── step 3: deploy Safe ──────────────────────────────────────────────────────
  console.log("\nStep 3: Deploying Safe...");
  if (safeAlreadyDeployed) {
    console.log("  Safe already deployed at", predictedSafeAddress, "(skipping)");
  } else {
    const safeDeployTx = await predictedSafeSdk.createSafeDeploymentTransaction();
    const safeDeployHash = await walletClient.sendTransaction({
      to: safeDeployTx.to as Address,
      data: safeDeployTx.data as Hex,
      value: BigInt(safeDeployTx.value),
    });
    await waitForTx(publicClient, safeDeployHash, "Safe deploy");
  }
  const safeAddress = predictedSafeAddress;
  console.log("  Safe address:", safeAddress);

  // ── step 4: connect Safe SDK to deployed address ─────────────────────────────
  const safe = await Safe.init({
    provider: RPC_URL,
    signer: signerKey,
    safeAddress,
  });

  // ── helper: execute a Safe transaction signed by the signer ─────────────────
  async function execSafeTx(to: Address, data: Hex, label: string): Promise<void> {
    const safeTx = await safe.createTransaction({
      transactions: [{ to, value: "0", data }],
    });
    const signedTx = await safe.signTransaction(safeTx);
    const result = await safe.executeTransaction(signedTx);
    await waitForTx(publicClient, result.hash as Hash, label);
  }

  // ── step 5: enable Roles Modifier as Safe module ─────────────────────────────
  console.log("\nStep 4: Enabling Roles Modifier as Safe module...");
  const alreadyEnabled = await safe.isModuleEnabled(rolesAddress);
  if (alreadyEnabled) {
    console.log("  module already enabled on Safe (skipping)");
  } else {
    const enableModuleTx = await safe.createEnableModuleTx(rolesAddress);
    const signedEnableTx = await safe.signTransaction(enableModuleTx);
    const enableResult = await safe.executeTransaction(signedEnableTx);
    await waitForTx(publicClient, enableResult.hash as Hash, "enableModule");
  }

  // ── step 6: configure roles on the Roles Modifier ────────────────────────────
  console.log("\nStep 5: Configuring roles on Roles Modifier (4 Safe txs)...");

  // 5a. assignRoles(executor, [EXECUTOR_ROLE_KEY], [true])
  await execSafeTx(rolesAddress, encodeAssignRoles(executorAccount.address), "assignRoles");

  // 5b. setDefaultRole(executor, EXECUTOR_ROLE_KEY)
  await execSafeTx(rolesAddress, encodeSetDefaultRole(executorAccount.address), "setDefaultRole");

  // 5c. scopeTarget(EXECUTOR_ROLE_KEY, USDC_ADDRESS)
  //     → marks USDC as scoped: only explicitly allowed functions can be called
  //     → approve() is implicitly blocked because it's never allowFunction'd
  await execSafeTx(rolesAddress, encodeScopeTarget(), "scopeTarget(USDC)");

  // 5d. scopeFunction(EXECUTOR_ROLE_KEY, USDC, transfer, conditions, None)
  //     → conditions: destination ∈ whitelist AND amount <= perTxCap
  await execSafeTx(
    rolesAddress,
    encodeScopeTransfer(WHITELIST, PER_TX_CAP_BASE_UNITS),
    "scopeFunction(transfer,conditions)",
  );

  // ── step 7: write deployment.json ─────────────────────────────────────────────
  const deployment = {
    network: CHAIN.name,
    chainId: CHAIN_ID,
    safeAddress,
    rolesModifierAddress: rolesAddress,
    rolesMastercopy: {
      address: verification.address,
      versionRange: range,
      codeHash: verification.codeHash,
      codeSizeBytes: verification.codeSizeBytes,
    },
    moduleProxyFactory: factoryAddress,
    proxySaltNonce: saltNonce == null ? "(reused existing proxy)" : saltNonce.toString(),
    signerAddress: signerAccount.address,
    executorAddress: executorAccount.address,
    whitelist: WHITELIST,
    perTxCapBaseUnits: PER_TX_CAP_BASE_UNITS.toString(),
    usdcAddress: USDC_ADDRESS,
    deployedAt: new Date().toISOString(),
    rolesTxHash: rolesTxHash ?? "(reused existing proxy)",
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(__dirname, "..", "deployment.json");
  writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" Deployment complete");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(JSON.stringify(deployment, null, 2));
  console.log("\n deployment.json written to:", outPath);
}

main().catch((err) => {
  console.error("\n[deploy] ERROR:", err);
  process.exit(1);
});
