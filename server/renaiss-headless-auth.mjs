import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as tcx from "@consenlabs/tcx-wasm/tcx_wasm.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, "..");
const derivationPath = "m/44'/60'/0'/0/0";

export async function createRenaissHeadlessSession(input = {}) {
  const chainId = Number(input.chainId ?? process.env.RENAISS_CHAIN_ID ?? 56);
  const origin = stripTrailingSlash(input.origin ?? process.env.RENAISS_ORIGIN ?? "https://www.renaiss.xyz");
  const tcxRuntime = await loadTokenCoreWasm();
  const wallet = createDiagnosticWallet(tcxRuntime, { chainId });
  const http = new RenaissAuthClient(origin);

  const nonceResponse = await http.postJson("/api/auth/siwe/nonce", {
    chainId,
    walletAddress: wallet.address.toLowerCase(),
  });
  assertOk(nonceResponse, "SIWE nonce request failed");

  const nonce = readNonce(nonceResponse.body);
  const issuedAt = new Date();
  const expirationTime = new Date(Date.now() + 5 * 60 * 1000);
  const siweMessage = createSiweMessage({
    address: wallet.address,
    chainId,
    domain: new URL(origin).host,
    expirationTime,
    issuedAt,
    nonce,
    scheme: new URL(origin).protocol.replace(":", ""),
    statement: "Sign in to Renaiss.",
    uri: origin,
    version: "1",
  });

  const signature = signTokenCoreMessage(tcxRuntime, wallet, siweMessage);
  const verifyResponse = await http.postJson("/api/auth/siwe/verify", {
    chainId,
    message: siweMessage,
    signature,
    walletAddress: wallet.address.toLowerCase(),
  });
  assertOk(verifyResponse, "SIWE verify failed");

  const sessionResponse = await http.getJson("/api/auth/get-session");
  assertOk(sessionResponse, "Session check failed");

  const sessionSummary = summarizeSession(sessionResponse.body);
  if (!sessionSummary.authenticated) {
    throw new Error(
      `SIWE verify returned OK, but get-session did not return an authenticated session. ${safeJson(sessionResponse.body)}`,
    );
  }

  return {
    cookieHeader: http.cookieHeader(),
    cookieNames: http.cookieNames(),
    origin,
    session: {
      authenticated: sessionSummary.authenticated,
      ownerWalletAddress: sessionSummary.ownerWalletAddress,
      signedWalletAddress: wallet.address,
      signedWalletLinked: addressesEqual(wallet.address, sessionSummary.ownerWalletAddress),
      userId: sessionSummary.userId,
      walletAddress: sessionSummary.walletAddress,
      walletSource: wallet.imported ? "RENAISS_TEST_MNEMONIC" : "ephemeral diagnostic wallet",
    },
  };
}

export function printRenaissHeadlessSession(result, output = console.log) {
  output(`RENAISS origin: ${result.origin}`);
  output("SIWE verify: ok");
  output(`Session authenticated: ${result.session.authenticated}`);
  output(`Session user id: ${result.session.userId ?? "(none)"}`);
  output(`Session owner wallet: ${result.session.ownerWalletAddress ?? "(none)"}`);
  output(`Session app wallet: ${result.session.walletAddress ?? "(none)"}`);
  output(`Signed wallet linked: ${result.session.signedWalletLinked}`);
  output(`Set-Cookie names: ${result.cookieNames.join(", ") || "(none)"}`);
}

async function loadTokenCoreWasm() {
  const wasmPath = path.join(
    projectRoot,
    "node_modules",
    "@consenlabs",
    "tcx-wasm",
    "tcx_wasm_bg.wasm",
  );
  const wasmBytes = await readFile(wasmPath);
  await tcx.default({ module_or_path: wasmBytes });
  return tcx;
}

function createDiagnosticWallet(tcxRuntime, { chainId }) {
  const password = process.env.RENAISS_TEST_PASSWORD ?? `renaiss-headless-${crypto.randomUUID()}`;
  const mnemonic = process.env.RENAISS_TEST_MNEMONIC;
  const keystoreJson = tcxRuntime.create_keystore(
    JSON.stringify({
      ...(mnemonic ? { mnemonic } : {}),
      network: "MAINNET",
      password,
    }),
  );
  const accounts = JSON.parse(
    tcxRuntime.derive_accounts(
      JSON.stringify({
        derivations: [
          {
            chain: "ETHEREUM",
            chainId: String(chainId),
            derivationPath,
            network: "MAINNET",
          },
        ],
        key: password,
        keystoreJson,
      }),
    ),
  );
  const account = accounts.find((item) => item.chain === "ETHEREUM" && item.address?.startsWith("0x"));
  if (!account) {
    throw new Error("Token Core did not derive an EVM account.");
  }
  return {
    address: account.address,
    imported: Boolean(mnemonic),
    keystoreJson,
    password,
  };
}

function signTokenCoreMessage(tcxRuntime, wallet, message) {
  const signed = JSON.parse(
    tcxRuntime.sign_message(
      JSON.stringify({
        chain: "ETHEREUM",
        derivationPath,
        input: {
          message,
          signatureType: "PersonalSign",
        },
        key: wallet.password,
        keystoreJson: wallet.keystoreJson,
      }),
    ),
  );
  if (!signed.signature) {
    throw new Error("Token Core did not return a SIWE signature.");
  }
  return signed.signature;
}

export function createSiweMessage(input) {
  const header = `${input.scheme}://${input.domain} wants you to sign in with your Ethereum account:`;
  return [
    header,
    input.address,
    "",
    input.statement,
    "",
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expirationTime.toISOString()}`,
  ].join("\n");
}

export function readNonce(body) {
  if (body && typeof body === "object" && typeof body.nonce === "string" && body.nonce.length > 0) {
    return body.nonce;
  }
  throw new Error(`SIWE nonce response did not include nonce: ${safeJson(body)}`);
}

export class RenaissAuthClient {
  #cookies = new Map();

  constructor(origin) {
    this.origin = origin;
  }

  async getJson(pathname) {
    return this.#requestJson("GET", pathname);
  }

  async postJson(pathname, body) {
    return this.#requestJson("POST", pathname, body);
  }

  cookieHeader() {
    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  cookieNames() {
    return [...this.#cookies.keys()].sort();
  }

  async #requestJson(method, pathname, body) {
    const headers = {
      accept: "application/json",
      origin: this.origin,
      referer: `${this.origin}/`,
      "user-agent": "imtoken-agent-wallet/renaiss-headless-login",
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const cookie = this.cookieHeader();
    if (cookie) {
      headers.cookie = cookie;
    }

    const response = await fetch(`${this.origin}${pathname}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
      redirect: "manual",
    });
    this.#storeSetCookies(response.headers);
    return {
      body: await readResponseBody(response),
      status: response.status,
      statusText: response.statusText,
    };
  }

  #storeSetCookies(headers) {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : splitSetCookieHeader(headers.get("set-cookie"));
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      this.#cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim()).filter(Boolean);
}

export function summarizeSession(body) {
  if (!body || typeof body !== "object") {
    return { authenticated: false };
  }
  return {
    authenticated: Boolean(body.session && body.user),
    ownerWalletAddress:
      readFirstString(
        body.user?.ownerWalletAddress,
        body.session?.ownerWalletAddress,
        body.user?.address,
      ) ?? null,
    userId: typeof body.user?.id === "string" ? body.user.id : null,
    walletAddress:
      readFirstString(
        body.user?.walletAddress,
        body.session?.walletAddress,
      ) ?? null,
  };
}

function readFirstString(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function assertOk(response, label) {
  if (response.status >= 200 && response.status < 300) return;
  throw new Error(`${label}: HTTP ${response.status} ${response.statusText} ${safeJson(response.body)}`);
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function addressesEqual(first, second) {
  return typeof first === "string" && typeof second === "string" && first.toLowerCase() === second.toLowerCase();
}

export function stripTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}
