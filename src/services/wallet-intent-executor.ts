import { appendWalletActivityRecord } from "@/services/activity/wallet-activity-log";
import { BSC_EXPLORER_TX_URL, sendBscRawTransaction } from "@/services/defi/bsc-rpc";
import {
  getEvmExplorerTxUrl,
  isSupportedEthereumChain,
  sendEthereumRawTransaction,
} from "@/services/defi/ethereum-rpc";
import {
  isPancakeOutputSymbol,
  preparePancakeBnbToTokenSwap,
} from "@/services/defi/pancakeswap-v2";
import { getTokenCoreWalletAdapter } from "@/services/token-core/token-core-wallet-adapter";
import type { LocalSigningResult, WalletIntent, WalletIntentAction } from "@/types/intent";

export async function requestLocalTokenCoreSigning(
  intent: WalletIntent,
  input: { password: string },
): Promise<LocalSigningResult> {
  validateIntentSecurityBoundary(intent);

  const adapter = getTokenCoreWalletAdapter();
  if (!adapter.hasTokenCoreRuntime) {
    throw new Error("Token Core runtime is required before this intent can be signed.");
  }

  const action = intent.actions[0];
  if (!action) {
    throw new Error("Intent has no wallet action to sign.");
  }

  if (action.type === "transfer") {
    validateTransferAction(action);
    const result = await adapter.buildTransferIntent({
      amount: action.amount,
      chain: action.chain,
      evmTx: action.evmTx ?? undefined,
      from: "local-token-core-wallet",
      password: input.password,
      to: action.to,
      token: action.token,
    });
    const txHash = isSupportedEthereumChain(action.chain)
      ? await sendEthereumRawTransaction(result.txPayload, { chainId: action.evmTx?.chainId })
      : await sendBscRawTransaction(result.txPayload);
    const explorerUrl = isSupportedEthereumChain(action.chain)
      ? getEvmExplorerTxUrl(action.chain, txHash)
      : `${BSC_EXPLORER_TX_URL}${txHash}`;
    appendWalletActivityRecord({
      amount: action.amount,
      chain: action.chain,
      detail: `Sent ${action.amount} ${action.token} to ${shortAddress(action.to)}.`,
      explorerUrl,
      kind: "transaction",
      source: "token-core",
      status: "submitted",
      title: `${action.token} transfer submitted`,
      to: action.to,
      token: action.token,
      txHash,
    });

    return {
      explorerUrl,
      message: isSupportedEthereumChain(action.chain)
        ? `Token Core signed and submitted the ${action.chain} transaction.`
        : "Token Core signed and submitted the BSC transfer.",
      ok: true,
      txHash,
      txPayload: result.txPayload,
    };
  }

  if (action.type === "swap") {
    validateSwapAction(action);
    const wallet = await adapter.createAgentIdentityWallet({ password: input.password });
    const prepared = action.evmTx
      ? null
      : await preparePancakeBnbToTokenSwap({
          amountInBnb: normalizeBnbAmount(action.amount),
          fromAddress: wallet.address,
          outputSymbol: normalizeOutputSymbol(action.token),
          slippageBps: normalizeSlippageBps(action.params?.slippageBps),
        });
    const evmTx = action.evmTx ?? prepared?.evmTx;
    if (!evmTx) {
      throw new Error("Swap intent is missing a prepared EVM transaction.");
    }

    const signed = await adapter.buildTransferIntent({
      amount: action.amount,
      chain: "BNB Smart Chain",
      evmTx,
      from: wallet.address,
      password: input.password,
      to: action.to ?? evmTx.to,
      token: `BNB -> ${normalizeOutputSymbol(action.token)}`,
    });
    const txHash = await sendBscRawTransaction(signed.txPayload);
    const amountOutMin =
      typeof action.params?.amountOutMin === "string"
        ? action.params.amountOutMin
        : prepared?.quote.amountOutMin;
    const outputSymbol = normalizeOutputSymbol(action.token);
    appendWalletActivityRecord({
      amount: action.amount,
      chain: "BNB Smart Chain",
      detail: [
        `Swapped ${action.amount} BNB to ${outputSymbol} on PancakeSwap.`,
        amountOutMin ? `Minimum receive ${amountOutMin} ${outputSymbol}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      explorerUrl: `${BSC_EXPLORER_TX_URL}${txHash}`,
      kind: "transaction",
      source: "token-core",
      status: "submitted",
      title: `PancakeSwap ${outputSymbol} swap submitted`,
      to: action.to ?? evmTx.to,
      token: `BNB -> ${outputSymbol}`,
      txHash,
    });

    return {
      explorerUrl: `${BSC_EXPLORER_TX_URL}${txHash}`,
      message: [
        "Token Core signed and submitted the PancakeSwap swap.",
        amountOutMin ? `Minimum receive: ${amountOutMin} ${outputSymbol}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      ok: true,
      txHash,
      txPayload: signed.txPayload,
    };
  }

  if (action.type === "sign_message") {
    if (!action.message) {
      throw new Error("Message signing intent is missing message content.");
    }

    const result = await adapter.signLoginChallenge({
      domain: "wallet-agent",
      nonce: intent.id,
      password: input.password,
      statement: action.message,
      walletId: "local-token-core-wallet",
    });
    appendWalletActivityRecord({
      chain: action.chain,
      detail: intent.title,
      kind: "message_signature",
      source: "token-core",
      status: "signed",
      title: "Message signed locally",
    });

    return {
      message: "Token Core produced a local signature.",
      ok: true,
      signature: result.signature,
    };
  }

  throw new Error("DApp requests must be decoded into a concrete signing action before Token Core can sign.");
}

function shortAddress(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function validateIntentSecurityBoundary(intent: WalletIntent) {
  if (intent.serverCanExecute !== false) {
    throw new Error("Blocked: server-executable intents are not allowed.");
  }

  if (intent.requiresLocalSignature !== true || intent.requiresUserConfirmation !== true) {
    throw new Error("Blocked: intent must require local signature and user confirmation.");
  }
}

function validateTransferAction(action: WalletIntentAction): asserts action is WalletIntentAction & {
  amount: string;
  chain: string;
  to: string;
  token: string;
} {
  if (!action.chain || !action.to || !action.token || !action.amount) {
    throw new Error("Transfer intent is missing chain, recipient, token, or amount.");
  }

  if (!["BNB Smart Chain", "BSC"].includes(action.chain) && !isSupportedEthereumChain(action.chain)) {
    throw new Error("Only BNB Smart Chain and supported Ethereum networks are wired for local Token Core broadcast.");
  }

  if (!action.to.startsWith("0x")) {
    throw new Error("Transfer recipient must be a full on-chain address before signing.");
  }
}

function validateSwapAction(action: WalletIntentAction): asserts action is WalletIntentAction & {
  amount: string;
  chain: string;
  token: string;
} {
  if (!action.chain || !["BNB Smart Chain", "BSC"].includes(action.chain)) {
    throw new Error("Only BNB Smart Chain swaps are wired for local Token Core execution.");
  }

  if (!action.amount || !action.token) {
    throw new Error("Swap intent is missing BNB amount or output token.");
  }

  normalizeOutputSymbol(action.token);
}

function normalizeBnbAmount(value: string) {
  return value.replace(/\s*BNB\s*$/i, "").trim();
}

function normalizeOutputSymbol(value: string) {
  const normalized = value.toUpperCase().replace(/^BNB\s*->\s*/, "").trim();
  if (!isPancakeOutputSymbol(normalized)) {
    throw new Error("Supported live swap outputs are USDC, USDT, and CAKE.");
  }
  return normalized;
}

function normalizeSlippageBps(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  return 100;
}
