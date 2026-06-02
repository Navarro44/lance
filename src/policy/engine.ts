import { randomUUID } from "crypto";
import type {
  Mandate,
  PaymentProposal,
  PolicyDecision,
  ReasonCode,
  Verdict,
} from "../types/index.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function decision(
  proposalId: string,
  mandateId: string,
  verdict: Verdict,
  reasonCode: ReasonCode,
  reason: string,
  periodSpendAfter: string | null,
): PolicyDecision {
  return {
    decisionId: randomUUID(),
    proposalId,
    mandateId,
    verdict,
    reasonCode,
    reason,
    checkedAt: Math.floor(Date.now() / 1000),
    periodSpendAfter,
  };
}

function reject(
  proposalId: string,
  mandateId: string,
  reasonCode: ReasonCode,
  reason: string,
): PolicyDecision {
  return decision(proposalId, mandateId, "REJECT", reasonCode, reason, null);
}

function escalate(
  proposalId: string,
  mandateId: string,
  reasonCode: ReasonCode,
  reason: string,
): PolicyDecision {
  return decision(proposalId, mandateId, "ESCALATE", reasonCode, reason, null);
}

// ─── checkPolicy ─────────────────────────────────────────────────────────────

/**
 * The deterministic policy engine.
 *
 * Pure function — no I/O, no network, no side effects, no mutable state.
 * Every check is explicit and returns a machine-readable reason code.
 * The engine never "fixes up" a bad proposal into an approvable one.
 *
 * @param proposal        The agent's payment proposal (treat all fields as untrusted).
 * @param mandate         A mandate already verified by verifyMandate().
 * @param periodSpendSoFar Running sum of approved payments in the current window,
 *                        in token base units (decimal integer string). The caller
 *                        derives this from the audit log; the engine only validates.
 * @param seenProposalIds Set of proposalIds already processed. Replay protection.
 *                        The caller maintains this set; engine checks and returns early.
 */
export function checkPolicy(
  proposal: PaymentProposal,
  mandate: Mandate,
  periodSpendSoFar: string,
  seenProposalIds: ReadonlySet<string> = new Set(),
): PolicyDecision {
  const pid = proposal.proposalId;
  const mid = mandate.mandateId;

  // ── 1. Replay protection ──────────────────────────────────────────────────
  if (seenProposalIds.has(pid)) {
    return reject(
      pid,
      mid,
      "PROPOSAL_ALREADY_PROCESSED",
      `Proposal ${pid} has already been processed.`,
    );
  }

  // ── 2. Mandate ID must match ──────────────────────────────────────────────
  if (proposal.mandateId !== mid) {
    return reject(
      pid,
      mid,
      "MANDATE_ID_MISMATCH",
      `Proposal mandateId "${proposal.mandateId}" does not match mandate "${mid}".`,
    );
  }

  // ── 3. Chain ID must match ────────────────────────────────────────────────
  if (proposal.chainId !== mandate.chainId) {
    return reject(
      pid,
      mid,
      "CHAIN_MISMATCH",
      `Proposal chainId ${proposal.chainId} ≠ mandate chainId ${mandate.chainId}.`,
    );
  }

  // ── 4. Mandate must not be expired ────────────────────────────────────────
  // expiresAt is the first timestamp at which the mandate is no longer valid.
  if (proposal.timestamp >= mandate.expiresAt) {
    return reject(
      pid,
      mid,
      "MANDATE_EXPIRED",
      `Mandate expired at ${mandate.expiresAt}; proposal timestamp is ${proposal.timestamp}.`,
    );
  }

  // ── 5. Token must match ───────────────────────────────────────────────────
  if (proposal.token.toLowerCase() !== mandate.token.toLowerCase()) {
    return reject(
      pid,
      mid,
      "TOKEN_MISMATCH",
      `Proposal token ${proposal.token} ≠ mandate token ${mandate.token}.`,
    );
  }

  // ── 6. Payee must be on the whitelist ─────────────────────────────────────
  const whitelistLower = mandate.whitelist.map((a) => a.toLowerCase());
  if (!whitelistLower.includes(proposal.payee.toLowerCase())) {
    return reject(
      pid,
      mid,
      "PAYEE_NOT_WHITELISTED",
      `Payee ${proposal.payee} is not on the mandate whitelist.`,
    );
  }

  // ── 7. Amount must be positive ────────────────────────────────────────────
  const amount = BigInt(proposal.amount);
  if (amount === 0n) {
    return reject(pid, mid, "ZERO_AMOUNT", "Payment amount must be greater than zero.");
  }

  // ── 8. Per-transaction cap ────────────────────────────────────────────────
  const perTxCap = BigInt(mandate.perTxCap);
  if (amount > perTxCap) {
    return reject(
      pid,
      mid,
      "AMOUNT_EXCEEDS_PER_TX_CAP",
      `Amount ${proposal.amount} exceeds per-tx cap ${mandate.perTxCap} (overage: ${amount - perTxCap}).`,
    );
  }

  // ── 9. Per-period cap ─────────────────────────────────────────────────────
  const spendSoFar = BigInt(periodSpendSoFar);
  const perPeriodCap = BigInt(mandate.perPeriodCap);
  const newSpend = spendSoFar + amount;
  if (newSpend > perPeriodCap) {
    return reject(
      pid,
      mid,
      "AMOUNT_EXCEEDS_PERIOD_CAP",
      `Period spend ${periodSpendSoFar} + amount ${proposal.amount} = ${newSpend} exceeds period cap ${mandate.perPeriodCap}.`,
    );
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  return decision(
    pid,
    mid,
    "APPROVE",
    "WITHIN_MANDATE",
    "Proposal is within all mandate bounds.",
    newSpend.toString(),
  );
}

/**
 * Escalation helper for callers that detect a signature failure before
 * calling checkPolicy. Returns a properly formed ESCALATE decision.
 */
export function escalateUnverifiedMandate(proposalId: string, mandateId: string): PolicyDecision {
  return escalate(
    proposalId,
    mandateId,
    "MANDATE_SIGNATURE_UNVERIFIED",
    "Mandate signature could not be verified. Human review required.",
  );
}
