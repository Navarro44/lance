import type { Mandate } from "../types/index.js";

// ─── EIP-712 domain ───────────────────────────────────────────────────────────

export const MANDATE_DOMAIN_NAME = "LanceMandate";
export const MANDATE_DOMAIN_VERSION = "1";

/**
 * Returns the EIP-712 domain for a given chain.
 * No verifyingContract — these are off-chain authorisation signatures.
 */
export function getMandateDomain(chainId: number) {
  return {
    name: MANDATE_DOMAIN_NAME,
    version: MANDATE_DOMAIN_VERSION,
    chainId,
  } as const;
}

// ─── EIP-712 typed data ───────────────────────────────────────────────────────

/**
 * Flat EIP-712 type definition for Mandate.
 *
 * The nested period object is flattened to avoid EIP-712 nested struct
 * complexity. periodAnchor is 0 for rolling windows (deterministic).
 *
 * chainId is included in both the domain (chain binding) and the message
 * (explicit, tamper-evident scoping checked by the policy engine).
 */
export const MANDATE_TYPES = {
  Mandate: [
    { name: "mandateId", type: "string" },
    { name: "signerAddress", type: "address" },
    { name: "whitelist", type: "address[]" },
    { name: "token", type: "address" },
    { name: "perTxCap", type: "uint256" },
    { name: "perPeriodCap", type: "uint256" },
    { name: "periodWindowType", type: "string" },
    { name: "periodDuration", type: "uint256" },
    { name: "periodAnchor", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "createdAt", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

// ─── message builder ──────────────────────────────────────────────────────────

/**
 * Converts a Mandate to the flat EIP-712 message format.
 * All uint256 fields are BigInt (required by viem's signTypedData).
 * The signature field is excluded — it's not part of the signed content.
 */
export function mandateToEIP712Message(mandate: Omit<Mandate, "signature">) {
  const { period } = mandate;
  return {
    mandateId: mandate.mandateId,
    signerAddress: mandate.signerAddress,
    whitelist: mandate.whitelist,
    token: mandate.token,
    perTxCap: BigInt(mandate.perTxCap),
    perPeriodCap: BigInt(mandate.perPeriodCap),
    periodWindowType: period.windowType,
    periodDuration: BigInt(period.durationSeconds),
    periodAnchor: BigInt(period.windowType === "fixed" ? period.anchorTimestamp : 0),
    expiresAt: BigInt(mandate.expiresAt),
    createdAt: BigInt(mandate.createdAt),
    chainId: BigInt(mandate.chainId),
  };
}
