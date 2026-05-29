/**
 * Phase 1: Deterministic policy engine.
 *
 * Will export:
 *   - checkPolicy(proposal, mandate, periodSpendSoFar) → PolicyDecision
 *
 * Invariants (never relax):
 *   - Pure function: no I/O, no network, no side effects.
 *   - Rejects rather than coerces: never "fix up" a malformed proposal.
 *   - Returns a machine-readable reasonCode on every path.
 *   - Fully unit-testable; the adversarial test suite lives here.
 */

export {};
