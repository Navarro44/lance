# Agentic Payment Authorization Layer
### Build Spec & Project Brief

> A verifiable authorization-and-accountability layer that lets an autonomous AI agent
> make stablecoin payments to suppliers — where theft is structurally impossible even
> if the agent is fully compromised.

---

## The one-paragraph pitch

The industry just built the *rails* for agentic payments — Stripe/OpenAI's ACP, Google's
AP2, Coinbase's x402, Visa Intelligent Commerce, Mastercard Agent Pay. But adoption is
stalling because the rails ship without the hard part: the **trust, risk, and accountability
layer** that sits between a probabilistic AI agent and deterministic money. This project
builds that layer. A human signs a **mandate** (who's payable, how much, how often). An AI
agent **proposes** payments. A **deterministic policy engine** checks every proposal against
the mandate. An **on-chain guardrail** (Safe + Zodiac Roles, destination-locked) enforces the
same constraints independently. Every decision produces a **tamper-evident audit trail**
binding intent → decision → execution. The LLM is deliberately kept *out of the execution path*.

This directly attacks three of the four named open problems in agent-to-agent payments:
**weak intent binding**, **misuse under valid authorization**, and **limited accountability**.

---

## Core design principle

> **Build the cage before the animal.**

The probabilistic component (the LLM) proposes. The deterministic components (policy engine,
on-chain guardrail) decide and enforce. We prove the safety guarantees hold *before* the
unpredictable component is even introduced. This is also why the LLM is built last (Phase 4),
not first.

The single most important structural property: **destination-locking.** The on-chain executor
key can only ever send funds to whitelisted addresses (and back to the Safe). A fully
compromised agent — leaked key, prompt injection, logic bug — can at worst bounce capital
between approved destinations. It can never exfiltrate the treasury. Safety is enforced by the
contract layer, not by the agent behaving.

---

## The six components

1. **Mandate** — an EIP-712 signed object created once by the human / multisig.
   Fields: allowed counterparties (whitelist), per-transaction cap, per-period cap,
   **explicit period definition** (window type — rolling vs fixed-calendar — plus duration and
   anchor timestamp, so "per-period" is unambiguous), allowed token (USDC), expiry.
   The cryptographic capture of human intent.

2. **AI agent** — the LLM. Ingests a payment request, reasons about whether it's legitimate
   and should go now, emits a schema-validated `PaymentProposal`. **Never holds a key.
   Never touches the chain.**

3. **Policy engine** — pure deterministic code. `(proposal, mandate, periodSpendSoFar) → decision`
   (approve / reject / escalate), returning the new running period total on the decision. The
   engine is stateless: the caller passes in current period spend and the engine validates
   against it. This is the differentiator and it's pure logic — fast to iterate, heavily tested.

4. **On-chain guardrail** — Safe + Zodiac Roles on Base. Scopes the executor key to USDC
   transfers, to whitelisted destinations only, within caps — enforced on-chain, independent
   of the agent and the policy engine. The owner multisig can disable the module instantly
   (kill switch + escalation override in one).

5. **Escalation path** — anything outside the mandate surfaces for human approval before
   execution.

6. **Audit layer** — a hash-chained, tamper-evident log binding
   proposal → rationale → mandate → policy verdict → on-chain tx hash. **It is also the source
   of truth for period spend:** the caller derives `periodSpendSoFar` by summing prior approved
   payments in the current window from the audit log before each policy call — so cap
   enforcement and accountability read from the same tamper-evident data, with no second mutable
   place for the running total to drift.

---

## v1 scope decisions (locked)

- **Static whitelist.** The human configures payable counterparties directly. The agent
  exercises *judgment within bounds*, not *discovery*.
- **Payment trigger** = explicit request. A payee + amount arrives (from a user, form, or
  webhook). The agent validates and proposes. (Invoice *discovery* — "which invoices deserve
  paying?" — is the Phase 4 enhancement.)
- **Testnet only through Phase 5.** Base Sepolia, test USDC, a test Safe. Zero portfolio cost
  to staying on testnet; it removes all "this could lose real money" risk.
- **TypeScript end-to-end** — Safe SDK, viem, and Zodiac tooling are all TS-native.

---

## Build order (≈ one Claude Code session per phase)

### Phase 0 — Scaffolding
- TypeScript project setup.
- Define the four core types FIRST — they're the spine everything plugs into:
  `Mandate`, `PaymentProposal`, `PolicyDecision`, `AuditRecord`.
- Stand up Base Sepolia, test USDC, a test Safe.
- **First real move: pull *current* docs** for Zodiac Roles (current version), the Safe SDK
  surface, and the chosen signer SDK. Do not trust stale snapshots — these drift.

### Phase 1 — Deterministic core (no AI yet)
- EIP-712 mandate signing + verification. The `Mandate` must define the period window
  explicitly (rolling vs fixed-calendar, duration, anchor); the `PaymentProposal` must carry a
  timestamp so the engine can decide which prior spend counts toward the period cap.
- Policy engine: `(proposal, mandate, periodSpendSoFar) → verdict` (+ new running total).
  Pure/stateless — caller owns the period total, engine validates against it.
- Period spend is derived from the audit log, not held in a mutable variable (the audit layer
  arrives in Phase 3; until then, derive from an in-memory list of prior approvals so the
  contract is right from the start).
- Heavy unit + adversarial tests: proposals just over the cap, expired mandates,
  non-whitelisted payees, replay attempts, per-period cap exhausted across multiple proposals,
  proposals at the period-window boundary.
- Target a resume-grade claim: **"0 unauthorized approvals across N adversarial cases."**

### Phase 2 — On-chain guardrail (shadow mode first)
- Deploy the Safe; configure Zodiac Roles to scope the executor to USDC transfers,
  whitelisted destinations only, with caps.
- Build the viem chain adapter — but **construct and log** transactions rather than submit
  them. Verify the full loop produces correct, in-bounds transactions.
- Then flip to live testnet submission with tiny amounts.

### Phase 3 — Audit layer
- Hash-chained log binding proposal → decision → tx hash.
- Built here because it makes everything afterward debuggable, and it's high-signal and
  self-contained.

### Phase 4 — The LLM enters (cage already proven)
- Agent ingests requests, emits a schema-validated `PaymentProposal` via structured output.
- Talks **only** to the policy engine.
- Built last on purpose: the safety layer never depended on the agent behaving.
- *Enhancement (optional within this phase):* invoice ingestion + legitimacy reasoning —
  the agent reasons about *which* requests are real, not just whether one is in-bounds.

### Phase 5 — Demo interface
- Pending proposals, escalations, mandate config, audit viewer.
- **The money shot for the GitHub GIF:** agent proposes a payment to a non-whitelisted
  address → policy engine *stops it* (safety visibly working) → then a clean valid payment
  flows end-to-end.

### Phase 6 — x402 kicker (optional)
- The same authorization layer enforcing an agent paying for a service over x402.
- The one-line frontier flourish: *"same cage, agent-to-agent falls out for free."*

---

## Positioning (carry this through every surface)

> Your differentiator is **safety as a feature, not a footnote.** Anyone can wire an LLM to a
> wallet. The hard, rare, valuable thing is making it safe enough that a CFO would fund the
> wallet.

- **README:** problem → 20s demo GIF showing the *guardrail working* → architecture diagram →
  "why this is hard." Surface the LLM-out-of-execution-path insight prominently. Include a
  couple of short ADRs (why Safe+Roles, why destination-locking, why the LLM can't sign).
- **Resume:** lead with the constraint system, not the stack. *"Designed a verifiable
  authorization layer for autonomous stablecoin payments: an LLM proposes, a deterministic
  policy engine enforces signed spend-mandates, and on-chain guardrails make theft
  structurally impossible even under a compromised agent."*
- **Recruiters:** *"The industry built the rails; the gap is the trust layer. I built that
  layer."*
- **Investors (framing, not a raise):** rails are commoditizing → value migrates up the stack
  to authorization/risk/accountability. Wedge: supplier payments for crypto-native + LatAm-USD
  SMEs. Why-now: stablecoin institutionalization + maturing rails + regulatory clarity
  (GENIUS Act, MiCA). Defensible early posture: *pure technology conduit enforcing
  pre-authorized, user-signed mandates.* (A real lawyer conversation precedes any actual raise.)

---

## Open flags to revisit

- "Risk-adjusted return" / yield ranking only matters if/when the treasury-yield feature is
  added — out of v1 scope.
- Legal: autonomous deployment/payment of others' capital touches money-transmission and
  advisory questions. Fine to ignore for a testnet prototype; not fine to ignore before a raise.
- Verify all SDK/contract versions against current docs at build time (see Phase 0).