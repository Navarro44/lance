import { describe, it, expect } from "vitest";
import {
  MandateSchema,
  PaymentProposalSchema,
  PolicyDecisionSchema,
  AuditRecordSchema,
  mandateFixture,
  expiredMandateFixture,
  proposalFixture,
  rogueProposalFixture,
  overCapProposalFixture,
  approveDecisionFixture,
  rejectDecisionFixture,
  firstAuditRecordFixture,
  secondAuditRecordFixture,
  TEST_USDC,
  BASE_SEPOLIA_CHAIN_ID,
} from "../src/types/index.js";

// ─── Mandate ──────────────────────────────────────────────────────────────────

describe("MandateSchema", () => {
  it("accepts the valid mandate fixture", () => {
    const result = MandateSchema.safeParse(mandateFixture);
    expect(result.success).toBe(true);
  });

  it("accepts the expired mandate fixture", () => {
    const result = MandateSchema.safeParse(expiredMandateFixture);
    expect(result.success).toBe(true);
  });

  it("rejects a mandate with no whitelist entries", () => {
    const result = MandateSchema.safeParse({ ...mandateFixture, whitelist: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a mandate with a non-hex address in the whitelist", () => {
    const result = MandateSchema.safeParse({
      ...mandateFixture,
      whitelist: ["not-an-address"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a mandate with a non-integer amount string", () => {
    const result = MandateSchema.safeParse({ ...mandateFixture, perTxCap: "100.5" });
    expect(result.success).toBe(false);
  });

  it("rejects a mandate with a negative period", () => {
    const result = MandateSchema.safeParse({ ...mandateFixture, periodSeconds: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a mandate missing required fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mandateId: _id, ...withoutId } = mandateFixture;
    const result = MandateSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it("validates address output is checksummed (viem Address type flows through)", () => {
    const result = MandateSchema.safeParse(mandateFixture);
    if (!result.success) throw new Error("Should have parsed");
    expect(result.data.token).toBe(TEST_USDC);
    expect(result.data.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
  });
});

// ─── PaymentProposal ──────────────────────────────────────────────────────────

describe("PaymentProposalSchema", () => {
  it("accepts the valid proposal fixture", () => {
    const result = PaymentProposalSchema.safeParse(proposalFixture);
    expect(result.success).toBe(true);
  });

  it("accepts the rogue proposal fixture (validation doesn't enforce whitelist)", () => {
    // Schema validation is structural only; business rule enforcement is the policy engine's job.
    const result = PaymentProposalSchema.safeParse(rogueProposalFixture);
    expect(result.success).toBe(true);
  });

  it("accepts the over-cap proposal fixture (schema doesn't know the cap)", () => {
    const result = PaymentProposalSchema.safeParse(overCapProposalFixture);
    expect(result.success).toBe(true);
  });

  it("rejects a proposal with an empty rationale", () => {
    const result = PaymentProposalSchema.safeParse({ ...proposalFixture, rationale: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a proposal with amount '0.5' (non-integer string)", () => {
    const result = PaymentProposalSchema.safeParse({ ...proposalFixture, amount: "0.5" });
    expect(result.success).toBe(false);
  });

  it("rejects a proposal with a malformed payee address", () => {
    const result = PaymentProposalSchema.safeParse({
      ...proposalFixture,
      payee: "0xshort",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a proposal with a non-UUID proposalId", () => {
    const result = PaymentProposalSchema.safeParse({
      ...proposalFixture,
      proposalId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

// ─── PolicyDecision ───────────────────────────────────────────────────────────

describe("PolicyDecisionSchema", () => {
  it("accepts the APPROVE decision fixture", () => {
    const result = PolicyDecisionSchema.safeParse(approveDecisionFixture);
    expect(result.success).toBe(true);
  });

  it("accepts the REJECT decision fixture", () => {
    const result = PolicyDecisionSchema.safeParse(rejectDecisionFixture);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown verdict", () => {
    const result = PolicyDecisionSchema.safeParse({
      ...approveDecisionFixture,
      verdict: "MAYBE",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown reason code", () => {
    const result = PolicyDecisionSchema.safeParse({
      ...approveDecisionFixture,
      reasonCode: "INVENTED_REASON",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null periodSpendAfter on a REJECT", () => {
    const result = PolicyDecisionSchema.safeParse(rejectDecisionFixture);
    if (!result.success) throw new Error("Should have parsed");
    expect(result.data.periodSpendAfter).toBeNull();
  });

  it("accepts a string periodSpendAfter on an APPROVE", () => {
    const result = PolicyDecisionSchema.safeParse(approveDecisionFixture);
    if (!result.success) throw new Error("Should have parsed");
    expect(result.data.periodSpendAfter).toBe("100000000");
  });
});

// ─── AuditRecord ──────────────────────────────────────────────────────────────

describe("AuditRecordSchema", () => {
  it("accepts the first audit record fixture (null previousHash)", () => {
    const result = AuditRecordSchema.safeParse(firstAuditRecordFixture);
    expect(result.success).toBe(true);
  });

  it("accepts the second audit record fixture (linked previousHash)", () => {
    const result = AuditRecordSchema.safeParse(secondAuditRecordFixture);
    expect(result.success).toBe(true);
  });

  it("rejects an audit record with a non-hex recordHash", () => {
    const result = AuditRecordSchema.safeParse({
      ...firstAuditRecordFixture,
      recordHash: "not-a-hex-string",
    });
    expect(result.success).toBe(false);
  });

  it("second record's previousHash matches first record's recordHash", () => {
    expect(secondAuditRecordFixture.previousHash).toBe(firstAuditRecordFixture.recordHash);
  });

  it("sequence numbers are correct", () => {
    expect(firstAuditRecordFixture.sequenceNumber).toBe(0);
    expect(secondAuditRecordFixture.sequenceNumber).toBe(1);
  });

  it("accepts null txHash on a REJECT record", () => {
    const result = AuditRecordSchema.safeParse(secondAuditRecordFixture);
    if (!result.success) throw new Error("Should have parsed");
    expect(result.data.txHash).toBeNull();
  });
});
