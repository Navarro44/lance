/**
 * Phase 4: LLM proposer (added last — cage before animal).
 *
 * Will export:
 *   - proposePayment(request, mandateId) → PaymentProposal
 *
 * Hard constraints (never relax):
 *   - The agent never holds a key.
 *   - The agent never touches the chain.
 *   - Output is schema-validated (PaymentProposalSchema.parse) before it
 *     reaches the policy engine. Validation failure = escalate.
 *   - Prompt-injection content in rationale cannot affect policy decisions
 *     because the policy engine is pure/deterministic.
 */

export {};
