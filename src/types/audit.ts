import { z } from "zod";
import { zHex } from "./mandate.js";
import { MandateSchema } from "./mandate.js";
import { PaymentProposalSchema } from "./proposal.js";
import { PolicyDecisionSchema } from "./policy.js";

// ─── AuditRecord ──────────────────────────────────────────────────────────────

/**
 * A single entry in the tamper-evident audit log.
 *
 * Binds together: proposal → agent rationale → mandate snapshot →
 * policy verdict → on-chain tx hash (for approved+submitted payments).
 *
 * Each record includes the previous record's hash, forming a hash chain.
 * Tampering with any record invalidates all subsequent records.
 * The first record has previousHash = null.
 *
 * Every payment path (APPROVE + submitted, REJECT, ESCALATE) writes exactly
 * one AuditRecord. The audit layer is the accountability guarantee.
 */
export const AuditRecordSchema = z.object({
  /** Stable identifier for this audit record. */
  recordId: z.string().uuid(),

  /**
   * Monotonically increasing sequence number within the log.
   * Used to detect gaps; does not substitute for hash-chain verification.
   */
  sequenceNumber: z.number().int().nonnegative(),

  /** ID of the proposal this record covers. */
  proposalId: z.string().uuid(),

  /** Full proposal snapshot at time of decision. */
  proposal: PaymentProposalSchema,

  /** Full policy decision. */
  decision: PolicyDecisionSchema,

  /** ID of the mandate used for this decision. */
  mandateId: z.string().uuid(),

  /**
   * Snapshot of the mandate at time of decision.
   * Immutable snapshot — mandate changes produce a new mandateId anyway,
   * but the snapshot makes records self-contained for offline auditing.
   */
  mandateSnapshot: MandateSchema,

  /**
   * On-chain transaction hash, set after a successful APPROVE + submit.
   * null for REJECT and ESCALATE records, and for APPROVEs not yet submitted.
   */
  txHash: zHex.nullable(),

  /**
   * Hash of the previous AuditRecord (its recordHash field).
   * null only for the very first record in the log.
   * SHA-256 hex, 0x-prefixed.
   */
  previousHash: zHex.nullable(),

  /**
   * SHA-256 hash of this record's canonical JSON (with recordHash = "0x").
   * Computed after all other fields are set; verifiable offline.
   */
  recordHash: zHex,

  /** Unix timestamp when this record was written. */
  createdAt: z.number().int().positive(),
});

export type AuditRecord = z.infer<typeof AuditRecordSchema>;
