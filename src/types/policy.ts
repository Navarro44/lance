import { z } from "zod";

// ─── PolicyDecision ───────────────────────────────────────────────────────────

/**
 * Possible outcomes of the deterministic policy check.
 *
 * APPROVE  — proposal is within mandate bounds; executor may proceed.
 * REJECT   — proposal violates the mandate (wrong payee, over cap, expired,
 *            chain mismatch, etc.). Never submitted on-chain.
 * ESCALATE — proposal is structurally valid but outside bounds, or the mandate
 *            cannot be resolved; surfaces to the human approver.
 */
export const VerdictSchema = z.enum(["APPROVE", "REJECT", "ESCALATE"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * Machine-readable reason codes for policy decisions.
 * The policy engine always produces a code; reason is the human string.
 */
export const ReasonCodeSchema = z.enum([
  // APPROVE
  "WITHIN_MANDATE",

  // REJECT codes
  "PAYEE_NOT_WHITELISTED",
  "AMOUNT_EXCEEDS_PER_TX_CAP",
  "AMOUNT_EXCEEDS_PERIOD_CAP",
  "TOKEN_MISMATCH",
  "CHAIN_MISMATCH",
  "MANDATE_EXPIRED",
  "MANDATE_ID_MISMATCH",
  "ZERO_AMOUNT",
  "MALFORMED_PROPOSAL",
  "PROPOSAL_ALREADY_PROCESSED",

  // ESCALATE codes
  "MANDATE_NOT_FOUND",
  "MANDATE_SIGNATURE_UNVERIFIED",
  "HUMAN_REVIEW_REQUESTED",
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

/**
 * The output of the policy engine.
 *
 * Pure value: (PaymentProposal, Mandate) → PolicyDecision.
 * No network I/O, no side effects, fully unit-testable.
 * Every payment path (approve, reject, escalate) emits exactly one of these.
 */
export const PolicyDecisionSchema = z.object({
  /** Stable identifier for this decision record. */
  decisionId: z.string().uuid(),

  /** The proposal this decision covers. */
  proposalId: z.string().uuid(),

  /** The mandate this proposal was checked against. */
  mandateId: z.string().uuid(),

  /** The verdict. */
  verdict: VerdictSchema,

  /** Machine-readable reason code — use in tests and conditional logic. */
  reasonCode: ReasonCodeSchema,

  /** Human-readable explanation — for the audit log and escalation UI. */
  reason: z.string().min(1),

  /** Unix timestamp when the policy engine produced this decision. */
  checkedAt: z.number().int().positive(),

  /**
   * Running period spend after this decision, in token base units.
   * Populated on APPROVE; null otherwise (engine has no state — caller tracks
   * period spend and passes it in, engine returns the new running total).
   */
  periodSpendAfter: z.string().nullable(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
