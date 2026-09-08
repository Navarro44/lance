# ADR 0002 — Deploy the Roles Modifier as an EIP-1167 proxy to a canonical mastercopy

- **Status:** Accepted (supersedes the direct-bytecode deployment assumed in Phase 2)
- **Date:** 2026-09-07
- **Applies to:** `src/chain/roles.ts`, `scripts/deploy.ts`
- **Related:** [ADR 0001](0001-zodiac-roles-sdk.md)
- **Amended:** 2026-09-07 — target chain moved to Ethereum Sepolia (see Addendum)

## Context

Phase 2 deployed the Zodiac Roles Modifier by sending `Roles__factory.bytecode` from
`zodiac-roles-sdk` as transaction data. That approach cannot work, and the reason is structural.

### Finding 1 — the shipped artifact exceeds the EIP-170 contract size limit

Deploying it fails with `EVM error CreateContractSizeLimit`. Measured by deploying on a local
anvil fork of Base Sepolia started with `--disable-code-size-limit`:

| Contract | Runtime size | EIP-170 limit | Verdict |
| --- | ---: | ---: | --- |
| Roles (zodiac-roles-sdk typechain) | **25,286 bytes** | 24,576 | **710 bytes over — undeployable** |
| Integrity library | 5,895 bytes | 24,576 | fine |
| Packer library | 2,138 bytes | 24,576 | fine |

This is not a gas setting or a chain quirk: no EIP-170 chain will accept that contract. The
canonical Roles mastercopy deployed by Gnosis Guild measures **24,409 bytes** — it is a
different, optimizer-tuned build that the SDK does not ship. `zodiac-roles-sdk` exports
typechain artifacts for ABIs and types; it is a permission-authoring SDK, not a deployment tool,
and exposes no deploy helper.

Two secondary defects in the old path were found and fixed on the way to this conclusion:
the raw bytecode carries unlinked `__$<hash>$__` library placeholders (invalid hex — the RPC
rejects it with `-32602`), and linking them still leaves the size problem.

## Decision

Deploy the Roles Modifier the canonical Zodiac way: a **minimal EIP-1167 proxy** pointing at a
**pre-deployed mastercopy**, created through the **Zodiac ModuleProxyFactory**, with `setUp`
executed atomically in the same transaction.

Concretely:

1. **Mastercopy address is resolved from a registry, never hardcoded.**
   `getZodiacModuleAddress(KnownContracts.ROLES, "^2.0.0")` from `@gnosis-guild/zodiac`
   (pinned `5.0.1`, no caret range).
2. **The registry's FAULTY list is enforced.** `sanityCheckZodiacModuleAddress` throws on both
   unknown and vendor-flagged-faulty addresses, and `resolveRolesMastercopy` calls it again
   locally so the guarantee does not depend on vendor internals.
   **This is load-bearing: Roles `2.1.0` (`0x9646fDAD…`) is flagged FAULTY.** It is the address
   most third-party guides cite. Hardcoding it would have silently pinned the guardrail to a
   version its own authors withdrew.
3. **The factory address is derived, not hardcoded.** `@gnosis-guild/zodiac-core` (pinned
   `4.3.0`) computes it as CREATE2 from the ERC-2470 singleton factory.
4. **`setUp(owner, avatar, target)` = (Safe, Safe, Safe).** The Safe owns the modifier, so only
   the Safe can change scoping — the kill switch stays with the owner multisig.

### Mandatory safety conditions

These are enforced in code (`verifyRolesMastercopy`) and must not be relaxed:

- **Code presence.** Fetch code at the resolved mastercopy on the target chain. Empty code →
  **fail loudly**, never deploy a proxy at an address with no implementation.
- **ABI-presence check.** Every selector the guardrail depends on — `scopeTarget`,
  `scopeFunction`, `assignRoles`, `setDefaultRole`, `execTransactionWithRole` — must appear in
  that runtime code. Any missing → **fail loudly**.
- **Codehash pinned.** The verified codehash is recorded in `deployment.json`, so a deployment
  names exactly the implementation it trusted.
- **Proxy landed.** After deployment, assert code exists at the predicted proxy address before
  continuing.

A wrong or undeployed mastercopy would destroy destination-locking while every off-chain test
still passed. That is why these checks abort rather than warn.

### What did NOT change

Destination-locking, approve-blocking, and cap enforcement are untouched in substance. The
executor is still scoped to USDC `transfer()` only, to whitelisted destinations only, within the
per-tx cap. `scopeTarget` + `scopeFunction` and the condition tree carry the same meaning as
before; `approve()` is still blocked by never being allow-listed.

## Consequences

### Two latent bugs in the condition tree surfaced

`scopeFunction` had never actually executed before this change (deployment always failed
earlier), so its encoding was unverified. Both bugs would have prevented destination-locking
from being established at all:

1. **Root parameter type.** The tree was rooted at `ParameterType.AbiEncoded` (6). For scoping a
   function's own arguments the root must be `ParameterType.Calldata` (5); `AbiEncoded`
   describes a nested `abi.encode()` blob inside a parameter.
2. **Empty compValue encoding.** Nodes whose operator takes no operand (`Matches`, `Or`, `Pass`)
   were encoded with `compValue: "0x00"` — one byte, not empty. The on-chain `Integrity` library
   rejects that with `UnsuitableCompValue(0)`. The correct value is zero-length `"0x"`.

Both are fixed. The `Integrity` library now accepts the tree, confirmed by EVM trace.

### Known blocker: Roles 2.1.1 is incomplete on Base Sepolia

The canonical mastercopy links two libraries by address at compile time. On Base Sepolia the
**Packer library (`0x869718C9…`) has no code**, so `scopeFunction` reverts inside the mastercopy
with a delegatecall to a non-contract. Verified across chains:

| Chain | Mastercopy | Integrity | Packer |
| --- | --- | --- | --- |
| Base Sepolia (84532) | 24,409 B | 5,637 B | **MISSING** |
| Base mainnet (8453) | 24,409 B | 5,637 B | 2,138 B |
| Ethereum Sepolia (11155111) | 24,409 B | 5,637 B | 2,138 B |
| Ethereum (1) | 24,409 B | 5,637 B | 2,138 B |

The gap is in the vendor's Base Sepolia deployment, not in this repo. The library cannot be
redeployed to the required address from anything available: its CREATE2 address is a function of
the canonical creation bytecode, which the SDK does not ship (the SDK's Integrity build is
5,895 B vs the canonical 5,637 B — a different build), and neither the ERC-2470 nor the Nick
factory reproduces `0x869718C9…` from SDK bytecode.

The full stack was first verified end-to-end on an anvil fork of Base Sepolia with the canonical
Packer runtime installed at that address — a controlled experiment that changed exactly one
variable and confirmed the gap was the library, not this repo's code.

**Resolution: the target chain moved to Ethereum Sepolia.** See the Addendum.


---

## Addendum (2026-09-07) — target chain: Ethereum Sepolia

### Decision

The project targets **Ethereum Sepolia (chainId 11155111)** instead of Base Sepolia.

The authorization layer is chain-agnostic — mandate signing, the policy engine, and the audit
chain carry no Base-specific assumptions — so the target chain is a deployment parameter, not an
architectural commitment. Deploying against the complete, canonical, audited Roles stack is a
materially stronger security position than working around a partial vendor deployment, and it
keeps the `zodiac-roles-sdk` version and mastercopy provenance unchanged.

Rejected alternatives: waiting on Gnosis Guild to deploy Packer on Base Sepolia (external
dependency, no timeline); compiling and deploying our own Roles stack from source (replaces
audited canonical contracts with an unaudited local build in the safety-critical path — strictly
worse, and it was the EIP-170 size problem that started this).

### Cross-chain evidence

Canonical Roles 2.1.1 (`0xf2964ce6…`) and its two linked libraries, measured directly on each
chain. Mastercopy codehash is identical everywhere: `0x471d8b3b…`.

| Chain | Mastercopy | Integrity `0x6a6Af4b1…` | Packer `0x869718C9…` | Usable |
| --- | --- | --- | --- | --- |
| Base Sepolia (84532) | 24,409 B | 5,637 B | **MISSING (0 B)** | **No** |
| **Ethereum Sepolia (11155111)** | 24,409 B | 5,637 B | 2,138 B | **Yes** |
| Base mainnet (8453) | 24,409 B | 5,637 B | 2,138 B | Yes (mainnet — out of scope) |
| Ethereum (1) | 24,409 B | 5,637 B | 2,138 B | Yes (mainnet — out of scope) |

Base Sepolia is the only chain checked where the deployment is incomplete. `scopeFunction` — the
call that establishes destination-locking — reverts there with a delegatecall into an address
holding no code.

### Configuration changes

- `CHAIN` / `CHAIN_ID` → `sepolia` / 11155111.
- **USDC** → `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. Verified two ways before wiring in:
  against Circle's official contract-address documentation, and on-chain (`name` "USDC",
  `symbol` "USDC", `decimals` 6).
- `DEFAULT_RPC_URL` added to `src/chain/constants.ts`. The chain and its default RPC are now
  defined in exactly one place and imported by the adapter, scripts and tests, so the target
  network cannot drift between modules — the class of bug this ADR exists to prevent.
- Testnet-only still holds. Mainnet rows above are evidence, not targets.

### Unchanged

Registry-sourced mastercopy resolution, FAULTY rejection, and `verifyRolesMastercopy` are
untouched — they were re-run against Ethereum Sepolia and passed, resolving 2.1.1 with all five
required selectors present. The condition tree, destination-locking, approve-blocking and caps
are byte-for-byte the same logic proven on the fork.

### Deployment resumability

A transient RPC failure during the first live deployment left the Safe and proxy deployed and the
module enabled, but the role configuration incomplete. `scripts/deploy.ts` is now resumable:
`ROLES_MODIFIER_ADDRESS` adopts an existing proxy (asserting it has code first), and
`enableModule` is skipped when already enabled. This avoids paying for a second proxy and — more
importantly — avoids leaving a stale, unconfigured Roles module enabled on the Safe.

### Verified on-chain result

Deployed and confirmed on Ethereum Sepolia; ADV-C01–C09 pass against the deployed contracts. The
revert reasons are the guardrail itself, `ConditionViolation(uint8,bytes32)` (`0xd0a9bf58`), with
the specific status per rule:

| Case | Outcome | Roles status |
| --- | --- | --- |
| Transfer to non-whitelisted address | revert | `ParameterNotAllowed` |
| Transfer to whitelisted, in cap | succeeds | — |
| Transfer above per-tx cap | revert | `ParameterGreaterThanAllowed` |
| Transfer at exactly the cap | succeeds | — |
| `approve()` to whitelisted spender | revert | `FunctionNotAllowed` |
| `approve()` to rogue spender | revert | `FunctionNotAllowed` |

The guardrail discriminates per rule rather than failing uniformly — the boundary cases passing
is what makes the blocking cases meaningful.
