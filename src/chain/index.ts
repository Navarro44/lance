export { createClient } from "./client.js";
export type { PublicClient } from "./client.js";

export {
  CHAIN,
  CHAIN_ID,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ERC20_ABI,
  TRANSFER_SELECTOR,
  APPROVE_SELECTOR,
} from "./constants.js";

export {
  EXECUTOR_ROLE_KEY,
  buildTransferConditions,
  encodeAssignRoles,
  encodeSetDefaultRole,
  encodeScopeTarget,
  encodeScopeTransfer,
  encodeExecWithRole,
  encodeTransfer,
  getRolesBytecode,
} from "./roles.js";

export type { AuditSeam, ExecutedPayment } from "./audit-seam.js";
export { createNullAuditSeam, NullAuditSeam } from "./audit-seam.js";

export type { AdapterConfig, AdapterResult, DecodedTransfer } from "./adapter.js";
export { createChainAdapter, simulateAsExecutor } from "./adapter.js";
