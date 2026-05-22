export type WalletActivityKind =
  | "message_signature"
  | "transaction"
  | "wallet_backup"
  | "wallet_created"
  | "wallet_restored";

export type WalletActivityStatus = "created" | "restored" | "saved" | "signed" | "submitted";

export type WalletActivityRecord = {
  id: string;
  amount?: string | null;
  chain?: string | null;
  detail: string;
  explorerUrl?: string | null;
  kind: WalletActivityKind;
  source: "agent" | "token-core" | "wallet";
  status: WalletActivityStatus;
  timestamp: string;
  title: string;
  token?: string | null;
  to?: string | null;
  txHash?: string | null;
};

const WALLET_ACTIVITY_STORAGE_KEY = "imtoken.walletActivity.v1";
const WALLET_ACTIVITY_EVENT = "imtoken-wallet-activity-updated";
const MAX_ACTIVITY_RECORDS = 80;

export function loadWalletActivityRecords(): WalletActivityRecord[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(WALLET_ACTIVITY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWalletActivityRecord).sort(sortNewestFirst);
  } catch {
    return [];
  }
}

export function appendWalletActivityRecord(
  input: Omit<WalletActivityRecord, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
  },
) {
  if (typeof window === "undefined") return;
  const nextRecord: WalletActivityRecord = {
    ...input,
    id: input.id ?? makeWalletActivityId(input.kind),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  const dedupeKey = getDedupeKey(nextRecord);
  const records = loadWalletActivityRecords().filter((record) => getDedupeKey(record) !== dedupeKey);
  const nextRecords = [nextRecord, ...records].sort(sortNewestFirst).slice(0, MAX_ACTIVITY_RECORDS);
  window.localStorage.setItem(WALLET_ACTIVITY_STORAGE_KEY, JSON.stringify(nextRecords));
  window.dispatchEvent(new CustomEvent(WALLET_ACTIVITY_EVENT));
}

export function subscribeWalletActivityRecords(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WALLET_ACTIVITY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(WALLET_ACTIVITY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function isWalletActivityRecord(value: unknown): value is WalletActivityRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WalletActivityRecord>;
  return (
    typeof record.id === "string"
    && typeof record.title === "string"
    && typeof record.detail === "string"
    && typeof record.timestamp === "string"
    && typeof record.kind === "string"
    && typeof record.status === "string"
    && typeof record.source === "string"
  );
}

function sortNewestFirst(a: WalletActivityRecord, b: WalletActivityRecord) {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

function getDedupeKey(record: WalletActivityRecord) {
  if (record.txHash) return `tx:${record.txHash.toLowerCase()}`;
  return record.id;
}

function makeWalletActivityId(kind: WalletActivityKind) {
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
