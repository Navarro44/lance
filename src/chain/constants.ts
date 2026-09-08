import { sepolia } from "viem/chains";
import type { Address, Hex } from "viem";

export const CHAIN = sepolia;
export const CHAIN_ID = sepolia.id; // 11155111

/**
 * Default public RPC. Every module reads the chain and this default from here,
 * so the target network cannot drift between the adapter, the scripts and the
 * tests. Override with RPC_URL in .env.
 */
export const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * Circle's official USDC deployment on Ethereum Sepolia (chainId 11155111).
 * Verified against Circle's contract-address docs and on-chain: name "USDC",
 * symbol "USDC", decimals 6.
 * Source: https://developers.circle.com/stablecoins/usdc-contract-addresses
 */
export const USDC_ADDRESS: Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

/** USDC has 6 decimal places. */
export const USDC_DECIMALS = 6;

/** ERC-20 function selectors used by the chain adapter and Roles permission scoping. */
export const TRANSFER_SELECTOR: Hex = "0xa9059cbb"; // transfer(address,uint256)
export const APPROVE_SELECTOR: Hex = "0x095ea7b3"; // approve(address,uint256)

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
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
