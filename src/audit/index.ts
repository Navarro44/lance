/**
 * Phase 3: Hash-chained tamper-evident audit log.
 *
 * Will export:
 *   - createAuditRecord(proposal, decision, mandate, prevRecord?) → AuditRecord
 *   - verifyChain(records) → { valid: boolean; firstInvalidAt?: number }
 *   - appendRecord(record, store) → void
 *   - readLog(store) → AuditRecord[]
 *
 * Design: every record's hash covers the previous record's hash.
 * An offline verifier can replay the chain from record 0 with no trusted state.
 * Every payment path (APPROVE + submitted, REJECT, ESCALATE) writes a record.
 */

export {};
