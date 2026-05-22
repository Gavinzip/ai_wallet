import TokenCoreBridge from "../../../modules/token-core-bridge";
import {
  createTcxKeystore,
  deriveTcxEvmAccount,
  initTokenCoreX,
  scanTcxKeystores,
  signTcxEthereumMessage,
  signTcxEthereumTransaction,
  utf8ToHex,
  type TcxEthTxInput,
} from "@/services/token-core/token-core-protobuf";
import {
  isWebTokenCoreAvailable,
  takeWebTokenCoreWalletSyncNotice,
  WebTokenCoreWasmAdapter,
} from "@/services/token-core/token-core-web-wallet-adapter";

export type TokenCoreAgentWallet = {
  id: string;
  address: string;
  label: string;
  chain: "EVM";
  source: "native-token-core" | "web-token-core";
};

export type SignIntentInput = {
  domain: string;
  password: string;
  statement: string;
  nonce: string;
  walletId: string;
};

export type TransferIntentInput = {
  amount: string;
  chain: string;
  evmTx?: TcxEthTxInput;
  from: string;
  password: string;
  to: string;
  token: string;
};

export type TokenCoreWalletAdapter = {
  mode: "native-token-core" | "unavailable" | "web-token-core";
  hasNativeBridge: boolean;
  hasTokenCoreRuntime: boolean;
  unavailableReason?: string;
  callRawTcxApi: (hexPayload: string) => Promise<string>;
  createAgentIdentityWallet: (input?: { password?: string }) => Promise<TokenCoreAgentWallet>;
  loadAgentIdentityWallet: () => Promise<TokenCoreAgentWallet | null>;
  signLoginChallenge: (input: SignIntentInput) => Promise<{ signature: string }>;
  buildTransferIntent: (input: TransferIntentInput) => Promise<{ txPayload: string }>;
};

export { takeWebTokenCoreWalletSyncNotice };

type TcxNativeModule = {
  getDefaultFileDir?: () => string;
  isAvailable?: () => boolean;
  callTcxApi?: (hexPayload: string) => Promise<string>;
};

const tcxNativeModule = TokenCoreBridge as TcxNativeModule | null | undefined;
const AGENT_WALLET_NAME = "Agent Identity Wallet";

export const tokenCoreNativeReference = {
  nativeModule: "TokenCoreBridge.callTcxApi(hexPayload)",
  source: "token-core/tcx-examples/RN/ios/RN/TcxApi.m + TokenCoreX.podspec",
  methods: ["scan_keystores", "create_keystore", "derive_accounts", "sign_tx", "sign_msg"],
};

class UnavailableTokenCoreAdapter implements TokenCoreWalletAdapter {
  mode: TokenCoreWalletAdapter["mode"] = "unavailable";

  hasNativeBridge = false;

  hasTokenCoreRuntime = false;

  unavailableReason = "Token Core native bridge is not loaded in this runtime.";

  async callRawTcxApi(_hexPayload: string): Promise<never> {
    throw new Error(this.unavailableReason);
  }

  async createAgentIdentityWallet(): Promise<TokenCoreAgentWallet> {
    throw new Error(this.unavailableReason);
  }

  async loadAgentIdentityWallet(): Promise<null> {
    return null;
  }

  async signLoginChallenge(_input: SignIntentInput): Promise<never> {
    throw new Error(this.unavailableReason);
  }

  async buildTransferIntent(_input: TransferIntentInput): Promise<never> {
    throw new Error(this.unavailableReason);
  }
}

class NativeTokenCoreBridgeAdapter implements TokenCoreWalletAdapter {
  mode: TokenCoreWalletAdapter["mode"] = "native-token-core";

  hasNativeBridge = true;

  hasTokenCoreRuntime = true;

  async callRawTcxApi(hexPayload: string): Promise<string> {
    const module = getAvailableTcxModule();
    return module.callTcxApi(hexPayload);
  }

  async createAgentIdentityWallet(input?: { password?: string }): Promise<TokenCoreAgentWallet> {
    if (!input?.password) {
      throw new Error("Token Core wallet password is required to create or unlock the agent wallet.");
    }

    return ensureAgentIdentityWallet(input.password);
  }

  async loadAgentIdentityWallet(): Promise<TokenCoreAgentWallet | null> {
    await ensureTokenCoreInitialized();
    return findExistingAgentIdentityWallet();
  }

  async signLoginChallenge(input: SignIntentInput): Promise<{ signature: string }> {
    const wallet = await ensureAgentIdentityWallet(input.password);
    const messageHex = `0x${utf8ToHex(
      [
        input.domain,
        input.statement,
        `Nonce: ${input.nonce}`,
        `Wallet: ${wallet.address}`,
      ].join("\n"),
    )}`;

    return {
      signature: await signTcxEthereumMessage(this.callRawTcxApi.bind(this), {
        keystoreId: wallet.id,
        messageHex,
        password: input.password,
      }),
    };
  }

  async buildTransferIntent(input: TransferIntentInput): Promise<{ txPayload: string }> {
    const wallet = await ensureAgentIdentityWallet(input.password);
    if (!input.evmTx) {
      throw new Error(
        "Transfer signing requires a fully built EVM transaction with nonce, gas, value, and calldata. The wallet will not invent transaction fields.",
      );
    }

    const result = await signTcxEthereumTransaction(this.callRawTcxApi.bind(this), {
      chainId: input.evmTx.chainId || evmChainIdForTokenCore(input.chain),
      keystoreId: wallet.id,
      password: input.password,
      tx: input.evmTx,
    });

    return { txPayload: result.signature };
  }
}

function evmChainIdForTokenCore(chain: string) {
  const normalized = chain.toLowerCase();
  if (chain === "BNB Smart Chain" || chain === "BSC") return "56";
  if (normalized.includes("holesky")) return "17000";
  if (normalized.includes("sepolia")) return "11155111";
  return "1";
}

export function getTokenCoreWalletAdapter(): TokenCoreWalletAdapter {
  if (isTcxModuleAvailable(tcxNativeModule)) {
    return new NativeTokenCoreBridgeAdapter();
  }

  if (isWebTokenCoreAvailable()) {
    return new WebTokenCoreWasmAdapter();
  }

  return new UnavailableTokenCoreAdapter();
}

export function getTokenCoreRuntimeStatus() {
  const adapter = getTokenCoreWalletAdapter();

  return {
    hasNativeBridge: adapter.hasNativeBridge,
    hasTokenCoreRuntime: adapter.hasTokenCoreRuntime,
    mode: adapter.mode,
    reason: adapter.unavailableReason,
  };
}

function isTcxModuleAvailable(module: TcxNativeModule | null | undefined): module is TcxNativeModule & {
  callTcxApi: (hexPayload: string) => Promise<string>;
} {
  try {
    return Boolean(module?.callTcxApi && module.isAvailable?.());
  } catch {
    return false;
  }
}

function getAvailableTcxModule() {
  if (!isTcxModuleAvailable(tcxNativeModule)) {
    throw new Error("Token Core native module is not available.");
  }

  return tcxNativeModule;
}

let initPromise: Promise<void> | null = null;
let agentWalletSession: TokenCoreAgentWallet | null = null;

async function ensureTokenCoreInitialized() {
  if (!initPromise) {
    const module = getAvailableTcxModule();
    if (!module.getDefaultFileDir) {
      throw new Error("Token Core native module is missing its default file directory method.");
    }

    initPromise = initTokenCoreX(module.callTcxApi, module.getDefaultFileDir());
  }

  return initPromise;
}

async function ensureAgentIdentityWallet(password: string): Promise<TokenCoreAgentWallet> {
  await ensureTokenCoreInitialized();

  if (agentWalletSession) {
    return agentWalletSession;
  }

  const existingWallet = await findExistingAgentIdentityWallet();
  if (existingWallet) {
    agentWalletSession = existingWallet;
    return agentWalletSession;
  }

  const scanned = await scanTcxKeystores(getAvailableTcxModule().callTcxApi);
  const existing = scanned.find((keystore) => keystore.name === AGENT_WALLET_NAME);
  if (existing) {
    const account = await deriveTcxEvmAccount(getAvailableTcxModule().callTcxApi, {
      chainId: "56",
      keystoreId: existing.id,
      password,
    });
    agentWalletSession = {
      address: account.address,
      chain: "EVM",
      id: existing.id,
      label: existing.name || AGENT_WALLET_NAME,
      source: "native-token-core",
    };

    return agentWalletSession;
  }

  const keystore = await createTcxKeystore(getAvailableTcxModule().callTcxApi, {
    name: AGENT_WALLET_NAME,
    network: "MAINNET",
    password,
    passwordHint: "",
  });
  const account = await deriveTcxEvmAccount(getAvailableTcxModule().callTcxApi, {
    chainId: "56",
    keystoreId: keystore.id,
    password,
  });

  agentWalletSession = {
    address: account.address,
    chain: "EVM",
    id: keystore.id,
    label: keystore.name || AGENT_WALLET_NAME,
    source: "native-token-core",
  };

  return agentWalletSession;
}

async function findExistingAgentIdentityWallet(): Promise<TokenCoreAgentWallet | null> {
  const scanned = await scanTcxKeystores(getAvailableTcxModule().callTcxApi);
  const existing = scanned.find((keystore) => keystore.name === AGENT_WALLET_NAME);
  const account = existing?.accounts.find(
    (item) => item.chainType === "ETHEREUM" && item.address.startsWith("0x"),
  );
  if (!existing || !account) {
    return null;
  }

  return {
    address: account.address,
    chain: "EVM",
    id: existing.id,
    label: existing.name || AGENT_WALLET_NAME,
    source: "native-token-core",
  };
}
