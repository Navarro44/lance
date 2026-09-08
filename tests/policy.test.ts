/**
 * Policy engine test suite — happy paths + the adversarial gauntlet.
 *
 * The adversarial section tracks every case that must NOT produce APPROVE.
 * afterAll prints: "N unauthorized approvals across M adversarial cases"
 * and fails if N > 0.
 */

import { describe, it, expect, afterAll } from "vitest";
import { checkPolicy, escalateUnverifiedMandate } from "../src/policy/index.js";
import {
  mandateFixture,
  expiredMandateFixture,
  proposalFixture,
  ROGUE_ADDRESS,
  SUPPLIER_A,
  SUPPLIER_B,
} from "../src/types/index.js";
import type { Mandate, PaymentProposal } from "../src/types/index.js";
import { PaymentProposalSchema } from "../src/types/index.js";

// ─── shared test helpers ──────────────────────────────────────────────────────

/** A base valid mandate for policy tests (uses fixture values but re-stated for clarity). */
const mandate: Mandate = { ...mandateFixture };
// perTxCap = "500000000" (500 USDC), perPeriodCap = "5000000000" (5000 USDC)

/** A base valid proposal: 100 USDC to SUPPLIER_A. */
const proposal: PaymentProposal = { ...proposalFixture };

/** A fresh proposalId for tests that need uniqueness. */
let seq = 0;
const freshId = () => `b2c3d4e5-ffff-ffff-ffff-${String(++seq).padStart(12, "0")}`;

function makeProposal(overrides: Partial<PaymentProposal> = {}): PaymentProposal {
  return {
    ...proposal,
    proposalId: freshId(),
    ...overrides,
  };
}

// ─── adversarial tracking ─────────────────────────────────────────────────────

type AdversarialResult = { name: string; wronglyApproved: boolean };
const adversarialCases: AdversarialResult[] = [];

/** Call in every adversarial test after getting a decision. */
function trackAdversarial(name: string, verdict: string) {
  adversarialCases.push({ name, wronglyApproved: verdict === "APPROVE" });
}

afterAll(() => {
  const unauthorized = adversarialCases.filter((c) => c.wronglyApproved);
  const n = unauthorized.length;
  const total = adversarialCases.length;
  console.log(`\n  ✓ ${n} unauthorized approvals across ${total} adversarial cases`);
  if (n > 0) {
    console.error("  ✗ FAILED cases:", unauthorized.map((c) => c.name).join(", "));
  }
  expect(n, "No adversarial case should produce APPROVE").toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy-path tests (not adversarial — just verify the engine approves valid input)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkPolicy — happy paths", () => {
  it("approves a valid proposal with zero prior spend", () => {
    const d = checkPolicy(makeProposal(), mandate, "0");
    expect(d.verdict).toBe("APPROVE");
    expect(d.reasonCode).toBe("WITHIN_MANDATE");
    expect(d.periodSpendAfter).toBe("100000000"); // 100 USDC
  });

  it("accumulates period spend correctly across approvals", () => {
    let spend = "0";
    for (let i = 0; i < 3; i++) {
      const d = checkPolicy(makeProposal({ amount: "100000000" }), mandate, spend);
      expect(d.verdict).toBe("APPROVE");
      spend = d.periodSpendAfter!;
    }
    expect(spend).toBe("300000000"); // 300 USDC
  });

  it("approves a proposal where amount exactly equals perTxCap", () => {
    const d = checkPolicy(makeProposal({ amount: mandate.perTxCap }), mandate, "0");
    expect(d.verdict).toBe("APPROVE");
  });

  it("approves any whitelisted payee", () => {
    const a = checkPolicy(makeProposal({ payee: SUPPLIER_A }), mandate, "0");
    const b = checkPolicy(makeProposal({ payee: SUPPLIER_B }), mandate, "0");
    expect(a.verdict).toBe("APPROVE");
    expect(b.verdict).toBe("APPROVE");
  });

  it("returns a valid PolicyDecision shape on approve", () => {
    const p = makeProposal();
    const d = checkPolicy(p, mandate, "0");
    expect(d.decisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.proposalId).toBe(p.proposalId);
    expect(d.mandateId).toBe(mandate.mandateId);
    expect(d.checkedAt).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL SUITE — every test here must NOT produce APPROVE
// ─────────────────────────────────────────────────────────────────────────────

describe("checkPolicy — adversarial: per-tx cap", () => {
  it("[ADV-01] rejects amount = perTxCap + 1", () => {
    const name = "ADV-01: amount = perTxCap + 1";
    const over = (BigInt(mandate.perTxCap) + 1n).toString();
    const d = checkPolicy(makeProposal({ amount: over }), mandate, "0");
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("AMOUNT_EXCEEDS_PER_TX_CAP");
  });

  it("[ADV-02] rejects amount = 2 × perTxCap", () => {
    const name = "ADV-02: amount = 2 × perTxCap";
    const over = (BigInt(mandate.perTxCap) * 2n).toString();
    const d = checkPolicy(makeProposal({ amount: over }), mandate, "0");
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("AMOUNT_EXCEEDS_PER_TX_CAP");
  });
});

describe("checkPolicy — adversarial: per-period cap", () => {
  it("[ADV-03] rejects when amount alone exceeds perPeriodCap", () => {
    const name = "ADV-03: amount > perPeriodCap (no prior spend)";
    const over = (BigInt(mandate.perPeriodCap) + 1n).toString();
    const d = checkPolicy(makeProposal({ amount: over }), mandate, "0");
    trackAdversarial(name, d.verdict);
    // will actually hit per-tx cap first, but still not APPROVE
    expect(d.verdict).toBe("REJECT");
  });

  it("[ADV-04] rejects when prior spend + amount exceeds perPeriodCap by 1", () => {
    const name = "ADV-04: priorSpend + amount = perPeriodCap + 1";
    // prior spend = perPeriodCap - 1, new amount = 2 → total = perPeriodCap + 1
    const priorSpend = (BigInt(mandate.perPeriodCap) - 1n).toString();
    const d = checkPolicy(makeProposal({ amount: "2" }), mandate, priorSpend);
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("AMOUNT_EXCEEDS_PERIOD_CAP");
  });

  it("[ADV-05] period cap exhaustion across multiple proposals (3rd rejected)", () => {
    const name = "ADV-05: period cap exhausted across 3 proposals";
    // Use a mandate with perTxCap = 2000 USDC to allow 2000-USDC proposals.
    // 3 × 2000 = 6000 > perPeriodCap of 5000 → third rejected.
    const wideCap: Mandate = {
      ...mandate,
      perTxCap: "2000000000", // 2000 USDC per tx
      // perPeriodCap stays at 5000 USDC
    };
    const amount = "2000000000"; // 2000 USDC
    let spend = "0";

    // First two should approve (2000, then 4000)
    for (let i = 0; i < 2; i++) {
      const d = checkPolicy(makeProposal({ amount }), wideCap, spend);
      expect(d.verdict).toBe("APPROVE");
      spend = d.periodSpendAfter!;
    }
    expect(spend).toBe("4000000000"); // 4000 USDC spent

    // Third proposal: 4000 + 2000 = 6000 > 5000 cap → REJECT
    const d3 = checkPolicy(makeProposal({ amount }), wideCap, spend);
    trackAdversarial(name, d3.verdict);
    expect(d3.verdict).toBe("REJECT");
    expect(d3.reasonCode).toBe("AMOUNT_EXCEEDS_PERIOD_CAP");
  });

  it("[ADV-06] period cap at exact exhaustion: priorSpend = perPeriodCap, any amount rejected", () => {
    const name = "ADV-06: priorSpend = perPeriodCap, amount = 1";
    const d = checkPolicy(makeProposal({ amount: "1" }), mandate, mandate.perPeriodCap);
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("AMOUNT_EXCEEDS_PERIOD_CAP");
  });
});

describe("checkPolicy — adversarial: payee whitelist", () => {
  it("[ADV-07] rejects a non-whitelisted payee", () => {
    const name = "ADV-07: payee not on whitelist";
    const d = checkPolicy(makeProposal({ payee: ROGUE_ADDRESS }), mandate, "0");
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("PAYEE_NOT_WHITELISTED");
  });

  it("[ADV-08] rejects a zero address payee", () => {
    const name = "ADV-08: payee = zero address";
    const d = checkPolicy(
      makeProposal({ payee: "0x0000000000000000000000000000000000000000" }),
      mandate,
      "0",
    );
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("PAYEE_NOT_WHITELISTED");
  });
});

describe("checkPolicy — adversarial: token", () => {
  it("[ADV-09] rejects a proposal with the wrong token", () => {
    const name = "ADV-09: token mismatch";
    const wrongToken = "0x4200000000000000000000000000000000000006"; // WETH on Base
    const d = checkPolicy(makeProposal({ token: wrongToken }), mandate, "0");
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("TOKEN_MISMATCH");
  });
});

describe("checkPolicy — adversarial: mandate expiry", () => {
  it("[ADV-10] rejects a proposal whose timestamp equals expiresAt (boundary is expired)", () => {
    const name = "ADV-10: proposal.timestamp === mandate.expiresAt";
    const d = checkPolicy(
      makeProposal({
        mandateId: expiredMandateFixture.mandateId,
        timestamp: expiredMandateFixture.expiresAt,
      }),
      expiredMandateFixture,
      "0",
    );
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("MANDATE_EXPIRED");
  });

  it("[ADV-11] rejects a proposal whose timestamp is 1 second past expiresAt", () => {
    const name = "ADV-11: proposal.timestamp = expiresAt + 1";
    const d = checkPolicy(
      makeProposal({
        mandateId: expiredMandateFixture.mandateId,
        timestamp: expiredMandateFixture.expiresAt + 1,
      }),
      expiredMandateFixture,
      "0",
    );
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("MANDATE_EXPIRED");
  });

  it("[ADV-12] rejects any proposal against an expired mandate regardless of amount", () => {
    const name = "ADV-12: minimum amount against expired mandate";
    const d = checkPolicy(
      makeProposal({
        mandateId: expiredMandateFixture.mandateId,
        amount: "1",
        timestamp: expiredMandateFixture.expiresAt,
      }),
      expiredMandateFixture,
      "0",
    );
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("MANDATE_EXPIRED");
  });
});

describe("checkPolicy — adversarial: replay protection", () => {
  it("[ADV-13] rejects a proposal whose proposalId has already been processed", () => {
    const name = "ADV-13: replay of already-processed proposalId";
    const seen = new Set([proposal.proposalId]);
    const d = checkPolicy(proposal, mandate, "0", seen);
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("PROPOSAL_ALREADY_PROCESSED");
  });

  it("[ADV-14] replay rejection is independent of other proposal fields", () => {
    const name = "ADV-14: replay with different amount still rejected";
    // even if the amount is now within bounds, the proposalId replay wins
    const seen = new Set([proposal.proposalId]);
    const d = checkPolicy({ ...proposal, amount: "1" }, mandate, "0", seen);
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("PROPOSAL_ALREADY_PROCESSED");
  });
});

describe("checkPolicy — adversarial: structural mismatches", () => {
  it("[ADV-15] rejects when proposal.mandateId ≠ mandate.mandateId", () => {
    const name = "ADV-15: mandateId mismatch";
    const d = checkPolicy(
      makeProposal({ mandateId: "00000000-0000-0000-0000-000000000000" }),
      mandate,
      "0",
    );
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("MANDATE_ID_MISMATCH");
  });

  it("[ADV-16] rejects when proposal.chainId ≠ mandate.chainId", () => {
    const name = "ADV-16: chainId mismatch (proposal on mainnet, mandate on Sepolia)";
    const d = checkPolicy(makeProposal({ chainId: 1 }), mandate, "0");
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("CHAIN_MISMATCH");
  });
});

describe("checkPolicy — adversarial: zero and malformed amounts", () => {
  it("[ADV-17] rejects a zero-amount proposal", () => {
    const name = "ADV-17: amount = 0";
    const d = checkPolicy(makeProposal({ amount: "0" }), mandate, "0");
    trackAdversarial(name, d.verdict);
    expect(d.verdict).toBe("REJECT");
    expect(d.reasonCode).toBe("ZERO_AMOUNT");
  });
});

describe("checkPolicy — adversarial: pre-engine schema failures", () => {
  it("[ADV-18] malformed proposal (decimal amount) fails schema parse before reaching engine", () => {
    const name = "ADV-18: schema rejects decimal amount string";
    const result = PaymentProposalSchema.safeParse({
      ...proposal,
      proposalId: freshId(),
      amount: "100.50",
    });
    // Track this as adversarial — it never reaches the engine, which is the point
    adversarialCases.push({ name, wronglyApproved: result.success });
    expect(result.success).toBe(false);
  });

  it("[ADV-19] malformed proposal (invalid payee) fails schema parse", () => {
    const name = "ADV-19: schema rejects invalid payee address";
    const result = PaymentProposalSchema.safeParse({
      ...proposal,
      proposalId: freshId(),
      payee: "not-an-address",
    });
    adversarialCases.push({ name, wronglyApproved: result.success });
    expect(result.success).toBe(false);
  });

  it("[ADV-20] malformed proposal (empty rationale) fails schema parse", () => {
    const name = "ADV-20: schema rejects empty rationale";
    const result = PaymentProposalSchema.safeParse({
      ...proposal,
      proposalId: freshId(),
      rationale: "",
    });
    adversarialCases.push({ name, wronglyApproved: result.success });
    expect(result.success).toBe(false);
  });
});

// ─── escalateUnverifiedMandate ────────────────────────────────────────────────

describe("escalateUnverifiedMandate", () => {
  it("returns an ESCALATE decision with MANDATE_SIGNATURE_UNVERIFIED", () => {
    const d = escalateUnverifiedMandate(proposal.proposalId, mandate.mandateId);
    expect(d.verdict).toBe("ESCALATE");
    expect(d.reasonCode).toBe("MANDATE_SIGNATURE_UNVERIFIED");
    expect(d.periodSpendAfter).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant checks — properties that must hold across all verdicts
// ─────────────────────────────────────────────────────────────────────────────

describe("checkPolicy — invariants", () => {
  it("periodSpendAfter is null on every REJECT", () => {
    const cases = [
      checkPolicy(makeProposal({ payee: ROGUE_ADDRESS }), mandate, "0"),
      checkPolicy(makeProposal({ amount: "600000000" }), mandate, "0"),
      checkPolicy(makeProposal(), expiredMandateFixture, "0"),
    ];
    for (const d of cases) {
      expect(d.verdict).toBe("REJECT");
      expect(d.periodSpendAfter).toBeNull();
    }
  });

  it("periodSpendAfter is a valid integer string on APPROVE", () => {
    const d = checkPolicy(makeProposal(), mandate, "0");
    expect(d.verdict).toBe("APPROVE");
    expect(d.periodSpendAfter).toMatch(/^\d+$/);
  });

  it("each decision has a unique decisionId", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const d = checkPolicy(makeProposal(), mandate, "0");
      expect(ids.has(d.decisionId)).toBe(false);
      ids.add(d.decisionId);
    }
  });

  it("rejected proposals do not accumulate period spend (caller must not count them)", () => {
    // The engine itself just validates — it's the caller's responsibility not to
    // count rejected proposals. We verify the engine returns null on REJECT.
    let spend = "0";
    const r1 = checkPolicy(makeProposal({ payee: ROGUE_ADDRESS }), mandate, spend);
    expect(r1.verdict).toBe("REJECT");
    // spend should not change after a rejection (caller keeps old spend)
    const r2 = checkPolicy(makeProposal(), mandate, spend);
    expect(r2.verdict).toBe("APPROVE");
    expect(r2.periodSpendAfter).toBe("100000000"); // still correct
  });

  it("whitelist matching is case-insensitive", () => {
    const upperPayee = SUPPLIER_A.toUpperCase() as `0x${string}`;
    // The mandate whitelist has checksummed addresses; engine normalises to lowercase
    const d = checkPolicy(makeProposal({ payee: upperPayee }), mandate, "0");
    expect(d.verdict).toBe("APPROVE");
  });
});
