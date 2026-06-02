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

// ─── Period window ────────────────────────────────────────────────────────────

/**
 * Explicit period window definition — makes "per-period cap" unambiguous.
 *
 * rolling — the window is always the last `durationSeconds` from the proposal
 *           timestamp. No anchor needed.
 *
 * fixed   — the window is a fixed calendar slot: window 0 = [anchor, anchor +
 *           durationSeconds), window 1 = [anchor + duration, anchor + 2×duration), …
 *           The caller finds which slot the proposal falls in and sums prior spend
 *           in that slot.
 */
export const MandatePeriodSchema = z.discriminatedUnion("windowType", [
  z.object({
    windowType: z.literal("rolling"),
    durationSeconds: z.number().int().positive(),
  }),
  z.object({
    windowType: z.literal("fixed"),
    durationSeconds: z.number().int().positive(),
    /** Unix timestamp of the start of the first window. */
    anchorTimestamp: z.number().int().nonnegative(),
  }),
]);

export type MandatePeriod = z.infer<typeof MandatePeriodSchema>;

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
   * "0x" until the mandate is signed (use signMandate from src/mandate).
   */
  signature: zHex,

  /**
   * Exhaustive list of approved payee addresses.
   * The executor is scoped on-chain to the same set (Zodiac Roles).
   * An empty whitelist makes every proposal reject immediately.
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
   * Maximum aggregate value of all approved payments within one period window,
   * in token base units. Caller derives period spend from the audit log and
   * passes it into checkPolicy; the engine validates against it.
   */
  perPeriodCap: zTokenAmount,

  /**
   * Explicit period window definition.
   * The period type (rolling vs fixed-calendar), duration, and anchor are all
   * part of the signed mandate so they cannot be tampered with post-signing.
   */
  period: MandatePeriodSchema,

  /**
   * Unix timestamp after which this mandate is invalid.
   * Policy engine rejects proposals with timestamp >= expiresAt.
   */
  expiresAt: z.number().int().positive(),

  /** Unix timestamp when this mandate was created. */
  createdAt: z.number().int().positive(),

  /** Chain ID this mandate is scoped to. Proposal/mandate chain IDs must match. */
  chainId: z.number().int().positive(),
});

export type Mandate = z.infer<typeof MandateSchema>;
