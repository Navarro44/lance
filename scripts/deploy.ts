/**
 * deploy.ts — Deploy and configure the on-chain guardrail stack.
 *
 * Deploys (Base Sepolia only):
 *   1. A new Safe (1-of-1, owner = signer key)
 *   2. A Zodiac Roles Modifier (owner/avatar/target = Safe address)
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
import { baseSepolia } from "viem/chains";

import { CHAIN_ID, USDC_ADDRESS } from "../src/chain/constants.js";
import {
  encodeAssignRoles,
  encodeSetDefaultRole,
  encodeScopeTarget,
  encodeScopeTransfer,
  getRolesBytecode,
} from "../src/chain/roles.js";

// ─── config ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env["RPC_URL"] ?? "https://sepolia.base.org";
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
  console.log(" Lance — Phase 2 deployment (Base Sepolia)");
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
    chain: baseSepolia,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    account: signerAccount,
    chain: baseSepolia,
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

  // ── step 2: deploy Roles Modifier ───────────────────────────────────────────
  console.log("\nStep 2: Deploying Roles Modifier...");

  // Check if we already have a deployment saved (idempotent re-runs)
  let rolesAddress: Address;
  const rolesBytecode = getRolesBytecode();

  // ABI-encode constructor args: (address _owner, address _avatar, address _target)
  const { encodeAbiParameters, parseAbiParameters } = await import("viem");
  const constructorArgs = encodeAbiParameters(parseAbiParameters("address, address, address"), [
    predictedSafeAddress,
    predictedSafeAddress,
    predictedSafeAddress,
  ]);
  const deployData = (rolesBytecode + constructorArgs.slice(2)) as Hex;

  const rolesTxHash = await walletClient.sendTransaction({ data: deployData });
  await waitForTx(publicClient, rolesTxHash, "Roles Modifier deploy");

  const rolesReceipt = await publicClient.getTransactionReceipt({ hash: rolesTxHash });
  if (!rolesReceipt.contractAddress)
    throw new Error("Roles Modifier deploy: no contractAddress in receipt");
  rolesAddress = rolesReceipt.contractAddress as Address;
  console.log("  Roles Modifier address:", rolesAddress);

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
  const enableModuleTx = await safe.createEnableModuleTx(rolesAddress);
  const signedEnableTx = await safe.signTransaction(enableModuleTx);
  const enableResult = await safe.executeTransaction(signedEnableTx);
  await waitForTx(publicClient, enableResult.hash as Hash, "enableModule");

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
    network: "baseSepolia",
    chainId: CHAIN_ID,
    safeAddress,
    rolesModifierAddress: rolesAddress,
    signerAddress: signerAccount.address,
    executorAddress: executorAccount.address,
    whitelist: WHITELIST,
    perTxCapBaseUnits: PER_TX_CAP_BASE_UNITS.toString(),
    usdcAddress: USDC_ADDRESS,
    deployedAt: new Date().toISOString(),
    rolesTxHash,
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
