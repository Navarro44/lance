/**
 * live-payment.ts — Execute a single tiny USDC payment end-to-end on Base Sepolia.
 *
 * This script is the final acceptance test for Phase 2. It:
 *   1. Loads deployment.json (produced by `pnpm deploy`)
 *   2. Constructs a PaymentProposal for the first whitelisted address
 *   3. Runs through the policy engine to get a APPROVE decision
 *   4. Submits the live transaction via the chain adapter (shadow=false)
 *   5. Writes an audit record (via the NullAuditSeam stub for Phase 2)
 *   6. Prints the tx hash
 *
 * Amount: 1 USDC base unit (0.000001 USDC) — tiny to avoid wasting test tokens.
 *
 * Usage:  tsx scripts/live-payment.ts
 *
 * The executor account must have:
 *   - A small amount of Base Sepolia ETH for gas
 *   - The Safe must hold at least 1 base unit of test USDC
 *
 * TESTNET ONLY. Never use with real funds.
 */

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import type { Address, Hex } from "viem";

import { createChainAdapter } from "../src/chain/adapter.js";
import { createNullAuditSeam } from "../src/chain/audit-seam.js";
import { CHAIN_ID, USDC_ADDRESS } from "../src/chain/constants.js";
import { checkPolicy } from "../src/policy/index.js";
import { signMandate, verifyMandate } from "../src/mandate/index.js";
import type { Mandate, PaymentProposal } from "../src/types/index.js";
import { PaymentProposalSchema } from "../src/types/index.js";

// ─── load deployment ───────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENT_PATH = path.join(__dirname, "..", "deployment.json");

if (!existsSync(DEPLOYMENT_PATH)) {
  console.error("ERROR: deployment.json not found. Run `pnpm deploy` first.");
  process.exit(1);
}

type Deployment = {
  safeAddress: Address;
  rolesModifierAddress: Address;
  executorAddress: Address;
  whitelist: Address[];
  perTxCapBaseUnits: string;
  usdcAddress: Address;
  chainId: number;
};

const deployment = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf-8")) as Deployment;

// ─── env ──────────────────────────────────────────────────────────────────────

const EXECUTOR_PRIVATE_KEY = process.env["EXECUTOR_PRIVATE_KEY"] as Hex | undefined;
const SIGNER_PRIVATE_KEY = process.env["SIGNER_PRIVATE_KEY"] as Hex | undefined;
const RPC_URL = process.env["RPC_URL"] ?? "https://sepolia.base.org";

if (!EXECUTOR_PRIVATE_KEY) {
  console.error("ERROR: EXECUTOR_PRIVATE_KEY not set in .env");
  process.exit(1);
}
if (!SIGNER_PRIVATE_KEY) {
  console.error("ERROR: SIGNER_PRIVATE_KEY not set in .env");
  process.exit(1);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" Lance — Phase 2 live payment (Base Sepolia)");
  console.log("═══════════════════════════════════════════════════════════\n");

  const payee = deployment.whitelist[0];
  if (!payee) {
    throw new Error("deployment.whitelist is empty — no payee available");
  }

  // Tiny amount: 1 base unit = 0.000001 USDC
  const AMOUNT = "1";

  const now = Math.floor(Date.now() / 1000);

  // ── 1. Build and sign a mandate ────────────────────────────────────────────
  console.log("Step 1: Building mandate...");
  const { privateKeyToAccount } = await import("viem");
  const signerAccount = privateKeyToAccount(SIGNER_PRIVATE_KEY as Hex);

  const unsignedMandate: Omit<Mandate, "signature"> = {
    mandateId: randomUUID(),
    signerAddress: signerAccount.address as Address,
    whitelist: deployment.whitelist,
    token: USDC_ADDRESS,
    perTxCap: deployment.perTxCapBaseUnits,
    perPeriodCap: (BigInt(deployment.perTxCapBaseUnits) * 10n).toString(), // 10x per-tx cap
    period: { windowType: "rolling", durationSeconds: 86400 },
    expiresAt: now + 3600, // 1 hour from now
    createdAt: now,
    chainId: CHAIN_ID,
  };

  const mandate = await signMandate(unsignedMandate, SIGNER_PRIVATE_KEY as Hex);
  const isValid = await verifyMandate(mandate);
  if (!isValid) throw new Error("Mandate signature verification failed");
  console.log("  mandate id:", mandate.mandateId);
  console.log("  signer   :", mandate.signerAddress);
  console.log("  valid sig:", isValid, "\n");

  // ── 2. Build a payment proposal ────────────────────────────────────────────
  console.log("Step 2: Building payment proposal...");
  const proposal: PaymentProposal = PaymentProposalSchema.parse({
    proposalId: randomUUID(),
    mandateId: mandate.mandateId,
    payee,
    token: USDC_ADDRESS,
    amount: AMOUNT,
    chainId: CHAIN_ID,
    timestamp: now,
    rationale: "Phase 2 live payment acceptance test — 1 base unit USDC",
  });
  console.log("  proposal id:", proposal.proposalId);
  console.log("  payee      :", proposal.payee);
  console.log("  amount     :", AMOUNT, "base units (0.000001 USDC)\n");

  // ── 3. Run policy engine ────────────────────────────────────────────────────
  console.log("Step 3: Policy engine check...");
  const seenIds = new Set<string>();
  const decision = checkPolicy(proposal, mandate, "0", seenIds);
  console.log("  verdict   :", decision.verdict);
  console.log("  reason    :", decision.reasonCode);
  if (decision.verdict !== "APPROVE") {
    throw new Error(`Policy rejected: ${decision.reasonCode} — ${decision.reason}`);
  }
  console.log("  ✓ Policy APPROVED\n");

  // ── 4. Submit live tx via chain adapter ────────────────────────────────────
  console.log("Step 4: Submitting live payment (shadow=false)...");
  const adapter = createChainAdapter({
    shadow: false, // ← explicit live-mode opt-in
    rolesModifierAddress: deployment.rolesModifierAddress,
    executorPrivateKey: EXECUTOR_PRIVATE_KEY as Hex,
    rpcUrl: RPC_URL,
    auditSeam: createNullAuditSeam(),
  });

  const result = await adapter.submit(proposal);

  console.log("\nResult:");
  console.log("  success :", result.success);
  console.log("  tx hash :", result.txHash ?? "(none)");
  console.log("  payee   :", result.decoded.payee);
  console.log("  amount  :", result.decoded.amountHuman);

  if (!result.success) {
    console.error("\n✗ Live payment FAILED");
    process.exit(1);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" ✓ Phase 2 acceptance: live payment confirmed on Base Sepolia");
  console.log("  tx hash:", result.txHash);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n[live-payment] ERROR:", err);
  process.exit(1);
});
