import { appendWalletActivityRecord } from "@/services/activity/wallet-activity-log";
import { getAgentApiBaseUrl } from "@/services/api-base-url";
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
import {
  executeRenaissSafeCalls,
  signRenaissSafeTypedData,
} from "@/services/renaiss/renaiss-safe-aa";
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

  if (action.type === "dapp_request") {
    const dappAction = getDappActionName(action);
    if (dappAction === "renaiss_session_login") {
      return loginToRenaissWithTokenCore(action, input);
    }
    if (dappAction === "renaiss_safe_usdt_approve_permit2") {
      return approveRenaissSafePermit2(action, input);
    }
    if (dappAction === "renaiss_buy_now_sign_and_submit") {
      return signAndSubmitRenaissBuyNow(action, input);
    }
    if (dappAction === "renaiss_list_order_sign_and_submit") {
      return signAndSubmitRenaissListing(action, input);
    }
    if (dappAction === "renaiss_buy_now_blocked") {
      throw new Error("RENAISS buyNow is blocked by the safety checks shown in the review card.");
    }
    if (dappAction === "renaiss_list_order_blocked") {
      throw new Error("RENAISS listing is blocked by the safety checks shown in the review card.");
    }
  }

  throw new Error("DApp requests must be decoded into a concrete signing action before Token Core can sign.");
}

async function loginToRenaissWithTokenCore(
  action: WalletIntentAction,
  input: { password: string },
): Promise<LocalSigningResult> {
  const adapter = getTokenCoreWalletAdapter();
  const wallet = await adapter.createAgentIdentityWallet({ password: input.password });
  const challenge = await postAgentJson<RenaissSiweNonceResponse>("/api/renaiss/session/siwe/nonce", {
    walletAddress: wallet.address,
  });
  if (!challenge.challengeId || !challenge.message) {
    throw new Error("RENAISS SIWE challenge response is incomplete.");
  }
  const signed = await adapter.signPersonalMessage({
    message: challenge.message,
    password: input.password,
  });
  const session = await postAgentJson<RenaissSessionResponse>("/api/renaiss/session/siwe/verify", {
    challengeId: challenge.challengeId,
    signature: signed.signature,
  });
  const sessionWallet = readNestedString(session, ["session", "walletAddress"]);
  const ownerWallet = readNestedString(session, ["session", "ownerWalletAddress"]);
  appendWalletActivityRecord({
    chain: action.chain,
    detail: [
      `Signed RENAISS SIWE as ${shortAddress(wallet.address)}.`,
      sessionWallet ? `Session wallet: ${shortAddress(sessionWallet)}.` : null,
      ownerWallet ? `Owner wallet: ${shortAddress(ownerWallet)}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    kind: "message_signature",
    source: "token-core",
    status: "signed",
    title: "RENAISS login signed locally",
  });

  return {
    message: [
      "RENAISS login completed with local Token Core signing.",
      sessionWallet && sessionWallet.toLowerCase() !== wallet.address.toLowerCase()
        ? `注意：RENAISS payment wallet is ${shortAddress(sessionWallet)}, not the signer ${shortAddress(wallet.address)}. 下一步會走 Safe/app-wallet approve 與 EIP-1271 簽名。`
        : "This signer is linked to the current RENAISS session.",
    ]
      .filter(Boolean)
      .join(" "),
    ok: true,
    signature: signed.signature,
  };
}

async function approveRenaissSafePermit2(
  action: WalletIntentAction,
  input: { password: string },
): Promise<LocalSigningResult> {
  const adapter = getTokenCoreWalletAdapter();
  const wallet = await adapter.createAgentIdentityWallet({ password: input.password });
  const params = action.params ?? {};
  const safeAddress = asString(params.safeAddress);
  const ownerAddress = asString(params.ownerAddress);
  const calls = Array.isArray(params.calls) ? params.calls : null;
  if (!safeAddress || !ownerAddress || !calls) {
    throw new Error("RENAISS Safe approve intent is missing safeAddress, ownerAddress, or calls.");
  }
  if (wallet.address.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error(`Token Core wallet ${wallet.address} does not match RENAISS owner ${ownerAddress}.`);
  }

  const result = await executeRenaissSafeCalls({
    adapter,
    calls: calls.map(readSafeCall),
    ownerAddress,
    password: input.password,
    safeAddress,
  });
  appendWalletActivityRecord({
    amount: action.amount,
    chain: action.chain,
    detail: `Approved Permit2 from RENAISS Safe ${shortAddress(result.safeAddress)}.`,
    explorerUrl: `${BSC_EXPLORER_TX_URL}${result.txHash}`,
    kind: "transaction",
    source: "token-core",
    status: "submitted",
    title: "RENAISS Safe Permit2 approve submitted",
    to: action.to,
    token: action.token,
    txHash: result.txHash,
  });

  return {
    explorerUrl: `${BSC_EXPLORER_TX_URL}${result.txHash}`,
    message: `Token Core signed the Safe/4337 Permit2 approve. Tx: ${result.txHash}`,
    ok: true,
    txHash: result.txHash,
  };
}

async function signAndSubmitRenaissBuyNow(
  action: WalletIntentAction,
  input: { password: string },
): Promise<LocalSigningResult> {
  const adapter = getTokenCoreWalletAdapter();
  const wallet = await adapter.createAgentIdentityWallet({ password: input.password });
  const params = action.params ?? {};
  const bidData = params.bidData;
  const collectibleId = asString(params.collectibleId);
  if (!bidData || typeof bidData !== "object" || !collectibleId) {
    throw new Error("RENAISS buyNow intent is missing bidData or collectibleId.");
  }

  const signatureMode = asString(params.signatureMode) ?? "owner_eoa";
  const safeAddress = asString(params.safeAddress);
  const typedData = params.typedData;
  const signed =
    signatureMode === "safe_eip1271"
      ? await signRenaissSafeTypedData({
          adapter,
          ownerAddress: wallet.address,
          password: input.password,
          safeAddress: safeAddress ?? "",
          typedData,
        })
      : await signRenaissEip712Preimage(action, adapter, input.password, "RENAISS buyNow");

  const submit = await postAgentJson<RenaissBuyNowSubmitResponse>("/api/renaiss/purchase/submit", {
    bidData,
    bidSignature: signed.signature,
    collectibleId,
    walletAddress: wallet.address,
  });
  const txHash =
    findStringByKey(submit, "executionTxHash")
    ?? findStringByKey(submit, "txHash")
    ?? findStringByKey(submit, "hash");
  const explorerUrl = txHash ? `${BSC_EXPLORER_TX_URL}${txHash}` : undefined;
  appendWalletActivityRecord({
    amount: action.amount,
    chain: action.chain,
    detail: txHash
      ? `Submitted RENAISS buyNow for ${action.amount ?? "the selected card"}.`
      : "Submitted RENAISS buyNow; no transaction hash was returned yet.",
    explorerUrl,
    kind: "transaction",
    source: "token-core",
    status: "submitted",
    title: "RENAISS BuyNow submitted",
    to: action.to,
    token: action.token,
    txHash: txHash ?? undefined,
  });

  return {
    explorerUrl,
    message: txHash
      ? `Token Core signed RENAISS buyNow and submitted it. Tx: ${txHash}`
      : "Token Core signed RENAISS buyNow and submitted it. RENAISS did not return an execution hash yet.",
    ok: true,
    signature: signed.signature,
    txHash: txHash ?? undefined,
  };
}

async function signAndSubmitRenaissListing(
  action: WalletIntentAction,
  input: { password: string },
): Promise<LocalSigningResult> {
  const adapter = getTokenCoreWalletAdapter();
  const wallet = await adapter.createAgentIdentityWallet({ password: input.password });
  const params = action.params ?? {};
  const askData = params.askData;
  const collectibleId = asString(params.collectibleId);
  if (!askData || typeof askData !== "object" || !collectibleId) {
    throw new Error("RENAISS listing intent is missing askData or collectibleId.");
  }

  const signatureMode = asString(params.signatureMode) ?? "owner_eoa";
  const safeAddress = asString(params.safeAddress);
  const typedData = params.typedData;
  const signed =
    signatureMode === "safe_eip1271"
      ? await signRenaissSafeTypedData({
          adapter,
          ownerAddress: wallet.address,
          password: input.password,
          safeAddress: safeAddress ?? "",
          typedData,
        })
      : await signRenaissEip712Preimage(action, adapter, input.password, "RENAISS listing");

  const submit = await postAgentJson<RenaissListingSubmitResponse>("/api/renaiss/listing/submit", {
    askData,
    askSignature: signed.signature,
    collectibleId,
    walletAddress: wallet.address,
  });
  appendWalletActivityRecord({
    amount: action.amount,
    chain: action.chain,
    detail: `Signed and submitted RENAISS listing for ${action.amount ?? "the selected card"}.`,
    kind: "message_signature",
    source: "token-core",
    status: "submitted",
    title: "RENAISS listing submitted",
    to: action.to,
    token: action.token,
  });

  return {
    message: submit.ok
      ? "Token Core signed the RENAISS Ask order and submitted createSellOffer."
      : "Token Core signed the RENAISS Ask order; server returned an unexpected listing response.",
    ok: true,
    signature: signed.signature,
  };
}

async function signRenaissEip712Preimage(
  action: WalletIntentAction,
  adapter: ReturnType<typeof getTokenCoreWalletAdapter>,
  password: string,
  label: string,
) {
  const preimage = action.data;
  if (!preimage || !/^0x[0-9a-fA-F]+$/.test(preimage)) {
    throw new Error(`${label} intent is missing the EIP-712 digest preimage.`);
  }
  return adapter.signEthereumEcMessage({
    messageHex: preimage,
    password,
  });
}

type RenaissSiweNonceResponse = {
  challengeId?: string;
  message?: string;
};

type RenaissSessionResponse = Record<string, unknown>;

type RenaissBuyNowSubmitResponse = Record<string, unknown>;

type RenaissListingSubmitResponse = {
  ok?: boolean;
} & Record<string, unknown>;

async function postAgentJson<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("agent server")}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as TResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Agent server request failed with HTTP ${response.status}.`);
  }
  return payload;
}

function getDappActionName(action: WalletIntentAction) {
  return asString(action.params?.action);
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNestedString(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return asString(current);
}

function findStringByKey(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const direct = asString(record[key]);
    if (direct) return direct;
    for (const nested of Object.values(record)) {
      const found = findStringByKey(nested, key);
      if (found) return found;
    }
    return null;
  }
  for (const item of value) {
    const found = findStringByKey(item, key);
    if (found) return found;
  }
  return null;
}

function readSafeCall(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Safe call must be an object.");
  }
  const record = value as Record<string, unknown>;
  const to = asString(record.to);
  const data = asString(record.data);
  const rawValue = record.value;
  if (!to || !data) {
    throw new Error("Safe call is missing to or data.");
  }
  return {
    data,
    to,
    value:
      typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "bigint"
        ? rawValue
        : undefined,
  };
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
