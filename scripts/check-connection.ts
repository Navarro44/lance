/**
 * Verifies live Ethereum Sepolia connectivity and reads the test USDC contract.
 * Run: npm run check-connection
 *
 * Exits 0 on success, 1 on any failure.
 */

import "dotenv/config";
import { formatUnits } from "viem";

import { DEFAULT_RPC_URL } from "../src/chain/constants.js";
import { createClient, USDC_ADDRESS, USDC_DECIMALS, ERC20_ABI, CHAIN } from "../src/chain/index.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const ok = (msg: string) => console.log(`${GREEN}✓${RESET} ${msg}`);
const fail = (msg: string) => console.log(`${RED}✗${RESET} ${msg}`);
const info = (label: string, value: unknown) => console.log(`  ${DIM}${label}:${RESET} ${value}`);

async function main() {
  console.log(`\n${YELLOW}── Ethereum Sepolia connection check ──${RESET}\n`);

  const client = createClient();

  // ── 1. Chain connectivity ────────────────────────────────────────────────

  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
    ok(`Connected to ${CHAIN.name}`);
    info("RPC URL", process.env["RPC_URL"] ?? `${DEFAULT_RPC_URL} (public fallback)`);
    info("Chain ID", CHAIN.id);
    info("Block number", blockNumber.toString());
  } catch (err) {
    fail(`Cannot reach Ethereum Sepolia RPC`);
    console.error(err);
    process.exit(1);
  }

  // ── 2. Read test USDC contract ───────────────────────────────────────────

  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "name" }),
      client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "symbol" }),
      client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "decimals" }),
      client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "totalSupply" }),
    ]);

    ok(`USDC contract readable at ${USDC_ADDRESS}`);
    info("name", name);
    info("symbol", symbol);
    info("decimals", decimals);
    info("totalSupply", `${formatUnits(totalSupply as bigint, USDC_DECIMALS)} USDC`);

    if (decimals !== USDC_DECIMALS) {
      fail(`Decimals mismatch: expected ${USDC_DECIMALS}, got ${decimals}`);
      process.exit(1);
    }
  } catch (err) {
    fail(`Cannot read USDC contract at ${USDC_ADDRESS}`);
    console.error(err);
    process.exit(1);
  }

  // ── 3. Optionally check a test Safe ─────────────────────────────────────

  const safeAddress = process.env["SAFE_ADDRESS"];
  if (safeAddress) {
    try {
      const bytecode = await client.getBytecode({ address: safeAddress as `0x${string}` });
      if (bytecode && bytecode !== "0x") {
        ok(`Safe contract found at ${safeAddress}`);
        info("bytecode length", `${bytecode.length / 2 - 1} bytes`);
      } else {
        fail(`No contract at SAFE_ADDRESS (${safeAddress}) — not yet deployed?`);
      }
    } catch (err) {
      fail(`Error checking SAFE_ADDRESS`);
      console.error(err);
    }
  } else {
    console.log(`\n  ${DIM}SAFE_ADDRESS not set — skipping Safe check (set it in .env)${RESET}`);
  }

  console.log(`\n${GREEN}All checks passed.${RESET}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
