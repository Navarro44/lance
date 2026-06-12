/**
 * Audit seam — the contract between the chain adapter and the audit layer.
 *
 * Phase 3 will replace NullAuditSeam with the hash-chained audit log that
 * is the source of truth for periodSpendSoFar. The seam exists NOW so that
 * on-chain execution and accounting can never diverge: the adapter always
 * writes here, even if this phase's implementation is a stub.
 *
 * The interface is intentionally minimal: record one executed payment.
 * The audit layer in Phase 3 will persist the full AuditRecord and maintain
 * the hash chain.
 */

import type { Address, Hash } from "viem";

/** Minimal payment record that the adapter emits after a confirmed tx. */
export type ExecutedPayment = {
  proposalId: string;
  mandateId: string;
  payee: Address;
  token: Address;
  amount: string; // decimal integer string, base units
  txHash: Hash;
  executedAt: number; // unix seconds
};

/** Interface every audit seam implementation must satisfy. */
export interface AuditSeam {
  /**
   * Called immediately after a live transaction is confirmed on-chain.
   * Must never throw — the adapter catches any error and logs it so the
   * seam does not become a liveness hazard.
   */
  recordExecution(payment: ExecutedPayment): void;
}

/**
 * Phase 2 stub: logs to console and writes to a local JSONL file.
 * Phase 3 replaces this with the hash-chained audit log.
 */
export class NullAuditSeam implements AuditSeam {
  recordExecution(payment: ExecutedPayment): void {
    console.log("[audit-seam] STUB — payment executed:", {
      proposalId: payment.proposalId,
      payee: payment.payee,
      amount: payment.amount,
      txHash: payment.txHash,
    });
  }
}

export function createNullAuditSeam(): AuditSeam {
  return new NullAuditSeam();
}
