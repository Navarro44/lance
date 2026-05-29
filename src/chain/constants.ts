import { baseSepolia } from "viem/chains";
import type { Address } from "viem";

export const CHAIN = baseSepolia;
export const CHAIN_ID = baseSepolia.id; // 84532

/**
 * Circle's official USDC deployment on Base Sepolia.
 * Source: https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
 */
export const USDC_ADDRESS: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** USDC has 6 decimal places. */
export const USDC_DECIMALS = 6;

/**
 * Minimal ERC-20 ABI — just the read methods we use for connection checks
 * and balance queries. Full ABI is not needed until Phase 2.
 */
export const ERC20_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
