import { createPublicClient, http } from "viem";
import { CHAIN } from "./constants.js";

/**
 * Returns a viem public client for Base Sepolia.
 *
 * Uses RPC_URL from the environment if set; falls back to the public RPC
 * (rate-limited — set a real URL in .env for anything beyond quick checks).
 */
export function createClient(rpcUrl?: string) {
  return createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl ?? process.env["RPC_URL"] ?? "https://sepolia.base.org"),
  });
}

export type PublicClient = ReturnType<typeof createClient>;
