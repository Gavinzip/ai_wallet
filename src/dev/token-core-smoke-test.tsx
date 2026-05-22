import { useEffect, useRef } from "react";

import {
  createTcxKeystore,
  deleteTcxKeystore,
  deriveTcxEvmAccount,
  scanTcxKeystores,
  signTcxEthereumMessage,
  signTcxEthereumTransaction,
  utf8ToHex,
} from "@/services/token-core/token-core-protobuf";
import { getTokenCoreWalletAdapter } from "@/services/token-core/token-core-wallet-adapter";
import { createOrUnlockTokenCoreWallet } from "@/services/wallet/wallet-runtime";

const SMOKE_TEST_MESSAGE = "imToken Agent Wallet Token Core native smoke test";
const ISOLATED_SMOKE_WALLET_NAME = "Token Core Smoke Wallet 2026-05-18";

type IsolatedSmokeResult = {
  address?: string;
  error?: string;
  signature?: string;
  status: "deleted" | "failed" | "passed" | "skipped";
  txHash?: string;
  txSignature?: string;
};

type SmokeResult = {
  address?: string | null;
  appWalletError?: string;
  appWalletStatus?: "passed" | "failed";
  bridgeMode?: string;
  error?: string;
  isolatedAddress?: string;
  isolatedSignature?: string;
  isolatedTxHash?: string;
  isolatedTxSignature?: string;
  isolatedStatus?: "deleted" | "failed" | "passed" | "skipped";
  signature?: string;
  status: "skipped" | "passed" | "failed";
};

declare global {
  var __TOKEN_CORE_SMOKE_RESULT__: SmokeResult | undefined;
}

export function TokenCoreSmokeTest() {
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    if (!__DEV__ || process.env.EXPO_PUBLIC_TOKEN_CORE_SMOKE !== "1") {
      return;
    }

    const password = process.env.EXPO_PUBLIC_TOKEN_CORE_SMOKE_PASSWORD;
    if (!password) {
      const result: SmokeResult = {
        error: "EXPO_PUBLIC_TOKEN_CORE_SMOKE_PASSWORD is required.",
        status: "failed",
      };
      globalThis.__TOKEN_CORE_SMOKE_RESULT__ = result;
      console.error("[TokenCoreSmoke]", JSON.stringify(result));
      return;
    }

    void runTokenCoreSmokeTest(password);
  }, []);

  return null;
}

async function runTokenCoreSmokeTest(password: string) {
  const adapter = getTokenCoreWalletAdapter();

  try {
    console.log("[TokenCoreSmoke] starting", JSON.stringify({ bridgeMode: adapter.mode }));
    if (adapter.hasNativeBridge) {
      const loadedWallet = await adapter.loadAgentIdentityWallet();
      const keystores = await scanTcxKeystores(adapter.callRawTcxApi);
      console.log(
        "[TokenCoreSmoke] keystores",
        JSON.stringify({
          loadedWallet,
          scanned: keystores.map((keystore) => ({
            accountCount: keystore.accounts.length,
            hasEvmAccount: keystore.accounts.some(
              (account) => account.chainType === "ETHEREUM" && account.address.startsWith("0x"),
            ),
            id: keystore.id,
            name: keystore.name,
            source: keystore.source,
          })),
        }),
      );
    }

    let appWalletResult:
      | { address?: string | null; error?: string; signature?: string; status: "passed" | "failed" }
      | null = null;
    try {
      const snapshot = await createOrUnlockTokenCoreWallet(password);
      const walletId = snapshot.summary.address ?? "unknown";
      const signed = await adapter.signLoginChallenge({
        domain: "imtoken-agent-wallet.local",
        nonce: "native-smoke-2026-05-18",
        password,
        statement: SMOKE_TEST_MESSAGE,
        walletId,
      });
      appWalletResult = {
        address: snapshot.summary.address,
        signature: signed.signature,
        status: "passed",
      };
    } catch (error) {
      appWalletResult = {
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
      };
    }
    let isolatedResult: IsolatedSmokeResult;
    isolatedResult = await runOptionalIsolatedSmokeStep(password);

    const result: SmokeResult = {
      address: appWalletResult.address,
      appWalletError: appWalletResult.error,
      appWalletStatus: appWalletResult.status,
      bridgeMode: adapter.mode,
      isolatedAddress: isolatedResult.address,
      isolatedSignature: isolatedResult.signature,
      isolatedTxHash: isolatedResult.txHash,
      isolatedTxSignature: isolatedResult.txSignature,
      isolatedStatus: isolatedResult.status,
      signature: appWalletResult.signature,
      status: appWalletResult.status === "passed" ? "passed" : "failed",
    };
    globalThis.__TOKEN_CORE_SMOKE_RESULT__ = result;
    console.log("[TokenCoreSmoke]", JSON.stringify(result));
  } catch (error) {
    const result: SmokeResult = {
      bridgeMode: adapter.mode,
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
    globalThis.__TOKEN_CORE_SMOKE_RESULT__ = result;
    console.error("[TokenCoreSmoke]", JSON.stringify(result));
  }
}

async function runOptionalIsolatedSmokeStep(password: string): Promise<IsolatedSmokeResult> {
  try {
    if (process.env.EXPO_PUBLIC_TOKEN_CORE_DELETE_ISOLATED_SMOKE === "1") {
      const didDelete = await deleteIsolatedSmokeWallet(
        process.env.EXPO_PUBLIC_TOKEN_CORE_DELETE_ISOLATED_SMOKE_PASSWORD ?? password,
      );
      return { status: didDelete ? "deleted" : "skipped" };
    }

    const isolated = await runIsolatedTokenCoreSmokeTest(password);
    return { ...isolated, status: "passed" };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
  }
}

async function deleteIsolatedSmokeWallet(password: string) {
  const adapter = getTokenCoreWalletAdapter();
  const callRawTcxApi = adapter.callRawTcxApi.bind(adapter);
  const scanned = await scanTcxKeystores(callRawTcxApi);
  const existing = scanned.find((keystore) => keystore.name === ISOLATED_SMOKE_WALLET_NAME);
  if (!existing) return false;

  await deleteTcxKeystore(callRawTcxApi, {
    keystoreId: existing.id,
    password,
  });
  return true;
}

async function runIsolatedTokenCoreSmokeTest(password: string) {
  const adapter = getTokenCoreWalletAdapter();
  const callRawTcxApi = adapter.callRawTcxApi.bind(adapter);
  const scanned = await scanTcxKeystores(callRawTcxApi);
  const existing = scanned.find((keystore) => keystore.name === ISOLATED_SMOKE_WALLET_NAME);
  const keystore =
    existing ??
    (await createTcxKeystore(callRawTcxApi, {
      name: ISOLATED_SMOKE_WALLET_NAME,
      network: "MAINNET",
      password,
      passwordHint: "dev smoke only",
    }));

  const account = await deriveTcxEvmAccount(callRawTcxApi, {
    chainId: "56",
    keystoreId: keystore.id,
    password,
  });
  const signature = await signTcxEthereumMessage(callRawTcxApi, {
    keystoreId: keystore.id,
    messageHex: `0x${utf8ToHex(`${SMOKE_TEST_MESSAGE}\nWallet: ${account.address}`)}`,
    password,
  });
  const signedTx = await signTcxEthereumTransaction(callRawTcxApi, {
    chainId: "56",
    keystoreId: keystore.id,
    password,
    tx: {
      chainId: "56",
      data: "",
      gasLimit: "21000",
      gasPrice: "1000000000",
      nonce: "0",
      to: account.address,
      value: "0",
    },
  });

  return {
    address: account.address,
    signature,
    txHash: signedTx.txHash,
    txSignature: signedTx.signature,
  };
}
