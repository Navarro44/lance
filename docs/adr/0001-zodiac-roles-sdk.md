# ADR 0001 — Use `zodiac-roles-sdk`, not `@zodiac-os/sdk`

- **Status:** Accepted (locked)
- **Date recorded:** 2026-08-02
- **Applies to:** `src/chain/` (Phase 2 on-chain guardrail)

## Context

The on-chain guardrail is Safe + Zodiac Roles Modifier on Base Sepolia. The Roles Modifier is
what makes destination-locking real: it scopes the executor EOA to USDC `transfer()` only, to
whitelisted destinations only, within a per-tx cap. Encoding those permissions correctly —
role keys, `scopeTarget`, `scopeFunction`, and the condition tree — needs tooling.

Two options exist in the Zodiac ecosystem:

- **`zodiac-roles-sdk`** — a self-contained TypeScript library. Condition trees are built and
  flattened locally; nothing leaves the machine.
- **`@zodiac-os/sdk`** — the newer packaging, which routes permission authoring through a
  hosted service and expects an API credential.

## Decision

Use **`zodiac-roles-sdk`** (installed: `4.0.0`). Do not introduce `@zodiac-os/sdk`.

## Rationale

1. **No external credential in the safety-critical path.** The permission set *is* the security
   boundary of this project. If building or encoding it depends on a third-party service, that
   service becomes part of the trust model — a place where the destination whitelist could be
   wrong, stale, or unavailable at the moment it matters. The whole premise here is that theft
   is structurally impossible even under a fully compromised agent; that argument weakens if the
   cage is assembled by a remote API.
2. **Reproducibility.** Anyone cloning this repo can run `pnpm install && pnpm deploy` without
   signing up for anything or provisioning a key. A prototype whose safety claims can't be
   independently re-run is a weaker artifact.
3. **Offline determinism.** Condition-tree construction (`buildTransferConditions` in
   [`src/chain/roles.ts`](../../src/chain/roles.ts)) is pure, local, and unit-testable — it
   composes in the same style as the deterministic policy engine rather than against it.

## Consequences

- `zodiac-roles-sdk` is imported **only** from `src/chain/`. `src/types`, `src/policy`, and
  `src/mandate` must never import chain-layer libraries — that boundary keeps the policy engine
  pure and testable without a network.
- The Roles Modifier bytecode is pulled from `zodiac-roles-sdk/typechain` via a lazy dynamic
  `import()` (`getRolesBytecode()`), so the dependency is only loaded when actually deploying.
  It is `async` because this is an ESM package — a synchronous `require()` is not available.
- Roles v2 has `LessThan` but no `LessThanOrEqual`, so the per-tx cap is encoded as
  `LessThan(cap + 1)`. Documented at the call site.
- Version drift is a live risk. Per `CLAUDE.md`, SDK and contract versions must be re-verified
  against current docs before being relied on — this ADR records the decision, not a guarantee
  that `4.0.0`'s surface is unchanged.

## Alternatives considered

- **`@zodiac-os/sdk`** — rejected: places an external credential and an external service inside
  the safety-critical path (see rationale 1 and 2).
- **Hand-encoding Roles calldata with viem alone** — viable and dependency-free, but the
  condition-tree encoding is exactly the part that is easy to get subtly wrong, and getting it
  wrong silently weakens destination-locking. Using the maintained encoder, with adversarial
  on-chain tests (ADV-C01–C09) verifying the result, is the safer trade.
