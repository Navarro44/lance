import { z } from "zod";
import type { Address, Hex } from "viem";

// ─── primitives ──────────────────────────────────────────────────────────────

/**
 * Ethereum address validated at runtime; typed as viem's Address in output.
 */
export const zAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x-prefixed 40-hex-char Ethereum address")
  .transform((s) => s as Address);

/**
 * Hex value (signature, hash, etc.) — 0x-prefixed, any length.
 */
export const zHex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, "Must be a 0x-prefixed hex string")
  .transform((s) => s as Hex);

/**
 * Token amount in the token's smallest unit (USDC = 6 decimals), serialised as
 * a decimal integer string to survive JSON without precision loss.
 * e.g. "1000000" = 1 USDC.
 */
export const zTokenAmount = z
  .string()
  .regex(/^\d+$/, "Amount must be a non-negative integer string (token base units)");

// ─── Mandate ─────────────────────────────────────────────────────────────────

/**
 * The cryptographic capture of human intent.
 *
 * Created once by the human / owner multisig and EIP-712 signed. Every
 * payment that flows through the system is checked against an active Mandate.
 * Changing a Mandate produces a new mandateId; old records stay immutable.
 */
export const MandateSchema = z.object({
  /** Stable identifier for this mandate version. */
  mandateId: z.string().uuid(),

  /** Ethereum address of the human/multisig that signed this mandate. */
  signerAddress: zAddress,

  /**
   * EIP-712 signature over the mandate body by signerAddress.
   * Empty string ("0x") until signing is complete (Phase 1).
   */
  signature: zHex,

  /**
   * Exhaustive list of approved payee addresses.
   * The executor is scoped on-chain to the same set (Zodiac Roles).
   * An empty whitelist makes every proposal escalate immediately.
   */
  whitelist: z.array(zAddress).min(1, "Mandate must have at least one approved payee"),

  /**
   * The single allowed payment token. v1 = USDC only.
   * On Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
   */
  token: zAddress,

  /**
   * Maximum value of a single payment, in token base units.
   * Policy engine rejects proposals that exceed this.
   */
  perTxCap: zTokenAmount,

  /**
   * Maximum aggregate value of all approved payments within one period,
   * in token base units. Policy engine tracks running spend.
   */
  perPeriodCap: zTokenAmount,

  /**
   * Length of the rolling spending period in seconds.
   * e.g. 86400 = 1 day, 2592000 = 30 days.
   */
  periodSeconds: z.number().int().positive(),

  /**
   * Unix timestamp after which this mandate is invalid and all proposals
   * must escalate.
   */
  expiresAt: z.number().int().positive(),

  /** Unix timestamp when this mandate was created. */
  createdAt: z.number().int().positive(),

  /** Chain ID this mandate is scoped to. Proposal/mandate chain IDs must match. */
  chainId: z.number().int().positive(),
});

export type Mandate = z.infer<typeof MandateSchema>;
