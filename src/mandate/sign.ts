import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Mandate } from "../types/index.js";
import { getMandateDomain, MANDATE_TYPES, mandateToEIP712Message } from "./eip712.js";

/**
 * Signs a mandate with a private key, returning the mandate with the
 * EIP-712 signature filled in.
 *
 * The private key is the executor's owner key (or a test key).
 * Never pass an LLM-controlled key here — the signing is a human action.
 */
export async function signMandate(
  mandate: Omit<Mandate, "signature">,
  privateKey: Hex,
): Promise<Mandate> {
  const account = privateKeyToAccount(privateKey);
  const domain = getMandateDomain(mandate.chainId);
  const message = mandateToEIP712Message(mandate);

  const signature = await account.signTypedData({
    domain,
    types: MANDATE_TYPES,
    primaryType: "Mandate",
    message,
  });

  return { ...mandate, signature };
}

/**
 * Verifies an EIP-712 mandate signature.
 *
 * Recovers the signer address from the signature and checks it matches
 * mandate.signerAddress. Returns false (does not throw) on any error —
 * a bad signature is a MANDATE_SIGNATURE_UNVERIFIED escalation, not a crash.
 *
 * Note: this checks authenticity only, not expiry or business rules.
 * The policy engine checks those separately.
 */
export async function verifyMandate(mandate: Mandate): Promise<boolean> {
  if (!mandate.signature || mandate.signature === "0x") return false;

  try {
    const domain = getMandateDomain(mandate.chainId);
    const message = mandateToEIP712Message(mandate);

    const recovered = await recoverTypedDataAddress({
      domain,
      types: MANDATE_TYPES,
      primaryType: "Mandate",
      message,
      signature: mandate.signature,
    });

    return recovered.toLowerCase() === mandate.signerAddress.toLowerCase();
  } catch {
    return false;
  }
}
