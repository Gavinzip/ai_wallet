export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  status: "done" | "waiting" | "review";
  surface: "mobile" | "web" | "extension" | "agent";
  time: string;
};

export const activityItems: ActivityItem[] = [
  {
    id: "token-core-status",
    title: "Token Core bridge check",
    detail: "Native iOS bridge is wired for local wallet creation, message signing, and BSC swap transaction signing.",
    surface: "mobile",
    status: "done",
    time: "Now",
  },
  {
    id: "web-token-core-wasm",
    title: "Token Core WASM web wallet",
    detail: "Web can create a Google + Passkey wallet with tcx-wasm. Google identifies the user; Passkey PRF unlocks the local keystore.",
    surface: "web",
    status: "review",
    time: "Now",
  },
  {
    id: "agent-api",
    title: "Agent chat API route installed",
    detail: "Minimax requests go through the server route so the API key never ships to the client.",
    surface: "agent",
    status: "done",
    time: "Now",
  },
  {
    id: "wallet-balances",
    title: "BSC swap provider installed",
    detail: "PancakeSwap BNB swaps use real BSC RPC for quote, nonce, gas, raw transaction submission, and BscScan hash review.",
    surface: "agent",
    status: "review",
    time: "Now",
  },
  {
    id: "chrome-extension",
    title: "Chrome extension companion",
    detail: "Manifest V3 package captures active pages, signs in with Google identity, verifies Token Core WASM, and opens agent review without taking page cookies.",
    surface: "extension",
    status: "review",
    time: "Now",
  },
  {
    id: "renaiss-skill",
    title: "RENAISS skill disabled",
    detail: "Low-price card automation is intentionally left inactive until the real strategy is provided.",
    surface: "agent",
    status: "waiting",
    time: "Now",
  },
];
