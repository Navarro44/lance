import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import {
  signMandate,
  verifyMandate,
  mandateToEIP712Message,
  MANDATE_TYPES,
} from "../src/mandate/index.js";
import { mandateFixture, BASE_SEPOLIA_CHAIN_ID } from "../src/types/index.js";
import type { Mandate } from "../src/types/index.js";

// ─── test credentials ─────────────────────────────────────────────────────────
// Standard Hardhat/Foundry test key #0. Never use for real funds.
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const TEST_SIGNER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** Mandate with our test signer address (unsigned — explicitly no signature field). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { signature: _sig, ...mandateBody } = mandateFixture;
const unsignedMandate: Omit<Mandate, "signature"> = {
  ...mandateBody,
  signerAddress: TEST_SIGNER_ADDRESS,
};

// ─── signMandate ──────────────────────────────────────────────────────────────

describe("signMandate", () => {
  it("returns a mandate with a non-empty signature", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    expect(signed.signature).not.toBe("0x");
    expect(signed.signature).toMatch(/^0x[0-9a-fA-F]{130}$/); // 65-byte ECDSA sig
  });

  it("preserves all other fields unchanged", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const { signature: _sig, ...rest } = signed;
    expect(rest).toEqual(unsignedMandate);
  });

  it("produces a deterministic signature for the same input", async () => {
    const a = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const b = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    // EIP-712 + secp256k1 with deterministic nonce (RFC 6979) → same sig each time
    expect(a.signature).toBe(b.signature);
  });
});

// ─── verifyMandate ────────────────────────────────────────────────────────────

describe("verifyMandate", () => {
  it("returns true for a correctly signed mandate", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    expect(await verifyMandate(signed)).toBe(true);
  });

  it("returns false for an unsigned mandate (signature = '0x')", async () => {
    const unsigned: Mandate = { ...unsignedMandate, signature: "0x" };
    expect(await verifyMandate(unsigned)).toBe(false);
  });

  it("returns false when mandateId is tampered after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      mandateId: "99999999-9999-9999-9999-999999999999",
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false when whitelist is tampered after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      whitelist: ["0xdead000000000000000000000000000000000001"],
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false when perTxCap is tampered after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      perTxCap: "999999999999", // inflated cap
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false when perPeriodCap is tampered after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      perPeriodCap: "999999999999",
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false when expiresAt is tampered (extended) after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      expiresAt: 9999999999, // extended expiry
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false when chainId is tampered after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      chainId: 1, // mainnet
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false when the period window type is tampered after signing", async () => {
    const signed = await signMandate(unsignedMandate, TEST_PRIVATE_KEY);
    const tampered: Mandate = {
      ...signed,
      period: { windowType: "fixed", durationSeconds: 86400, anchorTimestamp: 0 },
    };
    expect(await verifyMandate(tampered)).toBe(false);
  });

  it("returns false for a garbage signature string", async () => {
    const bad: Mandate = {
      ...unsignedMandate,
      signature:
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00",
    };
    expect(await verifyMandate(bad)).toBe(false);
  });
});

// ─── mandateToEIP712Message ───────────────────────────────────────────────────

describe("mandateToEIP712Message", () => {
  it("encodes all uint256 fields as BigInt", () => {
    const msg = mandateToEIP712Message(unsignedMandate);
    expect(typeof msg.perTxCap).toBe("bigint");
    expect(typeof msg.perPeriodCap).toBe("bigint");
    expect(typeof msg.expiresAt).toBe("bigint");
    expect(typeof msg.chainId).toBe("bigint");
  });

  it("sets periodAnchor to 0n for a rolling window", () => {
    const msg = mandateToEIP712Message(unsignedMandate);
    expect(msg.periodAnchor).toBe(0n);
    expect(msg.periodWindowType).toBe("rolling");
  });

  it("encodes anchorTimestamp for a fixed window", () => {
    const fixedMandate: Omit<Mandate, "signature"> = {
      ...unsignedMandate,
      period: { windowType: "fixed", durationSeconds: 86400, anchorTimestamp: 1748390400 },
    };
    const msg = mandateToEIP712Message(fixedMandate);
    expect(msg.periodAnchor).toBe(1748390400n);
    expect(msg.periodWindowType).toBe("fixed");
  });

  it("covers all fields defined in MANDATE_TYPES", () => {
    const msg = mandateToEIP712Message(unsignedMandate);
    const expectedKeys = MANDATE_TYPES.Mandate.map((f) => f.name);
    for (const key of expectedKeys) {
      expect(msg).toHaveProperty(key);
    }
  });

  it("chainId in the message matches the mandate chainId", () => {
    const msg = mandateToEIP712Message(unsignedMandate);
    expect(msg.chainId).toBe(BigInt(BASE_SEPOLIA_CHAIN_ID));
  });
});
