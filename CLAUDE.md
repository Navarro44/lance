# CLAUDE.md

Operational instructions for Claude Code working in this repo. Read this fully before acting.
The full vision/rationale lives in `agentic_payment_authorization_layer_spec.md` — read it once
for context, but THIS file governs how you behave here.

## What this project is (one line)

A verifiable authorization-and-accountability layer that lets an autonomous AI agent make
stablecoin payments to suppliers, where theft is structurally impossible even if the agent is
fully compromised.

## Two hard rules — never violate

1. **The LLM is NEVER in the execution path.** The agent proposes; it never signs, never
   submits, never holds a key. Deterministic code and on-chain guardrails decide and enforce.
2. **Testnet only.** Base Sepolia, test USDC, test Safe. Never touch mainnet or real funds.

A third, structural: **destination-locking is sacred.** The on-chain executor must be unable to
send funds to any non-whitelisted address. Never weaken this, and flag to me if any change would.

## Build discipline

- Build ONLY the phase I name in a given session. When acceptance criteria are met, STOP,
  summarize what you built and how to run/test it, and do NOT start the next phase.
- Before relying on any external SDK/protocol version, VERIFY against current docs — my project
  knowledge may be stale. This applies especially to Zodiac Roles Modifier, Safe SDK
  (protocol-kit), viem, the signer SDK, and x402. Report mismatches before proceeding.
- If you want to change the architecture (custody, signer, where the agent sits relative to
  execution), propose it to me first — do not just apply it.

## Architecture — the six components

1. **Mandate** — EIP-712 signed object (whitelist, per-tx cap, per-period cap, explicit period
   window [rolling vs fixed-calendar + duration + anchor], allowed token = USDC, expiry). The
   cryptographic capture of human intent.
2. **AI agent** — LLM; ingests a request, emits a schema-validated `PaymentProposal`. No keys,
   no chain access.
3. **Policy engine** — pure deterministic `(proposal, mandate, periodSpendSoFar) => PolicyDecision`
   (approve | reject | escalate), always with a machine-readable reason; returns the new running
   period total. Stateless — caller owns period spend, engine validates against it. No side effects.
4. **On-chain guardrail** — Safe + Zodiac Roles on Base Sepolia. Scopes the executor to USDC
   transfers, whitelisted destinations only, within caps. Owner multisig = kill switch.
5. **Escalation path** — anything outside the mandate surfaces for human approval.
6. **Audit layer** — hash-chained, tamper-evident log binding
   proposal → rationale → mandate → verdict → tx hash. Also the source of truth for period
   spend: the caller derives `periodSpendSoFar` by summing prior in-window approvals from the
   log before each policy call.

## The four core types (the spine)

`Mandate`, `PaymentProposal`, `PolicyDecision`, `AuditRecord` — defined in `src/types`, with
runtime validation (zod). Everything plugs into these; change them deliberately, not casually.

## v1 scope (locked)

- Static whitelist (human configures payable counterparties directly).
- Payment trigger = explicit request (payee + amount). The agent exercises judgment within
  bounds, not discovery. (Invoice discovery is a Phase 4 enhancement only.)
- TypeScript end-to-end.

## Tech stack

- Language: TypeScript (strict).
- Chain: Base Sepolia via viem. Token: test USDC.
- Custody/enforcement: Safe (protocol-kit) + Zodiac Roles Modifier. Use `zodiac-roles-sdk`
  (self-contained, no cloud/API-key dependency) — NOT `@zodiac-os/sdk`. Rationale: no external
  credential in the safety-critical path; reproducible for anyone cloning the repo. See
  docs/adr/0001. Verify the current version cleanly supports the needed scoping at Phase 2.
- Validation: zod. Tests: Vitest.
- Secrets in `.env` (gitignored); keep `.env.example` current.

## Module layout

```
src/types    core schemas + runtime validation
src/mandate  EIP-712 signing & verification
src/policy   deterministic policy engine
src/chain    viem adapter + Safe/Roles integration
src/audit    hash-chained audit log
src/agent    the LLM proposer (added Phase 4)
src/ui       demo interface (added Phase 5)
```

## Commands

<!-- Fill these in once Phase 0 sets up the project, then keep them accurate. -->

```bash
# install
# <pkg-manager> install

# build
# <pkg-manager> run build

# test  (the adversarial policy suite is the centerpiece — keep it green)
# <pkg-manager> run test

# lint / format
# <pkg-manager> run lint

# verify Base Sepolia connection
# <pkg-manager> run <connection-check-script>
```

## Conventions

- Policy engine stays pure: no I/O, no network, fully unit-testable.
- Prefer rejecting/escalating over coercing bad input — never "fix up" a malformed proposal
  into an approvable one.
- Every payment path (approved+submitted, escalated, rejected) must write an audit record.
- Tests that prove a safety guarantee (off-whitelist revert, out-of-bounds rejection,
  prompt-injection containment) are not optional and must not be deleted to make a build pass.