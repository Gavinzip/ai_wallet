import { emptyWalletName } from "@/data/wallet";
import {
  getTokenCoreRuntimeStatus,
  getTokenCoreWalletAdapter,
  takeWebTokenCoreWalletSyncNotice,
  type TokenCoreAgentWallet,
} from "@/services/token-core/token-core-wallet-adapter";
import {
  readVerifiedEvmWalletTokens,
  summarizeNativeBalances,
} from "@/services/wallet/evm-token-balances";
import type { WalletSummary, WalletToken } from "@/types/wallet";

export type WalletRuntimeSnapshot = {
  summary: WalletSummary;
  tokens: WalletToken[];
  canTransact: boolean;
  setupNotice?: string;
};

export async function loadWalletRuntimeSnapshot(): Promise<WalletRuntimeSnapshot> {
  const tokenCore = getTokenCoreRuntimeStatus();
  const adapter = getTokenCoreWalletAdapter();

  if (!tokenCore.hasTokenCoreRuntime) {
    return {
      canTransact: false,
      summary: {
        address: null,
        dailyPnl: null,
        dailyPnlTone: "neutral",
        integrationMode: "token-core-unavailable",
        name: emptyWalletName,
        statusMessage: tokenCore.reason ?? "Token Core native bridge is unavailable.",
        totalValue: null,
      },
      tokens: [],
    };
  }

  const wallet = await adapter.loadAgentIdentityWallet();
  if (wallet) {
    return createWalletRuntimeSnapshot(wallet);
  }

  if (adapter.mode === "web-token-core") {
    return {
      canTransact: false,
      summary: {
        address: null,
        dailyPnl: null,
        dailyPnlTone: "neutral",
        integrationMode: "token-core-web",
        name: "Google Passkey Wallet",
        statusMessage: "Token Core WASM is available in this browser. Google identifies the user; Passkey PRF encrypts the local wallet.",
        totalValue: null,
      },
      tokens: [],
    };
  }

  return {
    canTransact: false,
    summary: {
      address: null,
      dailyPnl: null,
      dailyPnlTone: "neutral",
      integrationMode: "token-core-native",
      name: emptyWalletName,
      statusMessage: "Token Core native bridge detected. Local wallet creation, message signing, and PancakeSwap BNB swap signing are wired through real BSC RPC.",
      totalValue: null,
    },
    tokens: [],
  };
}

export async function createOrUnlockTokenCoreWallet(password: string): Promise<WalletRuntimeSnapshot> {
  const adapter = getTokenCoreWalletAdapter();
  if (!adapter.hasTokenCoreRuntime) {
    throw new Error(adapter.unavailableReason ?? "Token Core runtime is unavailable.");
  }

  if (adapter.mode === "web-token-core") {
    const wallet = await adapter.createAgentIdentityWallet();
    const snapshot = await createWalletRuntimeSnapshot(wallet);
    return {
      ...snapshot,
      setupNotice: takeWebTokenCoreWalletSyncNotice() ?? undefined,
    };
  }

  const trimmedPassword = password.trim();
  if (!trimmedPassword) {
    throw new Error("Wallet password is required.");
  }

  const wallet = await adapter.createAgentIdentityWallet({ password: trimmedPassword });
  return createWalletRuntimeSnapshot(wallet);
}

async function createWalletRuntimeSnapshot(wallet: TokenCoreAgentWallet): Promise<WalletRuntimeSnapshot> {
  const { failedChains, tokens } = await readVerifiedEvmWalletTokens(wallet.address);
  const nativeBalanceSummary = summarizeNativeBalances(tokens);
  const balanceReadNotice =
    failedChains.length > 0
      ? ` Some network balance reads failed: ${failedChains.join(", ")}.`
      : "";

  return {
    canTransact: true,
    summary: {
      address: wallet.address,
      dailyPnl: null,
      dailyPnlTone: "neutral",
      integrationMode: wallet.source === "web-token-core" ? "token-core-web" : "token-core-native",
      name: wallet.label,
      statusMessage:
        wallet.source === "web-token-core"
          ? `Self-custodial Token Core WASM wallet is loaded. EVM balances are read from verified RPC/token contracts; signing stays local with Passkey PRF.${balanceReadNotice}`
          : `Self-custodial Token Core wallet is loaded on this device. EVM balances are read from verified RPC/token contracts.${balanceReadNotice}`,
      totalValue: nativeBalanceSummary,
    },
    tokens,
  };
}
