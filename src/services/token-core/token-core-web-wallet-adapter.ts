import { appendWalletActivityRecord } from "@/services/activity/wallet-activity-log";
import {
  getAgentApiBaseUrl,
  getGoogleAccessTokenForServer,
  loadStoredGoogleUser,
  signInWithGoogleWeb,
} from "@/services/auth/google-web";
import { createPasskeyPrfKey, getPasskeyPrfKey } from "@/services/token-core/webauthn-prf";
import type {
  SignIntentInput,
  TokenCoreAgentWallet,
  TransferIntentInput,
} from "@/services/token-core/token-core-wallet-adapter";

type TcxWasmModule = typeof import("@consenlabs/tcx-wasm");

type StoredWebWallet = {
  address: string;
  credentialId: string;
  googleEmail: string;
  googleName: string;
  googleSub: string;
  id: string;
  keystoreJson: string;
  rpId: string;
};

type WebWalletBackup = {
  createdAt: string;
  format: "imtoken-agent-wallet-web-backup-v1";
  wallet: StoredWebWallet;
};

type CloudBackupPayload = {
  backup?: unknown;
  error?: string;
  savedAt?: string;
};

type DerivedAccount = {
  address: string;
  chain: string;
};

type ExportMnemonicResult = {
  mnemonic?: string;
};

type SignedTxResult = {
  rawTx?: string;
  signature?: string;
};

type SignedMessageResult = {
  signature?: string;
};

const WEB_WALLET_CURRENT_SUB_KEY = "imtoken.webWallet.currentSub.v1";
const WEB_WALLET_KEY_PREFIX = "imtoken.webWallet.v1";
const WEB_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const TCX_WASM_MODULE_PATH = "/tcx_wasm.js";
const TCX_WASM_BINARY_PATH = "/tcx_wasm_bg.wasm";

let tcxWasmPromise: Promise<TcxWasmModule> | null = null;
let lastWalletSyncNotice: string | null = null;

export class WebTokenCoreWasmAdapter {
  mode = "web-token-core" as const;

  hasNativeBridge = false;

  hasTokenCoreRuntime = true;

  async callRawTcxApi(_hexPayload: string): Promise<never> {
    throw new Error("tcx-wasm uses JSON APIs, not the native protobuf call_tcx_api bridge.");
  }

  async createAgentIdentityWallet(): Promise<TokenCoreAgentWallet> {
    lastWalletSyncNotice = null;
    const { accessToken, user } = await getGoogleAccessTokenForServer({ prompt: "consent" });
    const existing = loadStoredWebWallet(user.sub);
    if (existing) {
      lastWalletSyncNotice = "Google account matched an existing local wallet. Passkey unlock keeps signing on this device.";
      return toTokenCoreAgentWallet(existing);
    }

    const cloudBackup = await downloadWebTokenCoreCloudBackup(accessToken);
    if (cloudBackup) {
      const wallet = await restoreParsedWebTokenCoreWalletBackup(cloudBackup, user.sub);
      lastWalletSyncNotice = "Google backup found. Restored the same Token Core wallet for this Google account.";
      appendWalletActivityRecord({
        detail: `Restored ${shortAddress(wallet.address)} from encrypted Google wallet backup.`,
        kind: "wallet_restored",
        source: "wallet",
        status: "restored",
        title: "Google wallet backup restored",
      });
      return wallet;
    }

    const passkey = await createPasskeyPrfKey({
      email: user.email,
      name: user.name,
      userId: user.sub,
    });
    const tcx = await loadTcxWasm();
    const keystoreJson = tcx.create_keystore(
      JSON.stringify({
        network: "MAINNET",
        prfKey: passkey.prfKeyHex,
        credentialId: passkey.credentialId,
        rpId: passkey.rpId,
        userId: user.sub,
      }),
    );
    const account = deriveEvmAccount(tcx, {
      key: passkey.prfKeyHex,
      keystoreJson,
    });
    const stored: StoredWebWallet = {
      address: account.address,
      credentialId: passkey.credentialId,
      googleEmail: user.email,
      googleName: user.name,
      googleSub: user.sub,
      id: makeWebWalletId(user.sub),
      keystoreJson,
      rpId: passkey.rpId,
    };
    storeWebWallet(stored);
    try {
      await uploadStoredWebTokenCoreCloudBackup(stored, accessToken, user);
      lastWalletSyncNotice = "New Token Core wallet created and encrypted Google backup saved. This Google account can restore the same wallet on this domain.";
      appendWalletActivityRecord({
        detail: `Created ${shortAddress(stored.address)} and saved encrypted Google wallet backup.`,
        kind: "wallet_created",
        source: "wallet",
        status: "created",
        title: "Google Passkey wallet created",
      });
    } catch (error) {
      lastWalletSyncNotice = `New Token Core wallet created locally, but Google backup upload failed: ${formatErrorMessage(error)}. Use Save Google Backup before relying on browser storage.`;
      appendWalletActivityRecord({
        detail: `Created ${shortAddress(stored.address)} locally. Google wallet backup upload failed.`,
        kind: "wallet_created",
        source: "wallet",
        status: "created",
        title: "Google Passkey wallet created locally",
      });
    }
    return toTokenCoreAgentWallet(stored);
  }

  async loadAgentIdentityWallet(): Promise<TokenCoreAgentWallet | null> {
    const currentSub = loadCurrentSub();
    if (!currentSub) return null;
    const stored = loadStoredWebWallet(currentSub);
    return stored ? toTokenCoreAgentWallet(stored) : null;
  }

  async signLoginChallenge(input: SignIntentInput): Promise<{ signature: string }> {
    const unlocked = await unlockStoredWebWallet();
    const message = [
      input.domain,
      input.statement,
      `Nonce: ${input.nonce}`,
      `Wallet: ${unlocked.wallet.address}`,
    ].join("\n");
    const result = JSON.parse(
      unlocked.tcx.sign_message(
        JSON.stringify({
          chain: "ETHEREUM",
          derivationPath: WEB_DERIVATION_PATH,
          input: {
            message,
            signatureType: "PersonalSign",
          },
          key: unlocked.prfKeyHex,
          keystoreJson: unlocked.stored.keystoreJson,
        }),
      ),
    ) as SignedMessageResult;
    if (!result.signature) {
      throw new Error("tcx-wasm did not return a message signature.");
    }
    return { signature: result.signature };
  }

  async buildTransferIntent(input: TransferIntentInput): Promise<{ txPayload: string }> {
    if (!input.evmTx) {
      throw new Error(
        "Transfer signing requires a fully built EVM transaction with nonce, gas, value, and calldata.",
      );
    }

    const unlocked = await unlockStoredWebWallet();
    const result = JSON.parse(
      unlocked.tcx.sign_tx(
        JSON.stringify({
          chain: "ETHEREUM",
          derivationPath: WEB_DERIVATION_PATH,
          input: input.evmTx,
          key: unlocked.prfKeyHex,
          keystoreJson: unlocked.stored.keystoreJson,
        }),
      ),
    ) as SignedTxResult;
    const payload = result.signature ?? result.rawTx;
    if (!payload) {
      throw new Error("tcx-wasm did not return a signed EVM transaction payload.");
    }
    return { txPayload: payload };
  }
}

export function isWebTokenCoreAvailable() {
  return process.env.EXPO_OS === "web" && typeof window !== "undefined";
}

export async function exportWebTokenCoreWalletBackup() {
  const unlocked = await unlockStoredWebWallet();
  const backup = buildWebWalletBackup(unlocked.stored);
  return {
    address: unlocked.wallet.address,
    filename: `imtoken-agent-wallet-${unlocked.wallet.address.slice(0, 10)}.json`,
    json: JSON.stringify(backup, null, 2),
  };
}

export async function uploadWebTokenCoreCloudBackup() {
  const unlocked = await unlockStoredWebWallet();
  const { accessToken, user } = await getGoogleAccessTokenForServer();
  if (user.sub !== unlocked.stored.googleSub) {
    throw new Error("Google account changed. Sign in with the wallet owner account before uploading backup.");
  }
  const payload = await uploadStoredWebTokenCoreCloudBackup(unlocked.stored, accessToken, user);
  return {
    address: unlocked.wallet.address,
    savedAt: typeof payload.savedAt === "string" ? payload.savedAt : new Date().toISOString(),
  };
}

export async function restoreWebTokenCoreCloudBackup(): Promise<TokenCoreAgentWallet> {
  if (!isWebTokenCoreAvailable()) {
    throw new Error("Web wallet cloud restore only runs in the browser.");
  }
  const { accessToken, user } = await getGoogleAccessTokenForServer();
  const backup = await downloadWebTokenCoreCloudBackup(accessToken);
  if (!backup) {
    throw new Error("No Google wallet backup exists for this account yet.");
  }
  const wallet = await restoreParsedWebTokenCoreWalletBackup(backup, user.sub);
  appendWalletActivityRecord({
    detail: `Restored ${shortAddress(wallet.address)} from encrypted Google wallet backup.`,
    kind: "wallet_restored",
    source: "wallet",
    status: "restored",
    title: "Google wallet backup restored",
  });
  return wallet;
}

export async function exportWebTokenCoreRecoveryPhrase() {
  const unlocked = await unlockStoredWebWallet();
  const result = JSON.parse(
    unlocked.tcx.export_mnemonic(
      JSON.stringify({
        key: unlocked.prfKeyHex,
        keystoreJson: unlocked.stored.keystoreJson,
      }),
    ),
  ) as ExportMnemonicResult;
  if (!result.mnemonic) {
    throw new Error("tcx-wasm did not return a recovery phrase.");
  }
  return {
    address: unlocked.wallet.address,
    mnemonic: result.mnemonic,
  };
}

export async function restoreWebTokenCoreWalletBackup(rawJson: string): Promise<TokenCoreAgentWallet> {
  if (!isWebTokenCoreAvailable()) {
    throw new Error("Web wallet restore only runs in the browser.");
  }
  const backup = parseWebWalletBackup(rawJson);
  return restoreParsedWebTokenCoreWalletBackup(backup);
}

export async function importWebTokenCoreRecoveryPhrase(rawMnemonic: string): Promise<TokenCoreAgentWallet> {
  if (!isWebTokenCoreAvailable()) {
    throw new Error("Recovery phrase import only runs in the browser.");
  }
  const mnemonic = normalizeRecoveryPhrase(rawMnemonic);
  if (mnemonic.split(" ").length < 12) {
    throw new Error("Enter a complete recovery phrase before importing.");
  }

  const { accessToken, user } = await getGoogleAccessTokenForServer({ prompt: "consent" });
  const passkey = await createPasskeyPrfKey({
    email: user.email,
    name: user.name,
    userId: user.sub,
  });
  const tcx = await loadTcxWasm();
  const keystoreJson = tcx.create_keystore(
    JSON.stringify({
      credentialId: passkey.credentialId,
      mnemonic,
      network: "MAINNET",
      prfKey: passkey.prfKeyHex,
      rpId: passkey.rpId,
      userId: user.sub,
    }),
  );
  const account = deriveEvmAccount(tcx, {
    key: passkey.prfKeyHex,
    keystoreJson,
  });
  const stored: StoredWebWallet = {
    address: account.address,
    credentialId: passkey.credentialId,
    googleEmail: user.email,
    googleName: user.name,
    googleSub: user.sub,
    id: makeWebWalletId(user.sub),
    keystoreJson,
    rpId: passkey.rpId,
  };
  storeWebWallet(stored);
  try {
    await uploadStoredWebTokenCoreCloudBackup(stored, accessToken, user);
    lastWalletSyncNotice = "Recovery phrase imported locally and encrypted Google backup saved. The phrase was never sent to the server.";
    appendWalletActivityRecord({
      detail: `Imported ${shortAddress(stored.address)} from recovery phrase and saved encrypted Google wallet backup.`,
      kind: "wallet_restored",
      source: "wallet",
      status: "restored",
      title: "Recovery phrase imported",
    });
  } catch (error) {
    lastWalletSyncNotice = `Recovery phrase imported locally, but Google backup upload failed: ${formatErrorMessage(error)}. The phrase was never sent to the server.`;
    appendWalletActivityRecord({
      detail: `Imported ${shortAddress(stored.address)} from recovery phrase locally. Google wallet backup upload failed.`,
      kind: "wallet_restored",
      source: "wallet",
      status: "restored",
      title: "Recovery phrase imported locally",
    });
  }
  return toTokenCoreAgentWallet(stored);
}

export function takeWebTokenCoreWalletSyncNotice() {
  const notice = lastWalletSyncNotice;
  lastWalletSyncNotice = null;
  return notice;
}

async function downloadWebTokenCoreCloudBackup(accessToken: string): Promise<WebWalletBackup | null> {
  const response = await fetch(`${getAgentApiBaseUrl()}/api/wallet-backups/web`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });
  const payload = (await response.json().catch(() => ({}))) as CloudBackupPayload;
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(payload.error ?? `Google wallet backup lookup failed with HTTP ${response.status}.`);
  }
  return parseWebWalletBackupPayload(payload.backup);
}

async function uploadStoredWebTokenCoreCloudBackup(
  wallet: StoredWebWallet,
  accessToken: string,
  user: { email: string; sub: string },
): Promise<CloudBackupPayload> {
  if (user.sub !== wallet.googleSub) {
    throw new Error("Google account changed. Sign in with the wallet owner account before uploading backup.");
  }
  const backup = buildWebWalletBackup(wallet);
  const response = await fetch(`${getAgentApiBaseUrl()}/api/wallet-backups/web`, {
    body: JSON.stringify({ backup }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as CloudBackupPayload;
  if (!response.ok) {
    throw new Error(payload.error ?? `Google wallet backup upload failed with HTTP ${response.status}.`);
  }
  appendWalletActivityRecord({
    detail: `Saved encrypted backup for ${shortAddress(wallet.address)}. Server cannot decrypt it.`,
    kind: "wallet_backup",
    source: "wallet",
    status: "saved",
    title: "Google wallet backup saved",
  });
  return payload;
}

async function restoreParsedWebTokenCoreWalletBackup(
  backup: WebWalletBackup,
  expectedGoogleSub?: string,
): Promise<TokenCoreAgentWallet> {
  const expectedRpId = window.location.hostname;
  if (backup.wallet.rpId !== expectedRpId) {
    throw new Error(
      `This backup belongs to ${backup.wallet.rpId}. Restore it on the same domain, or export the recovery phrase before changing domains.`,
    );
  }
  const user = expectedGoogleSub
    ? { sub: expectedGoogleSub }
    : loadStoredGoogleUser() ?? (await signInWithGoogleWeb());
  if (user.sub !== backup.wallet.googleSub) {
    throw new Error(`This backup belongs to ${backup.wallet.googleEmail}. Sign in with that Google account first.`);
  }

  const tcx = await loadTcxWasm();
  const passkey = await getPasskeyPrfKey({
    credentialId: backup.wallet.credentialId,
    rpId: backup.wallet.rpId,
    userId: backup.wallet.googleSub,
  });
  const account = deriveEvmAccount(tcx, {
    key: passkey.prfKeyHex,
    keystoreJson: backup.wallet.keystoreJson,
  });
  if (account.address.toLowerCase() !== backup.wallet.address.toLowerCase()) {
    throw new Error("Backup verification failed: derived address does not match the backup address.");
  }

  storeWebWallet(backup.wallet);
  return toTokenCoreAgentWallet(backup.wallet);
}

function buildWebWalletBackup(wallet: StoredWebWallet): WebWalletBackup {
  return {
    createdAt: new Date().toISOString(),
    format: "imtoken-agent-wallet-web-backup-v1",
    wallet,
  };
}

async function unlockStoredWebWallet() {
  const user = loadStoredGoogleUser() ?? (await signInWithGoogleWeb());
  const stored = loadStoredWebWallet(user.sub);
  if (!stored) {
    throw new Error("Create the Google + Passkey Token Core web wallet before signing.");
  }
  const passkey = await getPasskeyPrfKey({
    credentialId: stored.credentialId,
    rpId: stored.rpId,
    userId: stored.googleSub,
  });
  const tcx = await loadTcxWasm();
  return {
    prfKeyHex: passkey.prfKeyHex,
    stored,
    tcx,
    wallet: toTokenCoreAgentWallet(stored),
  };
}

async function loadTcxWasm() {
  if (!tcxWasmPromise) {
    tcxWasmPromise = importTcxWasmModule().then(async (tcx) => {
      await tcx.default({ module_or_path: TCX_WASM_BINARY_PATH });
      return tcx;
    });
  }
  return tcxWasmPromise;
}

async function importTcxWasmModule(): Promise<TcxWasmModule> {
  if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
    const moduleUrl = new URL(TCX_WASM_MODULE_PATH, window.location.origin).toString();
    return importBrowserModule<TcxWasmModule>(moduleUrl);
  }
  return import("@consenlabs/tcx-wasm");
}

function importBrowserModule<TModule>(moduleUrl: string): Promise<TModule> {
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl)") as (
    moduleUrl: string,
  ) => Promise<TModule>;
  return dynamicImport(moduleUrl);
}

function deriveEvmAccount(
  tcx: TcxWasmModule,
  input: { key: string; keystoreJson: string },
): DerivedAccount {
  const accounts = JSON.parse(
    tcx.derive_accounts(
      JSON.stringify({
        derivations: [
          {
            chain: "ETHEREUM",
            chainId: "56",
            derivationPath: WEB_DERIVATION_PATH,
            network: "MAINNET",
          },
        ],
        key: input.key,
        keystoreJson: input.keystoreJson,
      }),
    ),
  ) as DerivedAccount[];
  const account = accounts.find((item) => item.chain === "ETHEREUM" && item.address.startsWith("0x"));
  if (!account) {
    throw new Error("tcx-wasm did not derive an EVM account.");
  }
  return account;
}

function loadStoredWebWallet(googleSub: string): StoredWebWallet | null {
  if (!isWebTokenCoreAvailable()) return null;
  const raw = window.localStorage.getItem(getWalletStorageKey(googleSub));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWebWallet;
  } catch {
    return null;
  }
}

function storeWebWallet(wallet: StoredWebWallet) {
  if (!isWebTokenCoreAvailable()) return;
  window.localStorage.setItem(getWalletStorageKey(wallet.googleSub), JSON.stringify(wallet));
  window.localStorage.setItem(WEB_WALLET_CURRENT_SUB_KEY, wallet.googleSub);
}

function loadCurrentSub() {
  if (!isWebTokenCoreAvailable()) return null;
  return window.localStorage.getItem(WEB_WALLET_CURRENT_SUB_KEY);
}

function getWalletStorageKey(googleSub: string) {
  return `${WEB_WALLET_KEY_PREFIX}.${googleSub}`;
}

function makeWebWalletId(googleSub: string) {
  return `web-google-passkey-${googleSub}`;
}

function normalizeRecoveryPhrase(rawMnemonic: string) {
  return rawMnemonic
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function parseWebWalletBackup(rawJson: string): WebWalletBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Backup JSON is not valid.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Backup JSON is empty.");
  }
  const backup = parsed as Partial<WebWalletBackup>;
  const wallet = backup.wallet as Partial<StoredWebWallet> | undefined;
  if (backup.format !== "imtoken-agent-wallet-web-backup-v1" || !wallet) {
    throw new Error("This is not an imToken Agent Wallet web backup.");
  }
  const required = [
    wallet.address,
    wallet.credentialId,
    wallet.googleEmail,
    wallet.googleName,
    wallet.googleSub,
    wallet.id,
    wallet.keystoreJson,
    wallet.rpId,
  ];
  if (required.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("Backup is missing required wallet fields.");
  }
  return backup as WebWalletBackup;
}

function parseWebWalletBackupPayload(value: unknown): WebWalletBackup {
  const rawJson = JSON.stringify(value);
  if (!rawJson) {
    throw new Error("Cloud backup response did not include backup JSON.");
  }
  return parseWebWalletBackup(rawJson);
}

function toTokenCoreAgentWallet(wallet: StoredWebWallet): TokenCoreAgentWallet {
  return {
    address: wallet.address,
    chain: "EVM",
    id: wallet.id,
    label: "Google Passkey Wallet",
    source: "web-token-core",
  };
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function shortAddress(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
