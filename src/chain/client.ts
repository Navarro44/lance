import { createPublicClient, http } from "viem";
import { CHAIN, DEFAULT_RPC_URL } from "./constants.js";

/**
 * Returns a viem public client for the configured chain (Ethereum Sepolia).
 *
 * Uses RPC_URL from the environment if set; falls back to the public RPC
 * (rate-limited — set a real URL in .env for anything beyond quick checks).
 */
export function createClient(rpcUrl?: string) {
  return createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl ?? process.env["RPC_URL"] ?? DEFAULT_RPC_URL),
  });
}

export type PublicClient = ReturnType<typeof createClient>;
