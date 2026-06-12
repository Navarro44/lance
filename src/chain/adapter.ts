/**
 * Chain adapter — the single seam between the policy engine and the blockchain.
 *
 * Architecture:
 *   executor EOA
 *     → Roles Modifier: execTransactionWithRole(USDC, 0, transfer(payee, amt), Call, EXECUTOR, true)
 *       → Safe: execTransactionFromModule(USDC, 0, transfer(payee, amt), Call)
 *         → USDC ERC-20: transfer(payee, amt)
 *
 * Shadow mode (DEFAULT): constructs the tx, runs a static simulation via eth_call
 * with the executor address as sender (so Roles permission check fires), logs the
 * decoded tx, and returns WITHOUT submitting. The `shadow` flag must be explicitly
 * set to false to submit a real transaction.
 *
 * Live mode: builds + submits + waits for receipt, then writes to the audit seam.
 *
 * The LLM is never in this path.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import type { PaymentProposal } from "../types/index.js";
import { CHAIN, USDC_ADDRESS } from "./constants.js";
import { encodeExecWithRole, encodeTransfer, EXECUTOR_ROLE_KEY } from "./roles.js";
import { ERC20_ABI } from "./constants.js";
import type { AuditSeam } from "./audit-seam.js";
import { createNullAuditSeam } from "./audit-seam.js";

// ─── types ─────────────────────────────────────────────────────────────────────

export type AdapterConfig = {
  /**
   * When true (default): simulate only — do NOT submit the transaction.
   * Set to false explicitly to execute a real on-chain payment.
   * This flag must be a conscious, visible opt-in — never default to live.
   */
  shadow: boolean;
  rolesModifierAddress: Address;
  executorPrivateKey: Hex;
  rpcUrl?: string;
  auditSeam?: AuditSeam;
};

export type DecodedTransfer = {
  rolesModifier: Address;
  safe: Address;
  token: Address;
  payee: Address;
  amountBaseUnits: bigint;
  amountHuman: string;
  roleKey: Hex;
};

export type AdapterResult = {
  /** True if the simulation or live tx succeeded without reverting. */
  success: boolean;
  /** Present only in live mode after confirmation. */
  txHash?: Hash;
  decoded: DecodedTransfer;
  mode: "shadow" | "live";
};

// ─── factory ──────────────────────────────────────────────────────────────────

export function createChainAdapter(config: AdapterConfig) {
  const rpcUrl = config.rpcUrl ?? process.env["RPC_URL"] ?? "https://sepolia.base.org";
  const auditSeam = config.auditSeam ?? createNullAuditSeam();

  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl),
  });

  const account = privateKeyToAccount(config.executorPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  async function submit(proposal: PaymentProposal): Promise<AdapterResult> {
    const payee = proposal.payee as Address;
    const amount = BigInt(proposal.amount);

    const transferCalldata = encodeTransfer(payee, amount);

    const execCalldata = encodeExecWithRole(USDC_ADDRESS, transferCalldata, true);

    const decoded: DecodedTransfer = {
      rolesModifier: config.rolesModifierAddress,
      safe: await getSafeFromRoles(config.rolesModifierAddress, publicClient),
      token: USDC_ADDRESS,
      payee,
      amountBaseUnits: amount,
      amountHuman: `${(Number(amount) / 1_000_000).toFixed(6)} USDC`,
      roleKey: EXECUTOR_ROLE_KEY,
    };

    if (config.shadow) {
      return await runShadow(execCalldata, decoded, proposal);
    }
    return await runLive(execCalldata, decoded, proposal, auditSeam);
  }

  async function runShadow(
    execCalldata: Hex,
    decoded: DecodedTransfer,
    proposal: PaymentProposal,
  ): Promise<AdapterResult> {
    console.log("\n[shadow-mode] ── Simulating payment (NOT submitting) ──────────");
    console.log("[shadow-mode] proposal:", proposal.proposalId);
    console.log("[shadow-mode] decoded tx:", {
      rolesModifier: decoded.rolesModifier,
      payee: decoded.payee,
      amount: decoded.amountHuman,
      token: decoded.token,
      roleKey: decoded.roleKey,
    });

    let success = false;
    try {
      await publicClient.call({
        account: account.address,
        to: config.rolesModifierAddress,
        data: execCalldata,
      });
      success = true;
      console.log("[shadow-mode] ✓ Simulation SUCCEEDED — tx would execute on-chain");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("[shadow-mode] ✗ Simulation REVERTED:", msg);
    }
    console.log("[shadow-mode] ────────────────────────────────────────────────────\n");

    return { success, decoded, mode: "shadow" };
  }

  async function runLive(
    execCalldata: Hex,
    decoded: DecodedTransfer,
    proposal: PaymentProposal,
    seam: AuditSeam,
  ): Promise<AdapterResult> {
    console.log("\n[live-mode] ── Submitting payment ─────────────────────────────");
    console.log("[live-mode] proposal:", proposal.proposalId);
    console.log("[live-mode] payee:", decoded.payee);
    console.log("[live-mode] amount:", decoded.amountHuman);

    const txHash = await walletClient.sendTransaction({
      account,
      to: config.rolesModifierAddress,
      data: execCalldata,
    });
    console.log("[live-mode] tx submitted:", txHash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const success = receipt.status === "success";
    console.log(
      "[live-mode]",
      success ? "✓ CONFIRMED" : "✗ REVERTED",
      "block:",
      receipt.blockNumber,
    );
    console.log("[live-mode] ─────────────────────────────────────────────────────\n");

    if (success) {
      try {
        seam.recordExecution({
          proposalId: proposal.proposalId,
          mandateId: proposal.mandateId,
          payee: decoded.payee,
          token: decoded.token,
          amount: proposal.amount,
          txHash,
          executedAt: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        console.error("[live-mode] audit-seam write failed (non-fatal):", err);
      }
    }

    return { success, txHash, decoded, mode: "live" };
  }

  return { submit };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const ROLES_AVATAR_ABI = [
  {
    name: "avatar",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

type MinimalPublicClient = {
  readContract: (args: {
    address: Address;
    abi: typeof ROLES_AVATAR_ABI;
    functionName: "avatar";
  }) => Promise<unknown>;
};

async function getSafeFromRoles(
  rolesAddress: Address,
  client: MinimalPublicClient,
): Promise<Address> {
  try {
    return (await client.readContract({
      address: rolesAddress,
      abi: ROLES_AVATAR_ABI,
      functionName: "avatar",
    })) as Address;
  } catch {
    return "0x0000000000000000000000000000000000000000";
  }
}

// ─── static simulation helper (for tests) ────────────────────────────────────

/**
 * Simulates an arbitrary calldata payload through the Roles Modifier as
 * the executor address. Returns true if it would succeed, false if it reverts.
 * Used by adversarial tests to verify on-chain guardrails without submitting.
 */
export async function simulateAsExecutor(opts: {
  rolesModifierAddress: Address;
  executorAddress: Address;
  innerTo: Address;
  innerData: Hex;
  rpcUrl?: string;
}): Promise<{ success: boolean; revertReason?: string }> {
  const rpcUrl = opts.rpcUrl ?? process.env["RPC_URL"] ?? "https://sepolia.base.org";
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(rpcUrl) });

  const execCalldata = encodeExecWithRole(opts.innerTo, opts.innerData, false);

  try {
    await publicClient.call({
      account: opts.executorAddress,
      to: opts.rolesModifierAddress,
      data: execCalldata,
    });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, revertReason: msg };
  }
}

// Re-export ERC20_ABI convenience for tests
export { ERC20_ABI };
