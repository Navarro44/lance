import { z } from "zod";
import { zAddress, zTokenAmount } from "./mandate.js";

// ─── PaymentProposal ──────────────────────────────────────────────────────────

/**
 * The output of the AI agent — a fully schema-validated payment request.
 *
 * The LLM emits this object via structured output. It is the boundary between
 * the probabilistic (AI) and deterministic (policy engine) worlds. The policy
 * engine treats every field as untrusted input; it never "fixes up" a bad proposal.
 *
 * The agent never holds a key and never accesses the chain. This type is the
 * only thing that crosses the trust boundary.
 */
export const PaymentProposalSchema = z.object({
  /** Stable identifier for this proposal. */
  proposalId: z.string().uuid(),

  /**
   * The mandateId the agent believes this proposal falls under.
   * Policy engine will verify this matches an active, valid mandate.
   */
  mandateId: z.string().uuid(),

  /** Intended recipient of the payment. Must be on the mandate whitelist. */
  payee: zAddress,

  /**
   * Payment amount in token base units (USDC = 6 decimals).
   * e.g. "1000000" = 1.00 USDC.
   */
  amount: zTokenAmount,

  /**
   * The payment token address. Policy engine verifies this matches the
   * mandate's token field — the agent cannot redirect funds to a different
   * token.
   */
  token: zAddress,

  /**
   * Human-readable rationale the agent produced for this payment.
   * Stored verbatim in the audit record. Prompt-injection content here
   * cannot affect policy decisions (engine is pure/deterministic).
   */
  rationale: z.string().min(1, "Rationale must not be empty"),

  /**
   * Description of what triggered this payment proposal.
   * e.g. "invoice #INV-2026-042", "user-request", "webhook:stripe"
   */
  requestSource: z.string().min(1),

  /** Unix timestamp when the agent produced this proposal. */
  timestamp: z.number().int().positive(),

  /** Chain ID the agent believes this payment should execute on. */
  chainId: z.number().int().positive(),
});

export type PaymentProposal = z.infer<typeof PaymentProposalSchema>;
