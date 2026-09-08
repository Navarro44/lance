import type { Mandate } from "./mandate.js";
import type { PaymentProposal } from "./proposal.js";
import type { PolicyDecision } from "./policy.js";
import type { AuditRecord } from "./audit.js";

// ─── shared constants ─────────────────────────────────────────────────────────

/** Test USDC on Ethereum Sepolia (Circle's official deployment). */
export const TEST_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;

/** Ethereum Sepolia chain ID. */
export const TEST_CHAIN_ID = 11155111 as const;

/** A whitelisted supplier address (fictional — testnet only). */
export const SUPPLIER_A = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B" as const;
/** A second whitelisted supplier (fictional — testnet only). */
export const SUPPLIER_B = "0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c" as const;

/** A non-whitelisted address — every PAYEE_NOT_WHITELISTED test uses this. */
export const ROGUE_ADDRESS = "0x4B0897b0513fdC7C541B6d9D7E929C4e5364D2dB" as const;

/** Signer address — the "human" who created the mandate. */
export const SIGNER_ADDRESS = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as const;

// ─── timestamps (static — no Date.now() in fixtures) ─────────────────────────

const CREATED_AT = 1748390400; // 2025-05-27 UTC
const EXPIRES_AT = 1798761600; // 2027-01-01 UTC — well in the future
const CHECKED_AT = 1748390401;
const RECORD_AT = 1748390402;

// ─── Mandate fixtures ─────────────────────────────────────────────────────────

/** A valid, active mandate with two whitelisted suppliers. */
export const mandateFixture: Mandate = {
  mandateId: "a1b2c3d4-0001-0001-0001-000000000001",
  signerAddress: SIGNER_ADDRESS,
  signature: "0x",
  whitelist: [SUPPLIER_A, SUPPLIER_B],
  token: TEST_USDC,
  perTxCap: "500000000", // 500 USDC (6 decimals)
  perPeriodCap: "5000000000", // 5000 USDC per period
  period: { windowType: "rolling", durationSeconds: 86400 }, // 1-day rolling window
  expiresAt: EXPIRES_AT,
  createdAt: CREATED_AT,
  chainId: TEST_CHAIN_ID,
};

/** An expired mandate — every MANDATE_EXPIRED test uses this. */
export const expiredMandateFixture: Mandate = {
  ...mandateFixture,
  mandateId: "a1b2c3d4-0001-0001-0001-000000000002",
  expiresAt: 1700000000, // 2023-11-14 — safely in the past
};

/** A mandate with a fixed calendar window — used for period-boundary tests. */
export const fixedWindowMandateFixture: Mandate = {
  ...mandateFixture,
  mandateId: "a1b2c3d4-0001-0001-0001-000000000003",
  period: {
    windowType: "fixed",
    durationSeconds: 86400, // 1-day fixed windows
    anchorTimestamp: CREATED_AT, // windows start from CREATED_AT
  },
};

// ─── PaymentProposal fixtures ─────────────────────────────────────────────────

/** A valid proposal: whitelisted payee, under cap, matching mandate. */
export const proposalFixture: PaymentProposal = {
  proposalId: "b2c3d4e5-0002-0002-0002-000000000001",
  mandateId: mandateFixture.mandateId,
  payee: SUPPLIER_A,
  amount: "100000000", // 100 USDC
  token: TEST_USDC,
  rationale: "Monthly SaaS subscription invoice INV-2025-042 from Supplier A.",
  requestSource: "invoice:INV-2025-042",
  timestamp: CREATED_AT,
  chainId: TEST_CHAIN_ID,
};

/** A proposal to a non-whitelisted address — must always be rejected. */
export const rogueProposalFixture: PaymentProposal = {
  ...proposalFixture,
  proposalId: "b2c3d4e5-0002-0002-0002-000000000002",
  payee: ROGUE_ADDRESS,
  rationale: "Paying a legitimate supplier for services rendered.",
};

/** A proposal that exceeds the per-tx cap — must be rejected. */
export const overCapProposalFixture: PaymentProposal = {
  ...proposalFixture,
  proposalId: "b2c3d4e5-0002-0002-0002-000000000003",
  amount: "600000000", // 600 USDC — over the 500 USDC perTxCap
  rationale: "Large one-off payment for annual contract.",
};

// ─── PolicyDecision fixtures ──────────────────────────────────────────────────

/** An APPROVE decision for the valid proposal. */
export const approveDecisionFixture: PolicyDecision = {
  decisionId: "c3d4e5f6-0003-0003-0003-000000000001",
  proposalId: proposalFixture.proposalId,
  mandateId: mandateFixture.mandateId,
  verdict: "APPROVE",
  reasonCode: "WITHIN_MANDATE",
  reason: "Proposal is within all mandate bounds.",
  checkedAt: CHECKED_AT,
  periodSpendAfter: "100000000",
};

/** A REJECT decision for the rogue proposal. */
export const rejectDecisionFixture: PolicyDecision = {
  decisionId: "c3d4e5f6-0003-0003-0003-000000000002",
  proposalId: rogueProposalFixture.proposalId,
  mandateId: mandateFixture.mandateId,
  verdict: "REJECT",
  reasonCode: "PAYEE_NOT_WHITELISTED",
  reason: `Payee ${ROGUE_ADDRESS} is not on the mandate whitelist.`,
  checkedAt: CHECKED_AT,
  periodSpendAfter: null,
};

// ─── AuditRecord fixtures ─────────────────────────────────────────────────────

/** First record in a new log — no previousHash. */
export const firstAuditRecordFixture: AuditRecord = {
  recordId: "d4e5f6a7-0004-0004-0004-000000000001",
  sequenceNumber: 0,
  proposalId: proposalFixture.proposalId,
  proposal: proposalFixture,
  decision: approveDecisionFixture,
  mandateId: mandateFixture.mandateId,
  mandateSnapshot: mandateFixture,
  txHash: null,
  previousHash: null,
  recordHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  createdAt: RECORD_AT,
};

/** Second record — linked to the first via previousHash. */
export const secondAuditRecordFixture: AuditRecord = {
  recordId: "d4e5f6a7-0004-0004-0004-000000000002",
  sequenceNumber: 1,
  proposalId: rogueProposalFixture.proposalId,
  proposal: rogueProposalFixture,
  decision: rejectDecisionFixture,
  mandateId: mandateFixture.mandateId,
  mandateSnapshot: mandateFixture,
  txHash: null,
  previousHash: firstAuditRecordFixture.recordHash,
  recordHash: "0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
  createdAt: RECORD_AT + 1,
};
