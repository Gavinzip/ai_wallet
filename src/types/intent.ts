import type { RiskSeverity } from "@/types/security";

export type EvmTransactionPayload = {
  accessList?: { address: string; storageKeys: string[] }[];
  chainId: string;
  data: string;
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: string;
  to: string;
  txType?: string;
  value: string;
};

export type WalletIntentActionType = "sign_message" | "transfer" | "dapp_request" | "swap";

export type WalletIntentActionParams = Record<string, unknown>;

export type WalletIntentAction = {
  type: WalletIntentActionType;
  chain: string | null;
  to: string | null;
  token: string | null;
  amount: string | null;
  message: string | null;
  data: string | null;
  dappUrl: string | null;
  evmTx?: EvmTransactionPayload | null;
  params?: WalletIntentActionParams | null;
};

export type WalletIntent = {
  id: string;
  title: string;
  summary: string;
  status: "needs_review";
  createdAt: string;
  riskLevel: RiskSeverity;
  requiresLocalSignature: true;
  requiresUserConfirmation: true;
  serverCanExecute: false;
  actions: WalletIntentAction[];
  safetyChecks: string[];
};

export type LocalSigningResult = {
  ok: boolean;
  message: string;
  txPayload?: string;
  signature?: string;
  txHash?: string;
  explorerUrl?: string;
};
