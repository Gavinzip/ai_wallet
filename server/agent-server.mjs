import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  Chain,
  CONTRACT_ADDRESSES,
  TOKENS_ADDRESSES,
  UnifiToken,
  VAULTS_ADDRESSES,
} from "@pufferfinance/puffer-sdk";

import {
  createRenaissHeadlessSession,
  createSiweMessage,
  readNonce,
  RenaissAuthClient,
  summarizeSession,
} from "./renaiss-headless-auth.mjs";
import {
  buildRenaissPurchasePlan,
  RENAISS_PURCHASE_CHAIN_ID,
  RENAISS_PURCHASE_ORIGIN,
  submitRenaissBuyNow,
} from "./renaiss-purchase.mjs";
import {
  buildRenaissListingPlan,
  submitRenaissSellOffer,
} from "./renaiss-listing.mjs";

loadDotEnv();

const port = Number(process.env.PORT ?? process.env.AGENT_SERVER_PORT ?? 8787);
const projectRoot = process.cwd();
const STATIC_DIST_DIR = path.resolve(process.env.WEB_DIST_DIR ?? path.join(projectRoot, "dist"));
const PANCAKESWAP_SWAP_URL = "https://pancakeswap.finance/swap";
const PANCAKESWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const PANCAKESWAP_OUTPUTS = new Set(["USDC", "USDT", "CAKE"]);
const BSC_TRANSFER_TOKENS = new Map([
  ["BNB", { decimals: 18, native: true, symbol: "BNB" }],
  ["USDT", { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, symbol: "USDT" }],
  ["USDC", { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, symbol: "USDC" }],
  ["CAKE", { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, symbol: "CAKE" }],
  ["WBNB", { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, symbol: "WBNB" }],
]);
const VENUS_APP_URL = "https://app.venus.io/";
const LISTA_APP_URL = "https://lista.org/";
const PUFFER_MAINNET = Chain.Mainnet;
const PUFFER_HOLESKY = Chain.Holesky;
const PUFFER_PREVIEW_DEPOSIT_SELECTOR = "ef8b30f7";
const PUFFER_DECIMALS = 18;
const RENAISS_MONITOR_API_URL = trimTrailingSlash(
  process.env.RENAISS_MONITOR_API_URL ?? "https://renaissmon.zeabur.app",
);
const RENAISS_PROXY_TIMEOUT_MS = 70_000;
const RENAISS_FRESH_CACHE_MS = 120_000;
const BITREFILL_API_BASE_URL = trimTrailingSlash(
  process.env.BITREFILL_API_BASE_URL ?? "https://api.bitrefill.com/v2",
);
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const HOLESKY_RPC_URL = process.env.HOLESKY_RPC_URL ?? "https://holesky.drpc.org";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const BSC_RPC_URL =
  process.env.BSC_RPC_URL ?? process.env.EXPO_PUBLIC_BSC_RPC_URL ?? "https://bsc-dataseed-public.bnbchain.org";
const BSC_TESTNET_RPC_URL =
  process.env.BSC_TESTNET_RPC_URL ??
  process.env.EXPO_PUBLIC_BSC_TESTNET_RPC_URL ??
  "https://bsc-testnet-dataseed.bnbchain.org";
const BASE_RPC_URL =
  process.env.BASE_RPC_URL ?? process.env.EXPO_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org";
const POLYGON_RPC_URL =
  process.env.POLYGON_RPC_URL ?? process.env.EXPO_PUBLIC_POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";
const RENAISS_SCAN_CACHE_PATH = process.env.RENAISS_SCAN_CACHE_PATH ??
  path.join(process.cwd(), ".tmp", "renaiss-scan-cache.json");
const WEB_WALLET_BACKUP_DIR = process.env.WEB_WALLET_BACKUP_DIR ??
  path.join(process.cwd(), ".tmp", "web-wallet-backups");
const renaissWebhookAlerts = [];
let activeRenaissSession = null;
const pendingRenaissSiweChallenges = new Map();
const renaissSessionsByWallet = new Map();

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const staticContentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      minimaxConfigured: Boolean(process.env.MINIMAX_API_KEY),
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(response, 200, {
      chromeExtensionGoogleClientConfigured: Boolean(process.env.CHROME_EXTENSION_GOOGLE_CLIENT_ID),
      googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "",
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/wallet-backups/web") {
    await handleWebWalletBackupGet(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/wallet-backups/web") {
    await handleWebWalletBackupPost(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/health") {
    await proxyRenaissJson(response, "/health");
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/listings/latest") {
    await proxyRenaissJson(response, `/v1/listings/latest?${buildRenaissListingsQuery(requestUrl).toString()}`);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/opportunities/scan") {
    await handleRenaissScan(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/opportunities/latest") {
    await handleRenaissRemoteLatest(response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/opportunities/cache") {
    await handleRenaissScanCache(response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/analyze/item-id") {
    await handleRenaissAnalyze(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/ai-review") {
    await handleRenaissAiReview(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/session/headless-login") {
    await handleRenaissHeadlessLogin(response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/session/siwe/nonce") {
    await handleRenaissSiweNonce(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/session/siwe/verify") {
    await handleRenaissSiweVerify(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/session/current") {
    sendJson(response, 200, sanitizeRenaissSession(activeRenaissSession));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/purchase/prepare") {
    await handleRenaissPurchasePrepare(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/purchase/submit") {
    await handleRenaissPurchaseSubmit(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/listing/submit") {
    await handleRenaissListingSubmit(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/renaiss/alerts/webhook") {
    await handleRenaissWebhook(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/alerts") {
    sendJson(response, 200, {
      alerts: renaissWebhookAlerts.slice(-20).reverse(),
      count: renaissWebhookAlerts.length,
    });
    return;
  }

  if (
    request.method === "POST" &&
    (requestUrl.pathname === "/api/ethereum/rpc" || requestUrl.pathname === "/api/evm/rpc")
  ) {
    await handleEvmRpcProxy(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/bitrefill/status") {
    sendJson(response, 200, {
      authMode: getBitrefillAuthMode(),
      configured: Boolean(getBitrefillAuthorizationHeader()),
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/bitrefill/products/search") {
    await handleBitrefillProductSearch(requestUrl, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/bitrefill/invoices/")) {
    await handleBitrefillInvoiceGet(requestUrl, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/bitrefill/invoices") {
    await handleBitrefillInvoice(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/agent/chat") {
    await handleAgentChat(request, response);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    if (serveStaticWeb(request, response, requestUrl)) return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Agent server listening on http://localhost:${port}`);
  if (fs.existsSync(path.join(STATIC_DIST_DIR, "index.html"))) {
    console.log(`Serving web export from ${STATIC_DIST_DIR}`);
  }
});

async function handleAgentChat(request, response) {
  try {
    const body = await readJson(request);
    const messages = validateMessages(body.messages);
    const enabledSkills = validateSkills(body.enabledSkills);
    const walletAddress = normalizeOptionalEvmAddress(body.walletAddress);
    if (!messages.length) {
      sendJson(response, 400, {
        error: "At least one user message is required.",
      });
      return;
    }

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const semanticActionRoute = await classifyWalletActionRoute({ enabledSkills, lastUserMessage, messages });
    if (await handleSemanticWalletActionRoute({
      enabledSkills,
      lastUserMessage,
      messages,
      response,
      route: semanticActionRoute,
      walletAddress,
    })) {
      return;
    }

    if (isContextualRecommendationRequest(lastUserMessage)) {
      if (hasBitrefillSkill(enabledSkills) && hasRecentBitrefillContext(messages)) {
        await handleBitrefillRecommendationChat(lastUserMessage, response);
        return;
      }
      if (hasRenaissSkill(enabledSkills) && hasRecentRenaissContext(messages)) {
        await handleRenaissChatRecommendation(lastUserMessage, response);
        return;
      }
      await handleRecommendationClarificationChat(response);
      return;
    }
    if (hasBitrefillSkill(enabledSkills) && isBitrefillRequest(lastUserMessage)) {
      await handleBitrefillChat(lastUserMessage, response);
      return;
    }
    if (hasBitrefillSkill(enabledSkills) && hasRecentBitrefillContext(messages) && isBitrefillPaymentQuestion(lastUserMessage)) {
      await handleBitrefillPaymentQuestionChat(response);
      return;
    }
    if (hasPufferSkill(enabledSkills) && isPufferRequest(lastUserMessage)) {
      await handlePufferChat(lastUserMessage, response);
      return;
    }
    if (isWalletTransferRequest(lastUserMessage)) {
      await handleBscTransferChat(lastUserMessage, response, walletAddress);
      return;
    }
    const semanticRenaissRoute = hasRenaissSkill(enabledSkills)
      ? await classifyRenaissChatRoute({ enabledSkills, lastUserMessage, messages })
      : null;
    if (semanticRenaissRoute?.intent === "listing") {
      await handleRenaissListingChat(lastUserMessage, response, walletAddress);
      return;
    }
    if (semanticRenaissRoute?.intent === "purchase") {
      await handleRenaissPurchaseChat(messages, response, walletAddress);
      return;
    }
    if (semanticRenaissRoute?.intent === "recommendation") {
      await handleRenaissChatRecommendation(lastUserMessage, response);
      return;
    }
    if (hasRenaissSkill(enabledSkills) && isRenaissListingRequest(lastUserMessage)) {
      await handleRenaissListingChat(lastUserMessage, response, walletAddress);
      return;
    }
    if (hasRenaissSkill(enabledSkills) && isRenaissPurchaseRequest(lastUserMessage)) {
      await handleRenaissPurchaseChat(messages, response, walletAddress);
      return;
    }
    if (
      hasRenaissSkill(enabledSkills)
      && (isGenericPurchaseRequest(lastUserMessage) || isRenaissShortPurchaseConfirmation(lastUserMessage))
      && findLatestRenaissPurchaseContext(messages)
    ) {
      await handleRenaissPurchaseChat(messages, response, walletAddress);
      return;
    }
    if (hasRenaissSkill(enabledSkills) && isRenaissRecommendationRequest(lastUserMessage)) {
      await handleRenaissChatRecommendation(lastUserMessage, response);
      return;
    }
    if (isBscDefiRequest(lastUserMessage)) {
      await handleBscDefiChat(lastUserMessage, response);
      return;
    }
    if (isGenericPurchaseRequest(lastUserMessage)) {
      await handleGenericPurchaseChat(response);
      return;
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      sendJson(response, 503, {
        error: "MINIMAX_API_KEY is not configured on the server.",
      });
      return;
    }

    const model = process.env.MINIMAX_MODEL ?? "MiniMax-M2.7";
    const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
    const minimaxResponse = await fetch(`${baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          {
            content:
              buildSystemPrompt(enabledSkills),
            role: "system",
          },
          ...messages,
        ],
        model,
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const data = await minimaxResponse.json();
    if (!minimaxResponse.ok) {
      sendJson(response, minimaxResponse.status, {
        error: data.error?.message ?? data.base_resp?.status_msg ?? "MiniMax request failed.",
      });
      return;
    }

    const rawContent = data.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string" || rawContent.length === 0) {
      sendJson(response, 502, {
        error: "MiniMax response did not include assistant content.",
      });
      return;
    }

    const agentResponse = parseStrictAgentResponse(rawContent);
    sendJson(response, 200, {
      intent: normalizeWalletIntent(agentResponse.intent),
      message: agentResponse.message,
      model,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Agent chat failed.",
    });
  }
}

async function classifyWalletActionRoute({ enabledSkills, lastUserMessage, messages }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;

  const model = process.env.MINIMAX_MODEL ?? "MiniMax-M2.7";
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  const minimaxResponse = await fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            "你是自託管錢包 agent 的 action router。",
            "你的任務是把使用者自然語言整理成固定 schema；你不能回答使用者、不能產生 wallet intent、不能產生交易 payload。",
            "如果欄位缺失，要放在 missingFields，不要猜。",
            "只回傳 strict JSON：",
            "{\"intent\":\"transfer|swap|bitrefill_search|bitrefill_payment_question|puffer|renaiss_listing|renaiss_purchase|renaiss_recommendation|bsc_defi_review|generic_purchase|none\",\"confidence\":0,\"fields\":{\"chain\":null,\"token\":null,\"amount\":null,\"toAddress\":null,\"fromToken\":null,\"toToken\":null,\"protocol\":null,\"productQuery\":null,\"country\":null,\"denomination\":null,\"cardUrl\":null,\"tokenId\":null,\"askPrice\":null},\"missingFields\":[\"string\"],\"reason\":\"string\"}",
            "transfer = 使用者要轉帳、發送、匯款、send、transfer。",
            "swap = 使用者要 swap / 兌換，尤其 PancakeSwap 或 BNB 換 USDC/USDT/CAKE。",
            "bitrefill_search = 使用者要找或買 Bitrefill 商品、禮品卡、eSIM、儲值。",
            "bitrefill_payment_question = 使用者在 Bitrefill 上下文問付款幣種、用什麼貨幣、currency、payment。",
            "puffer = 使用者問 Puffer / pufETH / UniFi vault / ETH staking。",
            "renaiss_listing = 使用者要 RENAISS 掛單、上架、出售、賣卡、設定 ask price。",
            "renaiss_purchase = 使用者要買入先前推薦或分析過的 RENAISS 卡，或對購買流程確認。",
            "renaiss_recommendation = 使用者要 RENAISS 特價卡、卡牌推薦、價格分析、警報、撿漏列表。",
            "bsc_defi_review = Venus、Lista 或其他 BSC DeFi 風險審核。",
            "generic_purchase = 使用者只說要購買但沒有商品/平台/鏈上動作。",
            "none = 一般聊天或無法判定。",
            "重要：掛單/上架/出售/賣 永遠優先 renaiss_listing，不要分類為 renaiss_purchase。",
            "重要：轉帳時必須抽出 chain、token、amount、toAddress；缺任何一個就放 missingFields。",
          ].join("\n"),
          role: "system",
        },
        {
          content: JSON.stringify({
            enabledSkills: enabledSkills.map((skill) => ({
              name: skill.name,
              policySummary: skill.policySummary,
              trigger: skill.trigger,
            })),
            hasRecentBitrefillContext: hasRecentBitrefillContext(messages),
            hasRecentRenaissContext: hasRecentRenaissContext(messages),
            lastUserMessage: stringOrEmpty(lastUserMessage).slice(0, 800),
            recentMessages: messages.slice(-8).map((message) => ({
              content: stringOrEmpty(message.content).slice(0, 900),
              role: message.role,
            })),
            recentRenaissPurchaseContext: findLatestRenaissPurchaseContext(messages),
          }),
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  let data;
  try {
    data = await minimaxResponse.json();
  } catch {
    data = null;
  }
  if (!minimaxResponse.ok) {
    throw new Error(data?.error?.message ?? data?.base_resp?.status_msg ?? "MiniMax action route classification failed.");
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    throw new Error("MiniMax action route classification did not include assistant content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(extractFirstJsonObject(rawContent));
  } catch {
    throw new Error("MiniMax action route classification was not strict JSON.");
  }

  const intent = stringOrEmpty(parsed.intent).toLowerCase();
  const allowed = new Set([
    "transfer",
    "swap",
    "bitrefill_search",
    "bitrefill_payment_question",
    "puffer",
    "renaiss_listing",
    "renaiss_purchase",
    "renaiss_recommendation",
    "bsc_defi_review",
    "generic_purchase",
    "none",
  ]);
  if (!allowed.has(intent)) {
    throw new Error("MiniMax action route classification returned an unknown intent.");
  }

  return {
    confidence: nullableNumber(parsed.confidence, 0, 100) ?? 0,
    fields: parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {},
    intent,
    missingFields: Array.isArray(parsed.missingFields)
      ? parsed.missingFields.map((item) => stringOrEmpty(item)).filter(Boolean).slice(0, 8)
      : [],
    model,
    reason: stringOrEmpty(parsed.reason).slice(0, 240),
  };
}

async function handleSemanticWalletActionRoute({
  enabledSkills,
  lastUserMessage,
  messages,
  response,
  route,
  walletAddress,
}) {
  if (!route || route.intent === "none" || route.confidence < 50) return false;

  if (route.intent === "transfer") {
    await handleBscTransferChat(lastUserMessage, response, walletAddress, route.fields);
    return true;
  }

  if (route.intent === "swap") {
    await handlePancakeSwapActionChat(route.fields, response);
    return true;
  }

  if (route.intent === "bitrefill_payment_question" && hasBitrefillSkill(enabledSkills)) {
    await handleBitrefillPaymentQuestionChat(response);
    return true;
  }

  if (route.intent === "bitrefill_search" && hasBitrefillSkill(enabledSkills)) {
    await handleBitrefillChat(lastUserMessage, response);
    return true;
  }

  if (route.intent === "puffer" && hasPufferSkill(enabledSkills)) {
    await handlePufferChat(lastUserMessage, response);
    return true;
  }

  if (route.intent === "renaiss_listing" && hasRenaissSkill(enabledSkills)) {
    await handleRenaissListingChat(lastUserMessage, response, walletAddress);
    return true;
  }

  if (route.intent === "renaiss_purchase" && hasRenaissSkill(enabledSkills)) {
    await handleRenaissPurchaseChat(messages, response, walletAddress);
    return true;
  }

  if (route.intent === "renaiss_recommendation" && hasRenaissSkill(enabledSkills)) {
    await handleRenaissChatRecommendation(lastUserMessage, response);
    return true;
  }

  if (route.intent === "bsc_defi_review") {
    await handleBscDefiChat(lastUserMessage, response);
    return true;
  }

  if (route.intent === "generic_purchase") {
    await handleGenericPurchaseChat(response);
    return true;
  }

  return false;
}

async function handleWebWalletBackupGet(request, response) {
  try {
    const googleUser = await verifyGoogleBearerUser(request);
    const filePath = getWebWalletBackupPath(googleUser.sub);
    if (!fs.existsSync(filePath)) {
      sendJson(response, 404, {
        error: "No cloud backup exists for this Google account yet.",
      });
      return;
    }

    const backup = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    const sanitized = sanitizeWebWalletBackup(backup);
    if (sanitized.wallet.googleSub !== googleUser.sub) {
      sendJson(response, 403, { error: "Cloud backup owner mismatch." });
      return;
    }

    sendJson(response, 200, {
      backup: sanitized,
      savedAt: nullableString(sanitized.savedAt) ?? nullableString(sanitized.createdAt) ?? null,
    });
  } catch (error) {
    sendJson(response, getAuthErrorStatus(error), {
      error: error instanceof Error ? error.message : "Cloud backup restore failed.",
    });
  }
}

async function handleWebWalletBackupPost(request, response) {
  try {
    const googleUser = await verifyGoogleBearerUser(request);
    const body = await readJson(request);
    const backup = sanitizeWebWalletBackup(body.backup);
    if (backup.wallet.googleSub !== googleUser.sub) {
      sendJson(response, 403, {
        error: "Backup Google account does not match the authenticated Google account.",
      });
      return;
    }
    if (backup.wallet.googleEmail && googleUser.email && backup.wallet.googleEmail !== googleUser.email) {
      sendJson(response, 403, {
        error: "Backup Google email does not match the authenticated Google account.",
      });
      return;
    }

    const savedAt = new Date().toISOString();
    const stored = {
      ...backup,
      savedAt,
    };
    await fs.promises.mkdir(WEB_WALLET_BACKUP_DIR, { recursive: true, mode: 0o700 });
    const filePath = getWebWalletBackupPath(googleUser.sub);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await fs.promises.rename(tempPath, filePath);

    sendJson(response, 200, {
      address: backup.wallet.address,
      savedAt,
    });
  } catch (error) {
    sendJson(response, getAuthErrorStatus(error), {
      error: error instanceof Error ? error.message : "Cloud backup upload failed.",
    });
  }
}

async function handleRenaissScan(request, response) {
  try {
    const body = await readJson(request);
    const keepLimit = clampInteger(Number(body.keep_limit ?? body.limit ?? 5), 1, 30, 5);
    const payload = compactRenaissRequestPayload({
      cache_ttl_seconds: nullableNumber(body.cache_ttl_seconds, 1, 86_400),
      force_refresh: Boolean(body.force_refresh),
      include_full_records: body.include_full_records !== false,
      keep_limit: keepLimit,
      limit: keepLimit,
      min_profit_usd: clampNumber(body.min_profit_usd, 0, 1_000_000, 0),
      notify_wallet: false,
      only_actionable: Boolean(body.only_actionable),
      reference_id: nullableString(body.reference_id),
      scan_limit: clampInteger(Number(body.scan_limit ?? body.limit ?? 30), 1, 100, 30),
      threshold_percent: nullableNumber(body.threshold_percent, -100, 100),
      use_cache: body.use_cache !== false,
      wallet_budget_usd: nullableNumber(body.wallet_budget_usd, 0, 1_000_000),
    });
    try {
      const scan = await fetchRenaissJson("/v1/opportunities/scan", {
        body: payload,
        method: "POST",
        timeoutMs: RENAISS_PROXY_TIMEOUT_MS,
      });
      const cachedAt = new Date().toISOString();
      const responsePayload = withRenaissCacheMeta(scan, {
        cachedAt,
        status: "live",
      });
      await writeRenaissScanCache(responsePayload);
      sendJson(response, 200, responsePayload);
    } catch (scanError) {
      const cached = await readRenaissScanCache();
      if (cached?.opportunities?.length) {
        sendJson(response, 200, withRenaissCacheMeta(cached, {
          cachedAt: cached.cache?.cachedAt ?? null,
          reason: formatErrorMessage(scanError),
          status: "stale",
        }));
        return;
      }
      throw scanError;
    }
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "RENAISS opportunity scan failed.",
    });
  }
}

async function handleRenaissRemoteLatest(response) {
  try {
    const latest = await fetchRemoteRenaissLatestOpportunities();
    const responsePayload = withRenaissCacheMeta(latest, normalizeRenaissCacheMeta(latest, {
      cachedAt: latest?.time_utc ?? new Date().toISOString(),
      status: "cached",
    }));
    await writeRenaissScanCache(responsePayload);
    sendJson(response, 200, responsePayload);
  } catch (latestError) {
    const cached = await readRenaissScanCache();
    if (cached?.opportunities?.length) {
      sendJson(response, 200, withRenaissCacheMeta(cached, {
        cachedAt: cached.cache?.cachedAt ?? null,
        reason: formatErrorMessage(latestError),
        status: "stale",
      }));
      return;
    }
    sendJson(response, 404, {
      error: formatErrorMessage(latestError),
    });
  }
}

async function handleRenaissScanCache(response) {
  const cached = await readRenaissScanCache();
  if (!cached?.opportunities?.length) {
    sendJson(response, 404, { error: "No cached RENAISS scan is available yet." });
    return;
  }
  sendJson(response, 200, withRenaissCacheMeta(cached, {
    cachedAt: cached.cache?.cachedAt ?? null,
    status: "cached",
  }));
}

async function handleRenaissAnalyze(request, response) {
  try {
    const body = await readJson(request);
    const itemId = stringOrEmpty(body.item_id).trim();
    if (!itemId) {
      sendJson(response, 400, { error: "item_id is required." });
      return;
    }
    const payload = compactRenaissRequestPayload({
      include_full_records: body.include_full_records !== false,
      item_id: itemId,
      min_profit_usd: clampNumber(body.min_profit_usd, 0, 1_000_000, 0),
      threshold_percent: nullableNumber(body.threshold_percent, -100, 100),
      wallet_budget_usd: nullableNumber(body.wallet_budget_usd, 0, 1_000_000),
    });
    const payloadResponse = await fetchRenaissJson("/v1/analyze/item-id", {
      body: payload,
      method: "POST",
      timeoutMs: RENAISS_PROXY_TIMEOUT_MS,
    });
    sendJson(response, 200, sanitizeRenaissAnalysisResponse(payloadResponse, payloadResponse?.result));
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "RENAISS item analysis failed.",
    });
  }
}

async function handleRenaissAiReview(request, response) {
  try {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      sendJson(response, 503, {
        error: "MINIMAX_API_KEY is not configured on the server.",
      });
      return;
    }

    const body = await readJson(request);
    sendJson(response, 200, await createRenaissAiReview(body));
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "RENAISS AI review failed.",
    });
  }
}

async function handleRenaissChatRecommendation(userMessage, response) {
  try {
    let scanCacheNotice = null;
    let analysisNotice = null;
    let scan;
    try {
      scan = await fetchRemoteRenaissLatestOpportunities();
      const responsePayload = withRenaissCacheMeta(scan, normalizeRenaissCacheMeta(scan, {
        cachedAt: scan?.time_utc ?? new Date().toISOString(),
        status: "cached",
      }));
      await writeRenaissScanCache(responsePayload);
      scan = responsePayload;
      scanCacheNotice = `使用 RENAISS monitor 自動更新快取（${formatServerTime(scan.cache?.cachedAt ?? scan.time_utc)}）。`;
    } catch (scanError) {
      const cached = await readRenaissScanCache();
      if (!cached?.opportunities?.length) throw scanError;
      scan = cached;
      scanCacheNotice = `遠端最新快取暫時不可用，先用錢包伺服器保存的最近快取（原因：${formatErrorMessage(scanError)}）。`;
    }
    const opportunities = Array.isArray(scan?.opportunities) ? scan.opportunities : [];
    if (isRenaissCardListRequest(userMessage)) {
      const ranked = rankRenaissOpportunities(opportunities).filter(isPositiveRenaissDeal).slice(0, 8);
      sendJson(response, 200, {
        intent: null,
        message: [
          scanCacheNotice ? `資料狀態：${scanCacheNotice}` : null,
          formatRenaissOpportunityList(ranked),
        ].filter(Boolean).join("\n"),
        model: "renaiss-monitor",
      });
      return;
    }

    const requestedIndex = extractRenaissListIndex(userMessage);
    const ranked = rankRenaissOpportunities(opportunities).filter(isPositiveRenaissDeal);
    const selected = requestedIndex === null
      ? pickBestRenaissOpportunity(opportunities)
      : ranked[requestedIndex - 1] ?? null;

    if (!selected?.item_id) {
      sendJson(response, 200, {
        intent: null,
        message: "我剛剛查了 RENAISS monitor，目前沒有拿到可分析的卡牌推薦。你可以晚點再叫我掃一次，或等 webhook 警報進來。",
        model: "renaiss-monitor",
      });
      return;
    }

    let analysis;
    try {
      analysis = await fetchRenaissJson("/v1/analyze/item-id", {
        body: compactRenaissRequestPayload({
          include_full_records: true,
          item_id: selected.item_id,
          min_profit_usd: 0,
          threshold_percent: null,
          wallet_budget_usd: null,
        }),
        method: "POST",
        timeoutMs: 45_000,
      });
    } catch (analysisError) {
      analysis = { result: selected };
      analysisNotice = `完整價格資料暫時沒有回來，這次只用掃描摘要判斷（原因：${formatErrorMessage(analysisError)}）。`;
    }
    const review = await createRenaissAiReview({
      analysis,
      opportunity: analysis?.result ?? selected,
      userMessage,
    });

    const notices = [scanCacheNotice, analysisNotice].filter(Boolean);
    sendJson(response, 200, {
      intent: null,
      message: [
        ...notices.map((notice) => `資料狀態：${notice}`),
        formatRenaissChatRecommendation(analysis?.result ?? selected, review),
      ].join("\n"),
      model: review.model,
      renaissAnalysis: {
        analysis: sanitizeRenaissAnalysisResponse(analysis, selected),
        item: sanitizeRenaissOpportunity(analysis?.result ?? selected),
        review,
      },
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "RENAISS recommendation failed.",
    });
  }
}

async function handleRenaissListingChat(userMessage, response, walletAddress) {
  const listing = extractRenaissListingDraft(userMessage);
  if (!listing.cardUrl && !listing.tokenId) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以，但我需要先知道是哪一張 RENAISS 卡。",
        "請貼 RENAISS 卡片連結或 tokenId，並告訴我掛單價格，例如：",
        "「幫我在 RENAISS 掛單 https://www.renaiss.xyz/... 價格 120 USDT」",
        "掛單不是鏈上付款交易；它會簽 RENAISS 官方 Ask EIP-712 訂單，最後用目前 RENAISS session 送出 createSellOffer。",
      ].join("\n"),
      model: "renaiss-listing-live",
    });
    return;
  }

  if (listing.askPriceUsdt === null) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "我已經抓到你要掛單的 RENAISS 卡片，但還缺掛單價格。",
        "請補一句價格，例如：「掛 120 USDT」。",
        "價格會當成你希望收到的 USDT；送到 RENAISS 的 ask amount 會再加上平台 fee，簽名前會列出 seller receive、fee、total ask。",
      ].join("\n"),
      model: "renaiss-listing-live",
    });
    return;
  }

  if (!walletAddress) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以掛單，但我需要先拿到目前 Token Core wallet address。",
        "請先在 Wallet 頁建立或解鎖 Google + Passkey / Token Core 錢包，再回來說一次掛單指令。",
        "我會確認 RENAISS session wallet 是否真的擁有這張卡；不會只看你貼的連結就送單。",
      ].join("\n"),
      model: "renaiss-listing-live",
    });
    return;
  }

  try {
    const plan = await buildRenaissListingPlan({
      listing,
      session: getRenaissSessionForWallet(walletAddress),
      walletAddress,
    });
    sendJson(response, 200, createRenaissListingChatResponse(listing, plan));
  } catch (error) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "我有收到掛單要求，但掛單準備失敗，所以沒有產生可簽名訂單。",
        error instanceof Error ? error.message : "RENAISS listing prepare failed.",
        "我不會用 review-only fallback 假裝已經能掛；要掛單前必須確認 session、卡片 owner、seller wallet 和 Ask typed-data。",
      ].join("\n"),
      model: "renaiss-listing-live",
    });
  }
}

function createRenaissListingChatResponse(listing, plan) {
  if (plan.nextStep === "login") {
    return {
      intent: createRenaissListingSessionLoginIntent(listing, plan),
      message: [
        "可以掛單，先做第一步：用目前 Token Core wallet 登入 RENAISS。",
        `卡片：${plan.cardUrl}`,
        `你想收到：${plan.askPrice.sellerReceivesDisplay} USDT`,
        "登入完成後再說一次掛單指令，我會確認這張卡是否屬於你的 RENAISS app wallet，然後產生官方 Ask EIP-712 簽名。",
      ].join("\n"),
      model: "renaiss-listing-live",
    };
  }

  if (plan.nextStep === "sign_ask_and_submit") {
    return {
      intent: createRenaissListOrderIntent(listing, plan),
      message: [
        "前置條件已通過，可以準備真正掛單。",
        `卡片：${plan.collectible?.name ?? plan.cardUrl}`,
        `你想收到：${plan.askPrice.sellerReceivesDisplay} USDT`,
        `平台 fee：${plan.orderbook.platformFeeBps} bps`,
        `送到 RENAISS 的 total ask：${plan.askPrice.totalAskDisplay} USDT`,
        `掛單錢包：${plan.sellerAddress}`,
        plan.signatureMode === "safe_eip1271"
          ? "按下面確認後，本機 Token Core 會簽 RENAISS Safe EIP-1271 Ask 訂單，然後伺服器用你的 RENAISS session 送出 offer.createSellOffer。"
          : "按下面確認後，本機 Token Core 會簽 RENAISS 官方 Ask EIP-712 訂單，然後伺服器用你的 RENAISS session 送出 offer.createSellOffer。",
      ].join("\n"),
      model: "renaiss-listing-live",
    };
  }

  return {
    intent: createRenaissBlockedListingIntent(listing, plan),
    message: [
      "目前不能掛單，原因如下：",
      ...plan.blockers.map((blocker) => `- ${blocker.message}`),
      "我已經把原因放進審核卡，不會繞過 RENAISS owner 檢查或用伺服器代簽。",
    ].join("\n"),
    model: "renaiss-listing-live",
  };
}

async function handleRenaissPurchaseChat(messages, response, walletAddress) {
  const context = findLatestRenaissPurchaseContext(messages);

  if (!context) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以，但我需要先知道是哪一張 RENAISS 卡。",
        "請先點一張推薦卡做分析，或直接貼 RENAISS 商品頁連結和價格。",
        "拿到 item_id、商品頁、ask price 後，我會建立真的購買流程；不會讓模型自己猜卡片或價格。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    });
    return;
  }

  if (!walletAddress) {
    sendJson(response, 200, {
      intent: createRenaissSessionLoginIntent(context, null),
      message: [
        "可以買，但我需要先拿到目前 Token Core wallet address。",
        "請先在 Wallet 頁建立或解鎖 Google + Passkey / Token Core 錢包，再回來說「幫我買這張」。",
        "真正購買會分三步：RENAISS 登入、USDT Permit2 approve、EIP-712 buyNow 簽名送單。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    });
    return;
  }

  try {
    const plan = await buildRenaissPurchasePlan({
      context,
      session: getRenaissSessionForWallet(walletAddress),
      walletAddress,
    });
    sendJson(response, 200, createRenaissPurchaseChatResponse(context, plan));
  } catch (error) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "我有找到卡片，但購買準備失敗，所以沒有產生可簽名交易。",
        error instanceof Error ? error.message : "RENAISS purchase prepare failed.",
        "我不會用 review-only fallback 假裝已經能買；要買之前必須拿到真實 session、餘額、allowance 和 typed-data。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    });
  }
}

function createRenaissPurchaseChatResponse(context, plan) {
  if (plan.nextStep === "login") {
    return {
      intent: createRenaissSessionLoginIntent(context, plan.signerAddress),
      message: [
        "可以，先做第一步：用目前 Token Core wallet 登入 RENAISS。",
        `卡片：${context.name}`,
        `價格：${plan.amountDisplay} USDT`,
        "按下面確認後，我會在本機用 Token Core 簽 SIWE 登入訊息；伺服器只保存 RENAISS session cookie，不會拿到私鑰。",
        "登入完成後再說一次「幫我買這張」，我會接著檢查 USDT、BNB gas 和 Permit2 allowance。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    };
  }

  if (plan.nextStep === "approve_permit2") {
    return {
      intent: createRenaissPermit2ApprovalIntent(context, plan),
      message: [
        "RENAISS session 已經有了，下一步需要先 approve USDT 給 Permit2。",
        `卡片：${context.name}`,
        `價格：${plan.amountDisplay} USDT`,
        `USDT 餘額：${plan.balances.usdtDisplay} USDT`,
        `目前 Permit2 allowance：${plan.permit2.allowanceDisplay} USDT`,
        "按下面確認會送出一筆真的 BSC USDT approve 交易。Approve 成功後，再說一次「幫我買這張」才會進入 buyNow 簽名。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    };
  }

  if (plan.nextStep === "fund_safe_bnb") {
    return {
      intent: createRenaissFundSafeBnbIntent(context, plan),
      message: [
        "RENAISS 付款錢包需要先有一點 BNB buffer，我先幫你準備補 BNB。",
        `卡片：${context.name}`,
        `RENAISS 付款錢包目前：${plan.balances.bnbDisplay} BNB`,
        `目標 buffer：${plan.funding.targetMinBnbDisplay} BNB`,
        `需要從 Token Core owner 補：${plan.funding.amountDisplay} BNB`,
        `Token Core owner 目前：${plan.funding.ownerBalances.bnbDisplay} BNB`,
        "按下面確認會送出一筆真的 BSC BNB transfer 到 RENAISS app wallet。補 BNB 後，再說一次「幫我買這張」會接著補 USDT / approve / buyNow。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    };
  }

  if (plan.nextStep === "fund_safe_usdt") {
    return {
      intent: createRenaissFundSafeUsdtIntent(context, plan),
      message: [
        "RENAISS 付款錢包 USDT 不足，我先幫你準備補款。",
        `卡片：${context.name}`,
        `價格：${plan.amountDisplay} USDT`,
        `RENAISS 付款錢包目前：${plan.balances.usdtDisplay} USDT`,
        `需要從 Token Core owner 補：${plan.funding.amountDisplay} USDT`,
        `Token Core owner 目前：${plan.funding.ownerBalances.usdtDisplay} USDT`,
        "按下面確認會送出一筆真的 BSC USDT.transfer 到 RENAISS app wallet。補款成功後，再說一次「幫我買這張」會進入 approve / buyNow。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    };
  }

  if (plan.nextStep === "safe_approve_permit2") {
    return {
      intent: createRenaissSafePermit2ApprovalIntent(context, plan),
      message: [
        "RENAISS session 已經有了，下一步需要讓 RENAISS app wallet approve USDT 給 Permit2。",
        `卡片：${context.name}`,
        `價格：${plan.amountDisplay} USDT`,
        `Token Core owner：${plan.signerAddress}`,
        `RENAISS 付款錢包：${plan.payerAddress}`,
        `USDT 餘額：${plan.balances.usdtDisplay} USDT`,
        `目前 Permit2 allowance：${plan.permit2.allowanceDisplay} USDT`,
        "按下面確認後，本機 Token Core 會簽 Safe/4337 使用者操作，由 RENAISS app wallet 送出 USDT.approve(Permit2)。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    };
  }

  if (plan.nextStep === "sign_bid_and_submit") {
    return {
      intent: createRenaissBuyNowIntent(context, plan),
      message: [
        "前置條件已通過，可以準備真正 buyNow。",
        `卡片：${context.name}`,
        `付款：${plan.amountDisplay} USDT`,
        `RENAISS 付款錢包：${plan.session.walletAddress}`,
        plan.signatureMode === "safe_eip1271"
          ? "按下面確認後，本機 Token Core 會簽 RENAISS Safe EIP-1271 訊息，然後伺服器用你的 RENAISS session 送出 offer.buyNow。"
          : "按下面確認後，本機 Token Core 會簽 RENAISS 官方 PermitWitnessTransferFrom EIP-712 payload，然後伺服器用你的 RENAISS session 送出 offer.buyNow。",
      ].join("\n"),
      model: "renaiss-purchase-live",
    };
  }

  return {
    intent: createRenaissBlockedPurchaseIntent(context, plan),
    message: [
      "目前不能直接買，原因如下：",
      ...plan.blockers.map((blocker) => `- ${blocker.message}`),
      "我已經把原因放進審核卡，不會用一般簽名或伺服器代簽繞過。",
    ].join("\n"),
    model: "renaiss-purchase-live",
  };
}

function createRenaissSessionLoginIntent(context, walletAddress) {
  return {
    actions: [
      {
        amount: null,
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: null,
        message: "Sign in to RENAISS with SIWE using this Token Core wallet.",
        params: {
          action: "renaiss_session_login",
          cardName: context.name,
          itemId: context.itemId,
          walletAddress,
        },
        to: null,
        token: null,
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-login-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "info",
    safetyChecks: [
      "This only signs a RENAISS SIWE login message.",
      "No USDT approval, payment, or buyNow request is sent in this step.",
      "The private key stays in Token Core on this device.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Login to RENAISS before buying ${context.name}.`,
    title: "RENAISS Wallet Login",
  };
}

function createRenaissPermit2ApprovalIntent(context, plan) {
  return {
    actions: [
      {
        amount: "unlimited",
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: plan.approveTx.data,
        evmTx: plan.approveTx,
        message: null,
        params: {
          action: "renaiss_usdt_approve_permit2",
          approvalAmount: "MAX_UINT256",
          contractAddress: plan.contracts.usdt,
          spender: plan.contracts.permit2,
          tokenAddress: plan.contracts.usdt,
        },
        to: plan.contracts.usdt,
        token: "USDT",
        type: "transfer",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-approve-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "danger",
    safetyChecks: [
      "This is a real BSC transaction: USDT.approve(Permit2, MAX_UINT256).",
      "RENAISS official frontend uses this high allowance threshold; review the spender before signing.",
      `USDT contract: ${plan.contracts.usdt}`,
      `Permit2 spender: ${plan.contracts.permit2}`,
      "After approve confirms on-chain, ask the agent to buy this card again.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Approve RENAISS Permit2 USDT spend before buying ${context.name}.`,
    title: "Approve RENAISS Permit2",
  };
}

function createRenaissFundSafeBnbIntent(context, plan) {
  return {
    actions: [
      {
        amount: `${plan.funding.amountDisplay} BNB`,
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: "0x",
        evmTx: plan.fundTx,
        message: null,
        params: {
          action: "renaiss_fund_safe_bnb",
          gasCostWei: plan.funding.gasCostWei,
          ownerAddress: plan.signerAddress,
          safeAddress: plan.payerAddress,
          targetMinBnb: plan.funding.targetMinBnb,
        },
        to: plan.payerAddress,
        token: "BNB",
        type: "transfer",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-fund-safe-bnb-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "This is a real BSC native BNB transfer from the Token Core owner wallet.",
      `Recipient RENAISS app wallet: ${plan.payerAddress}`,
      `Transfer amount: ${plan.funding.amountDisplay} BNB`,
      `Target app-wallet BNB buffer: ${plan.funding.targetMinBnbDisplay} BNB`,
      `Estimated owner-wallet gas cost: ${plan.funding.gasCostWei} wei`,
      "This only funds gas buffer; it does not approve USDT or submit buyNow.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Fund RENAISS app wallet with ${plan.funding.amountDisplay} BNB gas buffer before buying ${context.name}.`,
    title: "Fund RENAISS App Wallet Gas",
  };
}

function createRenaissFundSafeUsdtIntent(context, plan) {
  return {
    actions: [
      {
        amount: `${plan.funding.amountDisplay} USDT`,
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: plan.fundTx.data,
        evmTx: plan.fundTx,
        message: null,
        params: {
          action: "renaiss_fund_safe_usdt",
          gasCostWei: plan.funding.gasCostWei,
          ownerAddress: plan.signerAddress,
          safeAddress: plan.payerAddress,
          tokenAddress: plan.contracts.usdt,
        },
        to: plan.payerAddress,
        token: "USDT",
        type: "transfer",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-fund-safe-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "This is a real BSC token transfer from the Token Core owner wallet.",
      `Token: ${plan.contracts.usdt}`,
      `Recipient RENAISS app wallet: ${plan.payerAddress}`,
      `Transfer amount: ${plan.funding.amountDisplay} USDT`,
      `Estimated owner-wallet gas cost: ${plan.funding.gasCostWei} wei`,
      "The app wallet is still controlled by the same Token Core owner through RENAISS Safe/EIP-1271.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Fund RENAISS app wallet with ${plan.funding.amountDisplay} USDT before buying ${context.name}.`,
    title: "Fund RENAISS App Wallet",
  };
}

function createRenaissSafePermit2ApprovalIntent(context, plan) {
  return {
    actions: [
      {
        amount: "unlimited",
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: plan.safeTx.calls[0]?.data ?? null,
        message: null,
        params: {
          action: "renaiss_safe_usdt_approve_permit2",
          approvalAmount: "MAX_UINT256",
          calls: plan.safeTx.calls,
          contractAddress: plan.contracts.usdt,
          ownerAddress: plan.safeTx.ownerAddress,
          safeAddress: plan.safeTx.safeAddress,
          spender: plan.contracts.permit2,
          tokenAddress: plan.contracts.usdt,
        },
        to: plan.contracts.usdt,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-safe-approve-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "danger",
    safetyChecks: [
      "This is a real Safe/4337 transaction: USDT.approve(Permit2, MAX_UINT256).",
      "Token Core signs locally as the Safe owner; the RENAISS app wallet is the payer.",
      `Safe/app wallet: ${plan.safeTx.safeAddress}`,
      `Owner signer: ${plan.safeTx.ownerAddress}`,
      `USDT contract: ${plan.contracts.usdt}`,
      `Permit2 spender: ${plan.contracts.permit2}`,
      "After approve confirms on-chain, ask the agent to buy this card again.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Approve RENAISS Safe Permit2 USDT spend before buying ${context.name}.`,
    title: "Approve RENAISS Safe Permit2",
  };
}

function createRenaissBuyNowIntent(context, plan) {
  return {
    actions: [
      {
        amount: `${plan.amountDisplay} USDT`,
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: plan.bid.eip712Preimage,
        message: JSON.stringify(plan.bid.typedData, null, 2),
        params: {
          action: "renaiss_buy_now_sign_and_submit",
          bidData: plan.bid.bidData,
          collectibleId: plan.collectibleId,
          expectedDigest: plan.bid.eip712Digest,
          itemId: context.itemId,
          orderbookContract: plan.contracts.orderbook,
          permit2Contract: plan.contracts.permit2,
          safeAddress: plan.safe?.address ?? null,
          signatureMode: plan.signatureMode,
          tokenId: plan.tokenId.toString(),
          typedData: plan.bid.typedData,
          usdtContract: plan.contracts.usdt,
        },
        to: plan.contracts.orderbook,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-buynow-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "danger",
    safetyChecks: [
      plan.signatureMode === "safe_eip1271"
        ? "This signs the RENAISS Safe EIP-1271 wrapper for the PermitWitnessTransferFrom payload shown above."
        : "This signs the exact EIP-712 PermitWitnessTransferFrom payload shown above.",
      "After local signature, the app submits RENAISS offer.buyNow with the current session cookie.",
      `Spend amount: ${plan.amountDisplay} USDT`,
      `Payer wallet: ${plan.payerAddress}`,
      `Orderbook spender: ${plan.contracts.orderbook}`,
      `Permit2 contract: ${plan.contracts.permit2}`,
      `EIP-712 digest: ${plan.bid.eip712Digest}`,
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Buy ${context.name} on RENAISS for ${plan.amountDisplay} USDT after local Token Core signature.`,
    title: "RENAISS BuyNow",
  };
}

function createRenaissBlockedPurchaseIntent(context, plan) {
  return {
    actions: [
      {
        amount: `${plan.amountDisplay ?? context.askPriceUsd} USDT`,
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: null,
        message: null,
        params: {
          action: "renaiss_buy_now_blocked",
          blockers: plan.blockers,
          itemId: context.itemId,
          session: plan.session ?? null,
        },
        to: null,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-blocked-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "block",
    safetyChecks: plan.blockers.map((blocker) => blocker.message),
    serverCanExecute: false,
    status: "needs_review",
    summary: `Cannot safely buy ${context.name} until the blockers are resolved.`,
    title: "RENAISS BuyNow Blocked",
  };
}

async function handleBitrefillChat(userMessage, response) {
  try {
    const authorization = getBitrefillAuthorizationHeader();
    if (!authorization) {
      sendJson(response, 200, {
        intent: null,
        message: "Bitrefill API 還沒接到本機 agent server。請先設定 BITREFILL_API_KEY，之後我才能查真商品與建立 invoice。",
        model: "bitrefill-api",
      });
      return;
    }

    const country = extractCountryCode(userMessage) ?? "US";
    const query = extractBitrefillQuery(userMessage);

    if (isBitrefillCatalogRequest(userMessage) || !query) {
      const payload = await fetchBitrefillCatalogProducts(country, 30, authorization);
      const products = uniqueById((Array.isArray(payload.data) ? payload.data : []).map(sanitizeBitrefillProduct));

      if (products.length === 0) {
        sendJson(response, 200, {
          intent: null,
          message: `我有連到 Bitrefill，但 ${country} 目前沒有回傳商品列表。請換國家或直接給商品名，我會再打真 API 查一次。`,
          model: "bitrefill-api",
        });
        return;
      }

      sendJson(response, 200, {
        intent: null,
        message: formatBitrefillCatalogMessage(products, { country }),
        model: "bitrefill-api",
      });
      return;
    }

    const params = new URLSearchParams({
      limit: "6",
      q: query,
    });
    const payload = await fetchBitrefillSearchPages(params, country, 6, authorization);
    const products = uniqueById((Array.isArray(payload.data) ? payload.data : []).map(sanitizeBitrefillProduct));

    if (products.length === 0) {
      sendJson(response, 200, {
        intent: null,
        message: `我有連到 Bitrefill，但用「${query}」在 ${country} 沒找到可用商品。你可以換商品名，例如 Steam、Uber、Google Play、DoorDash。`,
        model: "bitrefill-api",
      });
      return;
    }

    sendJson(response, 200, {
      intent: null,
      message: formatBitrefillSearchMessage(products, { country, query }),
      model: "bitrefill-api",
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Bitrefill chat search failed.",
    });
  }
}

async function handleBitrefillRecommendationChat(userMessage, response) {
  try {
    const authorization = getBitrefillAuthorizationHeader();
    if (!authorization) {
      sendJson(response, 503, {
        error: "BITREFILL_API_KEY is not configured on the server.",
      });
      return;
    }
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      sendJson(response, 503, {
        error: "MINIMAX_API_KEY is required for non-canned Bitrefill recommendations.",
      });
      return;
    }

    const country = extractCountryCode(userMessage) ?? "US";
    const payload = await fetchBitrefillCatalogProducts(country, 50, authorization);
    const products = uniqueById((Array.isArray(payload.data) ? payload.data : []).map(sanitizeBitrefillProduct))
      .filter((product) => product.inStock !== false)
      .slice(0, 40);

    if (products.length === 0) {
      sendJson(response, 200, {
        intent: null,
        message: `我有連到 Bitrefill，但 ${country} 目前沒有可推薦的有庫存商品。你可以指定商品名，我會用真 API 再查一次。`,
        model: "bitrefill-api",
      });
      return;
    }

    const review = await createBitrefillAiRecommendation({
      country,
      products,
      userMessage,
    });
    sendJson(response, 200, {
      intent: null,
      message: formatBitrefillAiRecommendation(review, { country }),
      model: review.model,
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Bitrefill AI recommendation failed.",
    });
  }
}

async function handleBitrefillPaymentQuestionChat(response) {
  sendJson(response, 200, {
    intent: null,
    message: [
      "你剛剛查的是 Bitrefill US 商品，所以商品面額通常是 USD；例如 Steam USD 就是美元面額。",
      "但「付款幣種」不是我用猜的，要建立 Bitrefill invoice 時由 Bitrefill 回傳實際 payment method、幣種、地址和金額。",
      "如果你要買，直接說商品和面額，例如：「用 Bitrefill 買 Steam US 20 美元」。",
      "我會再打真 API 建立/審核 invoice；如果付款幣種是目前錢包支援的鏈上資產，才會建立本機 Token Core 簽名付款 intent。",
    ].join("\n"),
    model: "bitrefill-api",
  });
}

function isBitrefillPaymentQuestion(value) {
  const text = stringOrEmpty(value).toLowerCase();
  return /用什麼貨幣|用什么货币|付款幣種|付款币种|支付幣種|支付币种|什麼幣|什么币|currency|pay with|payment/.test(text);
}

async function handleRecommendationClarificationChat(response) {
  sendJson(response, 200, {
    intent: null,
    message: [
      "你問「推薦什麼」時，我需要先知道推薦範圍，不能自己跳到卡牌或禮品卡。",
      "你可以直接說：",
      "- 推薦 Bitrefill 美國禮品卡",
      "- 現在有什麼 RENAISS 特價卡片",
      "- 推薦一個 Puffer / DeFi 操作風險檢查",
      "我會先查真 API，再用 AI 做排序或分析；重要交易最後仍要你確認。",
    ].join("\n"),
    model: "recommendation-router",
  });
}

async function createBitrefillAiRecommendation(input) {
  const model = process.env.MINIMAX_MODEL ?? "MiniMax-M2.7";
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  const minimaxResponse = await fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            "你是自託管錢包裡的電商助手。",
            "你只根據 Bitrefill 真 API 回傳的商品資料做推薦；不能編造商品、價格、庫存、折扣、兌換碼或付款狀態。",
            "使用繁體中文，回答要短、可掃讀。不要切換到 RENAISS 卡牌或 DeFi。",
            "不要使用 emoji 或表情符號。",
            "推薦標準：通用性、容易送禮、面額彈性、是否有庫存、使用者問題語境。",
            "只回傳 strict JSON：",
            "{\"headline\":\"string\",\"recommendations\":[{\"name\":\"string\",\"bestFor\":\"string\",\"why\":\"string\",\"denominationHint\":\"string\"}],\"nextQuestion\":\"string\"}",
          ].join("\n"),
          role: "system",
        },
        {
          content: JSON.stringify({
            country: input.country,
            products: input.products.map((product) => ({
              categories: product.categories,
              currency: product.currency,
              id: product.id,
              inStock: product.inStock,
              name: product.name,
              packages: product.packages.slice(0, 6),
            })),
            userMessage: stringOrEmpty(input.userMessage).slice(0, 500),
          }),
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0.25,
    }),
    headers: {
      Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await minimaxResponse.json();
  if (!minimaxResponse.ok) {
    throw new Error(data.error?.message ?? data.base_resp?.status_msg ?? "MiniMax Bitrefill recommendation failed.");
  }

  const rawContent = data.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    throw new Error("MiniMax response did not include Bitrefill recommendation content.");
  }
  return normalizeBitrefillAiRecommendation(JSON.parse(extractFirstJsonObject(rawContent)), model);
}

async function handleGenericPurchaseChat(response) {
  sendJson(response, 200, {
    intent: null,
    message: [
      "我不會幫你猜要買哪個商品，因為這會產生錯誤的 wallet intent。",
      "請先給我一個明確目標：一張 RENAISS 推薦卡、Bitrefill 商品加國家和面額，或一個 DApp 操作。",
      "拿到具體商品、價格和來源後，我才會建立審核 intent；最後仍由你在本機 Token Core 確認。",
    ].join("\n"),
    model: "purchase-router",
  });
}

async function handlePufferChat(userMessage, response) {
  try {
    if (isPufferSepoliaRequest(userMessage)) {
      sendJson(response, 200, {
        intent: null,
        message: [
          "Sepolia ETH 不能實測 Puffer deposit。",
          "目前安裝的 Puffer SDK 在 Sepolia 只暴露 GaugeRegistry，沒有 PufferVault / PufferDepositor / pufETH。",
          "我已把錢包的測試網模式接成 Holesky；要實際跑 Puffer 測試交易，請用 Holesky ETH。",
        ].join("\n"),
        model: "puffer-sdk",
      });
      return;
    }

    const networkMode = inferPufferNetworkMode(userMessage);
    const snapshot = await readServerPufferSnapshot(networkMode);
    sendJson(response, 200, {
      intent: null,
      message: formatPufferChatMessage(snapshot),
      model: "puffer-sdk",
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Puffer review failed.",
    });
  }
}

async function createRenaissAiReview(input) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is not configured on the server.");
  }

  const rawAnalysis = input.analysis?.result ?? input.analysis;
  const rawOpportunity = input.opportunity ?? rawAnalysis;
  const opportunity = sanitizeRenaissOpportunity(rawOpportunity);
  const analysis = sanitizeRenaissOpportunity(rawAnalysis ?? rawOpportunity);
  const trendContext = buildRenaissTrendContext(rawAnalysis ?? rawOpportunity);
  const deterministicFacts = buildDeterministicRenaissReviewFacts(analysis);
  if (!opportunity.item_id) {
    throw new Error("opportunity.item_id is required.");
  }

  const model = process.env.MINIMAX_MODEL ?? "MiniMax-M2.7";
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  const minimaxResponse = await fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            "你是自託管錢包裡的謹慎卡牌交易分析員。",
            "所有輸出欄位都必須使用繁體中文，除非是卡名、來源名稱、幣別、網址或數字。",
            "只使用提供的 RENAISS monitor 事實、完整 normalized price-record 趨勢、卡名與來源資料。不要編造價格、流動性、稀有度、持有者或未提供的市場資訊。",
            "價格名詞必須精準：sources.*.avg_price_usd 只能叫「摘要參考均價」；trend.recent_avg_usd 只能叫「近期成交均價」；trend.latest_price_usd 只能叫「最新成交價」。不要使用「均價」單獨指代任何數字。",
            "deterministicFacts 是系統已計算好的可信數字和結論；你的 verdict、priceSummary、trendSummary、reasons 不得和 deterministicFacts 矛盾。",
            "只要提到近期成交均價或最新成交價，必須寫出 trend.recent_start_date / trend.recent_end_date 或 latest_date 的時間區間；如果沒有日期就明確說日期不足。",
            "如果摘要參考均價與近期成交均價差很多，必須直接說這是全期/摘要均價與近期成交窗口不同造成，不可以讓它看起來像矛盾。",
            "只有 action 是 BUY_CANDIDATE 或利潤/價差清楚為正，且走勢沒有明顯反駁時，才可以給 buy_candidate。",
            "如果價格高於參考市場、資料品質弱、跨市場差異太大或趨勢證據不足，請給 watch 或 avoid，並用短句講清楚。",
            "每個文字欄位都要短、可掃讀，不要長篇大論。reasons/riskFlags 每點最多 32 個中文字左右。",
            "最後 nextChecks 必須包含一句：若要購買，請使用者明確回覆「幫我買這張」。",
            "絕對不要要求 private key、seed phrase、cookie、session token、API key 或 Privy token。",
            "只回傳 strict JSON，schema 如下：",
            "{\"verdict\":\"buy_candidate|watch|avoid\",\"confidence\":0,\"headline\":\"string\",\"priceSummary\":\"string\",\"trendSummary\":\"string\",\"cardNameSignals\":[\"string\"],\"marketDataUsed\":[\"string\"],\"reasons\":[\"string\"],\"riskFlags\":[\"string\"],\"nextChecks\":[\"string\"]}",
          ].join("\n"),
          role: "system",
        },
        {
          content: JSON.stringify({
            analysis,
            deterministicFacts,
            opportunity,
            priceContext: buildRenaissPriceContext(rawAnalysis ?? rawOpportunity),
            trendContext,
            userMessage: stringOrEmpty(input.userMessage).slice(0, 500),
          }),
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await minimaxResponse.json();
  if (!minimaxResponse.ok) {
    throw new Error(data.error?.message ?? data.base_resp?.status_msg ?? "MiniMax RENAISS review failed.");
  }

  const rawContent = data.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    throw new Error("MiniMax response did not include RENAISS review content.");
  }

  return normalizeRenaissAiReview(JSON.parse(extractFirstJsonObject(rawContent)), model, deterministicFacts);
}

async function handleRenaissHeadlessLogin(response) {
  try {
    const result = await createRenaissHeadlessSession();
    activeRenaissSession = {
      cookieHeader: result.cookieHeader,
      cookieNames: result.cookieNames,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      origin: result.origin,
      session: result.session,
    };
    storeRenaissSession(activeRenaissSession);
    sendJson(response, 200, sanitizeRenaissSession(activeRenaissSession));
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "RENAISS headless login failed.",
    });
  }
}

async function handleRenaissSiweNonce(request, response) {
  try {
    const body = await readJson(request);
    const walletAddress = normalizeOptionalEvmAddress(body.walletAddress);
    if (!walletAddress) {
      sendJson(response, 400, { error: "walletAddress must be a full EVM address." });
      return;
    }

    const origin = RENAISS_PURCHASE_ORIGIN;
    const client = new RenaissAuthClient(origin);
    const nonceResponse = await client.postJson("/api/auth/siwe/nonce", {
      chainId: RENAISS_PURCHASE_CHAIN_ID,
      walletAddress: walletAddress.toLowerCase(),
    });
    if (nonceResponse.status < 200 || nonceResponse.status >= 300) {
      sendJson(response, 502, {
        error: `RENAISS nonce request failed with HTTP ${nonceResponse.status}.`,
        detail: nonceResponse.body,
      });
      return;
    }

    const nonce = readNonce(nonceResponse.body);
    const issuedAt = new Date();
    const expirationTime = new Date(Date.now() + 5 * 60 * 1000);
    const message = createSiweMessage({
      address: walletAddress,
      chainId: RENAISS_PURCHASE_CHAIN_ID,
      domain: new URL(origin).host,
      expirationTime,
      issuedAt,
      nonce,
      scheme: new URL(origin).protocol.replace(":", ""),
      statement: "Sign in to Renaiss.",
      uri: origin,
      version: "1",
    });
    const challengeId = crypto.randomUUID();
    pendingRenaissSiweChallenges.set(challengeId, {
      client,
      createdAt: Date.now(),
      message,
      walletAddress,
    });
    prunePendingRenaissSiweChallenges();

    sendJson(response, 200, {
      challengeId,
      chainId: RENAISS_PURCHASE_CHAIN_ID,
      expiresAt: expirationTime.toISOString(),
      message,
      walletAddress,
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Could not create RENAISS SIWE challenge.",
    });
  }
}

async function handleRenaissSiweVerify(request, response) {
  try {
    const body = await readJson(request);
    const challengeId = stringOrEmpty(body.challengeId);
    const signature = stringOrEmpty(body.signature);
    const challenge = pendingRenaissSiweChallenges.get(challengeId);
    if (!challenge) {
      sendJson(response, 400, { error: "RENAISS SIWE challenge expired or missing." });
      return;
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      sendJson(response, 400, { error: "signature must be a 65-byte EVM signature." });
      return;
    }

    const verifyResponse = await challenge.client.postJson("/api/auth/siwe/verify", {
      chainId: RENAISS_PURCHASE_CHAIN_ID,
      message: challenge.message,
      signature,
      walletAddress: challenge.walletAddress.toLowerCase(),
    });
    if (verifyResponse.status < 200 || verifyResponse.status >= 300) {
      sendJson(response, 502, {
        error: `RENAISS SIWE verify failed with HTTP ${verifyResponse.status}.`,
        detail: verifyResponse.body,
      });
      return;
    }

    const sessionResponse = await challenge.client.getJson("/api/auth/get-session");
    if (sessionResponse.status < 200 || sessionResponse.status >= 300) {
      sendJson(response, 502, {
        error: `RENAISS session check failed with HTTP ${sessionResponse.status}.`,
        detail: sessionResponse.body,
      });
      return;
    }

    pendingRenaissSiweChallenges.delete(challengeId);
    activeRenaissSession = {
      cookieHeader: challenge.client.cookieHeader(),
      cookieNames: challenge.client.cookieNames(),
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      origin: RENAISS_PURCHASE_ORIGIN,
      session: {
        ...summarizeSession(sessionResponse.body),
        signedWalletAddress: challenge.walletAddress,
        walletSource: "local-token-core-siwe",
      },
    };
    activeRenaissSession.session.signedWalletLinked = addressesEqual(
      activeRenaissSession.session.ownerWalletAddress,
      challenge.walletAddress,
    );
    storeRenaissSession(activeRenaissSession);
    sendJson(response, 200, sanitizeRenaissSession(activeRenaissSession));
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Could not verify RENAISS SIWE login.",
    });
  }
}

async function handleRenaissPurchasePrepare(request, response) {
  try {
    const body = await readJson(request);
    const context = sanitizeRenaissPurchaseContext(body.context);
    const walletAddress = normalizeOptionalEvmAddress(body.walletAddress);
    if (!context || !walletAddress) {
      sendJson(response, 400, { error: "context and walletAddress are required." });
      return;
    }
    const plan = await buildRenaissPurchasePlan({
      context,
      session: getRenaissSessionForWallet(walletAddress),
      walletAddress,
    });
    sendJson(response, 200, plan);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "RENAISS purchase prepare failed.",
    });
  }
}

async function handleRenaissPurchaseSubmit(request, response) {
  try {
    const body = await readJson(request);
    const walletAddress = normalizeOptionalEvmAddress(body.walletAddress);
    if (!walletAddress) {
      sendJson(response, 400, { error: "walletAddress must be a full EVM address." });
      return;
    }
    const session = getRenaissSessionForWallet(walletAddress);
    if (!session?.cookieHeader) {
      sendJson(response, 409, { error: "No RENAISS session for this wallet. Login first." });
      return;
    }
    const result = await submitRenaissBuyNow({
      bidData: body.bidData,
      bidSignature: stringOrEmpty(body.bidSignature),
      collectibleId: stringOrEmpty(body.collectibleId),
      cookieHeader: session.cookieHeader,
    });
    sendJson(response, 200, {
      result,
      session: sanitizeRenaissSession(session),
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "RENAISS buyNow submit failed.",
    });
  }
}

async function handleRenaissListingSubmit(request, response) {
  try {
    const body = await readJson(request);
    const walletAddress = normalizeOptionalEvmAddress(body.walletAddress);
    if (!walletAddress) {
      sendJson(response, 400, { error: "walletAddress must be a full EVM address." });
      return;
    }
    const session = getRenaissSessionForWallet(walletAddress);
    if (!session?.cookieHeader) {
      sendJson(response, 409, { error: "No RENAISS session for this wallet. Login first." });
      return;
    }
    const result = await submitRenaissSellOffer({
      askData: body.askData,
      askSignature: stringOrEmpty(body.askSignature),
      collectibleId: stringOrEmpty(body.collectibleId),
      cookieHeader: session.cookieHeader,
    });
    sendJson(response, 200, {
      ok: true,
      result,
      session: sanitizeRenaissSession(session),
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "RENAISS createSellOffer submit failed.",
    });
  }
}

function storeRenaissSession(session) {
  const addresses = [
    session?.session?.ownerWalletAddress,
    session?.session?.walletAddress,
    session?.session?.signedWalletAddress,
  ].filter((value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value));
  for (const address of addresses) {
    renaissSessionsByWallet.set(address.toLowerCase(), session);
  }
}

function getRenaissSessionForWallet(walletAddress) {
  const normalized = normalizeOptionalEvmAddress(walletAddress);
  if (!normalized) return null;
  return renaissSessionsByWallet.get(normalized.toLowerCase()) ?? null;
}

function addressesEqual(first, second) {
  return typeof first === "string" && typeof second === "string" && first.toLowerCase() === second.toLowerCase();
}

function prunePendingRenaissSiweChallenges() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, challenge] of pendingRenaissSiweChallenges) {
    if (challenge.createdAt < cutoff) pendingRenaissSiweChallenges.delete(id);
  }
}

async function handleRenaissWebhook(request, response) {
  if (!isAuthorizedRenaissWebhook(request)) {
    sendJson(response, 401, { error: "Unauthorized RENAISS webhook." });
    return;
  }

  try {
    const body = await readJson(request);
    const alert = {
      payload: body,
      receivedAt: new Date().toISOString(),
    };
    renaissWebhookAlerts.push(alert);
    if (renaissWebhookAlerts.length > 50) {
      renaissWebhookAlerts.splice(0, renaissWebhookAlerts.length - 50);
    }
    sendJson(response, 200, { ok: true, count: renaissWebhookAlerts.length });
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Invalid RENAISS webhook payload.",
    });
  }
}

async function handleBitrefillProductSearch(requestUrl, response) {
  const authorization = getBitrefillAuthorizationHeader();
  if (!authorization) {
    sendJson(response, 503, {
      error: "BITREFILL_API_KEY or BITREFILL_API_ID/BITREFILL_API_SECRET is not configured on the server.",
    });
    return;
  }

  try {
    const query = stringOrEmpty(requestUrl.searchParams.get("q")).trim();
    if (query.length < 1 || query.length > 100) {
      sendJson(response, 400, { error: "q must be 1-100 characters." });
      return;
    }

    const limit = clampInteger(Number(requestUrl.searchParams.get("limit") ?? 12), 1, 50, 12);
    const country = stringOrEmpty(requestUrl.searchParams.get("country")).trim().toUpperCase();
    const params = new URLSearchParams({
      limit: String(limit),
      q: query,
    });
    if (process.env.BITREFILL_INCLUDE_TEST_PRODUCTS === "true") {
      params.set("include_test_products", "true");
    }

    const payload = country
      ? await fetchBitrefillSearchPages(params, country, limit, authorization)
      : await fetchBitrefillJson(`/products/search?${params.toString()}`, {
          authorization,
          method: "GET",
        });
    const products = Array.isArray(payload.data) ? uniqueById(payload.data.map(sanitizeBitrefillProduct)) : [];
    sendJson(response, 200, {
      data: country ? products.filter((product) => stringOrEmpty(product.countryCode).toUpperCase() === country) : products,
      meta: payload.meta ?? {},
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Bitrefill product search failed.",
    });
  }
}

async function handleEvmRpcProxy(request, response) {
  try {
    const body = await readJson(request);
    const chainId = stringOrEmpty(body.chainId ?? body.networkChainId).trim() || "1";
    const method = stringOrEmpty(body.method).trim();
    const params = Array.isArray(body.params) ? body.params : [];
    const allowedMethods = new Set([
      "eth_call",
      "eth_estimateGas",
      "eth_gasPrice",
      "eth_chainId",
      "eth_getBalance",
      "eth_getTransactionCount",
      "eth_sendRawTransaction",
    ]);
    if (!allowedMethods.has(method)) {
      sendJson(response, 400, { error: "Unsupported Ethereum RPC method." });
      return;
    }

    const upstream = await fetch(getServerEvmRpcUrl(chainId), {
      body: JSON.stringify({
        id: Date.now(),
        jsonrpc: "2.0",
        method,
        params,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const text = await upstream.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: { message: text || "EVM RPC upstream returned non-JSON response." } };
    }
    if (!upstream.ok) {
      sendJson(response, upstream.status, {
        error: payload?.error?.message ?? payload?.message ?? "EVM RPC upstream request failed.",
      });
      return;
    }
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "EVM RPC proxy failed.",
    });
  }
}

function getServerEvmRpcUrl(chainId) {
  if (String(chainId) === "56") return BSC_RPC_URL;
  if (String(chainId) === "97") return BSC_TESTNET_RPC_URL;
  if (String(chainId) === "8453") return BASE_RPC_URL;
  if (String(chainId) === "137") return POLYGON_RPC_URL;
  if (String(chainId) === "17000") return HOLESKY_RPC_URL;
  if (String(chainId) === "11155111") return SEPOLIA_RPC_URL;
  return ETHEREUM_RPC_URL;
}

async function handleBitrefillInvoice(request, response) {
  const authorization = getBitrefillAuthorizationHeader();
  if (!authorization) {
    sendJson(response, 503, {
      error: "BITREFILL_API_KEY or BITREFILL_API_ID/BITREFILL_API_SECRET is not configured on the server.",
    });
    return;
  }

  try {
    const body = await readJson(request);
    const productId = stringOrEmpty(body.product_id).trim();
    const packageId = nullableString(body.package_id);
    const paymentMethod = normalizeBitrefillPaymentMethod(body.payment_method);
    const value = nullableNumber(body.value, 0.01, 100_000);
    const email = nullableString(body.email);

    if (!productId) {
      sendJson(response, 400, { error: "product_id is required." });
      return;
    }
    if (!packageId && value === null) {
      sendJson(response, 400, { error: "package_id or value is required." });
      return;
    }

    const invoicePayload = {
      auto_pay: false,
      payment_method: paymentMethod,
      products: [
        {
          product_id: productId,
          quantity: 1,
          ...(packageId ? { package_id: packageId } : { value }),
        },
      ],
      ...(email ? { email, send_email: true } : {}),
    };
    const payload = await fetchBitrefillJson("/invoices", {
      authorization,
      body: invoicePayload,
      method: "POST",
    });

    sendJson(response, 200, sanitizeBitrefillInvoice(payload.data ?? payload));
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Bitrefill invoice request failed.",
    });
  }
}

async function handleBitrefillInvoiceGet(requestUrl, response) {
  const authorization = getBitrefillAuthorizationHeader();
  if (!authorization) {
    sendJson(response, 503, {
      error: "BITREFILL_API_KEY or BITREFILL_API_ID/BITREFILL_API_SECRET is not configured on the server.",
    });
    return;
  }

  try {
    const invoiceId = decodeURIComponent(requestUrl.pathname.split("/").filter(Boolean).at(-1) ?? "").trim();
    if (!invoiceId) {
      sendJson(response, 400, { error: "invoice_id is required." });
      return;
    }

    const payload = await fetchBitrefillJson(`/invoices/${encodeURIComponent(invoiceId)}`, {
      authorization,
    });
    sendJson(response, 200, sanitizeBitrefillInvoice(payload.data ?? payload));
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Bitrefill invoice lookup failed.",
    });
  }
}

async function fetchBitrefillJson(upstreamPath, options) {
  const upstream = await fetch(`${BITREFILL_API_BASE_URL}${upstreamPath}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: options.authorization,
      "Content-Type": "application/json",
    },
    method: options.method,
  });
  const text = await upstream.text();
  const payload = text ? JSON.parse(text) : null;
  if (!upstream.ok) {
    throw new Error(payload?.message ?? payload?.error ?? "Bitrefill upstream request failed.");
  }
  return payload;
}

async function fetchBitrefillSearchPages(params, country, limit, authorization) {
  const collected = [];
  let start = 0;
  const pageLimit = Math.max(limit, 20);
  const maxPages = 5;
  let lastMeta = {};

  for (let page = 0; page < maxPages && collected.length < limit; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageLimit));
    pageParams.set("start", String(start));
    const payload = await fetchBitrefillJson(`/products/search?${pageParams.toString()}`, {
      authorization,
      method: "GET",
    });
    const products = Array.isArray(payload.data) ? payload.data : [];
    lastMeta = payload.meta ?? {};
    collected.push(...products.filter((product) => stringOrEmpty(product.country_code ?? product.country).toUpperCase() === country));
    if (products.length === 0) break;
    start += products.length;
  }

  return {
    data: uniqueByRawId(collected).slice(0, limit),
    meta: {
      ...lastMeta,
      country_filter: country,
      returned_after_country_filter: Math.min(uniqueByRawId(collected).length, limit),
    },
  };
}

async function fetchBitrefillCatalogProducts(country, limit, authorization) {
  const collected = [];
  let start = 0;
  const pageLimit = Math.max(limit, 30);
  const maxPages = 4;
  let lastMeta = {};

  for (let page = 0; page < maxPages && collected.length < limit; page += 1) {
    const pageParams = new URLSearchParams({
      limit: String(pageLimit),
      start: String(start),
    });
    if (country) pageParams.set("country", country);
    if (process.env.BITREFILL_INCLUDE_TEST_PRODUCTS === "true") {
      pageParams.set("include_test_products", "true");
    }

    const payload = await fetchBitrefillJson(`/products?${pageParams.toString()}`, {
      authorization,
      method: "GET",
    });
    const products = Array.isArray(payload.data) ? payload.data : [];
    lastMeta = payload.meta ?? {};
    collected.push(
      ...products.filter((product) => (
        !country || stringOrEmpty(product.country_code ?? product.country).toUpperCase() === country
      )),
    );
    if (products.length === 0) break;
    start += products.length;
  }

  return {
    data: uniqueByRawId(collected).slice(0, limit),
    meta: {
      ...lastMeta,
      country_filter: country,
      returned_after_country_filter: Math.min(uniqueByRawId(collected).length, limit),
    },
  };
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueByRawId(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = stringOrEmpty(item?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getBitrefillAuthorizationHeader() {
  if (process.env.BITREFILL_API_KEY) {
    return `Bearer ${process.env.BITREFILL_API_KEY}`;
  }

  if (process.env.BITREFILL_API_ID && process.env.BITREFILL_API_SECRET) {
    const token = Buffer.from(`${process.env.BITREFILL_API_ID}:${process.env.BITREFILL_API_SECRET}`).toString("base64");
    return `Basic ${token}`;
  }

  return null;
}

function getBitrefillAuthMode() {
  if (process.env.BITREFILL_API_KEY) return "api-key";
  if (process.env.BITREFILL_API_ID && process.env.BITREFILL_API_SECRET) return "basic";
  return "none";
}

function normalizeBitrefillPaymentMethod(value) {
  const method = stringOrEmpty(value).trim();
  const allowed = new Set([
    "balance",
    "bitcoin",
    "lightning",
    "ethereum",
    "usdc_base",
    "eth_base",
    "usdt_erc20",
    "usdc_erc20",
    "usdt_polygon",
    "usdc_polygon",
    "usdc_arbitrum",
    "usdt_arbitrum",
    "usdc_solana",
    "usdt_solana",
    "solana",
  ]);
  if (!allowed.has(method)) {
    throw new Error("Unsupported Bitrefill payment_method.");
  }
  return method;
}

function sanitizeBitrefillProduct(value) {
  const id = stringOrEmpty(value?.id).slice(0, 160);
  const packagesValue = value?.packages;
  const packages = Array.isArray(packagesValue)
    ? packagesValue
    : packagesValue && typeof packagesValue === "object"
      ? Object.values(packagesValue)
      : [];

  return {
    categories: normalizeBitrefillCategories(value, id),
    countryCode: nullableString(value?.country_code ?? value?.country),
    countryName: nullableString(value?.country_name),
    currency: nullableString(value?.currency),
    id,
    image: normalizeBitrefillImage(value?.image),
    inStock: typeof value?.in_stock === "boolean" ? value.in_stock : null,
    name: stringOrEmpty(value?.name).slice(0, 220),
    packages: packages.slice(0, 12).map((item) => ({
      id: stringOrEmpty(item?.id ?? item?.package_id).slice(0, 220),
      price: nullableNumber(item?.price, 0, 1_000_000),
      value: typeof item?.value === "number" || typeof item?.value === "string" ? item.value : null,
    })).filter((item) => item.id),
    range: value?.range && typeof value.range === "object"
      ? {
          max: nullableNumber(value.range.max, 0, 1_000_000),
          min: nullableNumber(value.range.min, 0, 1_000_000),
          step: nullableNumber(value.range.step, 0, 1_000_000),
        }
      : null,
  };
}

function normalizeBitrefillCategories(value, id) {
  const fromValue = value?.categories ?? value?.category ?? value?.tags;
  const raw = [];

  if (Array.isArray(fromValue)) {
    raw.push(...fromValue);
  } else if (typeof fromValue === "string") {
    raw.push(...fromValue.split(/[|,/]/));
  } else if (fromValue && typeof fromValue === "object") {
    raw.push(...Object.values(fromValue));
  }

  if (raw.length === 0 && id.includes(":")) {
    raw.push(...id.split(":").slice(2).join(":").split(/[|,/]/));
  }

  return [...new Set(raw
    .map((item) => stringOrEmpty(item).trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 8);
}

function normalizeBitrefillImage(value) {
  const image = nullableString(value);
  if (!image) return null;
  return /^https?:\/\//i.test(image) ? image : null;
}

function sanitizeBitrefillInvoice(value) {
  const payment = value?.payment && typeof value.payment === "object" ? value.payment : null;
  const invoice = {
    id: stringOrEmpty(value?.id).slice(0, 160),
    payment: payment
      ? {
          address: nullableString(payment.address),
          currency: nullableString(payment.currency),
          method: nullableString(payment.method),
          price: nullableNumber(payment.price, 0, 1_000_000),
          status: nullableString(payment.status),
        }
      : null,
    paymentLink: nullableString(value?.payment_link ?? value?.payment_url ?? value?.url),
    status: nullableString(value?.status),
  };
  return {
    ...invoice,
    intent: createBitrefillInvoiceReviewIntent(invoice),
  };
}

function createBitrefillInvoiceReviewIntent(invoice) {
  if (!invoice.payment?.address || !invoice.payment.currency || invoice.payment.price === null) {
    return null;
  }

  return {
    actions: [
      {
        amount: String(invoice.payment.price),
        chain: mapBitrefillPaymentChain(invoice.payment.method),
        dappUrl: "https://www.bitrefill.com/",
        data: null,
        message: null,
        params: {
          invoiceId: invoice.id,
          paymentCurrency: invoice.payment.currency,
          paymentMethod: invoice.payment.method,
          paymentPriceRaw: String(invoice.payment.price),
          provider: "Bitrefill",
          reviewOnly: true,
        },
        to: invoice.payment.address,
        token: invoice.payment.currency,
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `bitrefill-invoice-${invoice.id}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Bitrefill returned this invoice from the real API.",
      "Payment address and payment.price are shown exactly as returned by Bitrefill.",
      "This app does not convert or broadcast the payment until the payment unit and chain adapter are confirmed.",
      "Server and AI cannot pay this invoice.",
      "Final payment must be reviewed and signed locally by the user.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Review Bitrefill invoice ${invoice.id}. Payment is unpaid until the user signs a matching wallet transfer.`,
    title: "Bitrefill Invoice Payment Review",
  };
}

function createServerPancakeSwapIntent(input) {
  return {
    actions: [
      {
        amount: input.amountInBnb,
        chain: "BNB Smart Chain",
        dappUrl: PANCAKESWAP_SWAP_URL,
        data: null,
        message: null,
        params: {
          inputToken: "BNB",
          outputToken: input.outputSymbol,
          protocol: "PancakeSwap V2",
          router: PANCAKESWAP_V2_ROUTER,
          slippageBps: 100,
        },
        to: PANCAKESWAP_V2_ROUTER,
        token: input.outputSymbol,
        type: "swap",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `pancakeswap-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Uses PancakeSwap V2 router on BNB Smart Chain.",
      "Uses BNB as input, so no unlimited token approval is needed for this swap path.",
      "Quote, nonce, gas, calldata, and broadcast must still be resolved on this device before signing.",
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Swap ${input.amountInBnb} BNB to ${input.outputSymbol} through PancakeSwap V2 after local safety review.`,
    title: `PancakeSwap BNB to ${input.outputSymbol}`,
  };
}

async function handlePancakeSwapActionChat(fields, response) {
  const amount = nullableFieldString(fields?.amount) ?? nullableFieldString(fields?.fromAmount);
  const fromToken = stringOrEmpty(fields?.fromToken ?? fields?.token).toUpperCase().trim() || "BNB";
  const outputSymbol = normalizePancakeOutputSymbol(fields?.toToken ?? fields?.outputToken);

  if (fromToken && fromToken !== "BNB") {
    sendJson(response, 200, {
      intent: null,
      message: [
        `我讀到你想用 ${fromToken} 做 swap，但目前對話已接好的真交易路徑只有 PancakeSwap BNB -> USDC / USDT / CAKE。`,
        "如果要做 token-to-token swap，需要先加入 allowance/approve、路由、spender、calldata decode 和安全審核。",
      ].join("\n"),
      model: "deterministic-defi",
    });
    return;
  }

  if (!amount || !outputSymbol) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以準備 PancakeSwap swap，但請補齊金額和輸出代幣。",
        "目前支援格式例如：「用 PancakeSwap 把 0.001 BNB 換成 USDC」。",
        "已接上的輸出代幣：USDC、USDT、CAKE。",
      ].join("\n"),
      model: "deterministic-defi",
    });
    return;
  }

  sendJson(response, 200, {
    intent: createServerPancakeSwapIntent({ amountInBnb: amount, outputSymbol }),
    message: `我已經準備 PancakeSwap review intent：${amount} BNB -> ${outputSymbol}。這不是送出交易，最後還要你在本機 Token Core 檢查並簽名。`,
    model: "deterministic-defi",
  });
}

function normalizePancakeOutputSymbol(value) {
  const token = stringOrEmpty(value).toUpperCase().trim();
  return PANCAKESWAP_OUTPUTS.has(token) ? token : null;
}

async function handleBscTransferChat(userMessage, response, walletAddress, semanticFields = null) {
  const draft = extractBscTransferDraft(userMessage, semanticFields);

  if (!walletAddress) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以幫你準備 BNB Smart Chain 轉帳，但我需要先知道目前 Token Core wallet address。",
        "請先在 Wallet 頁建立或解鎖 Google + Passkey / Token Core 錢包，再回來說一次轉帳指令。",
      ].join("\n"),
      model: "deterministic-transfer",
    });
    return;
  }

  if (draft.chain && !isBscLikeChain(draft.chain)) {
    sendJson(response, 200, {
      intent: null,
      message: [
        `我讀到你要在 ${draft.chain} 轉帳，但目前對話轉帳只接好 BNB Smart Chain。`,
        "已接上的 BNB Smart Chain 代幣是：BNB、USDT、USDC、CAKE、WBNB。",
        "如果要支援其他鏈，我需要先把該鏈 RPC、nonce/gas、token 合約和 explorer review 接好。",
      ].join("\n"),
      model: "deterministic-transfer",
    });
    return;
  }

  if (!draft.toAddress || !draft.amount || !draft.tokenSymbol) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以幫你準備 BNB Smart Chain 轉帳，但請給完整收款地址、代幣和金額。",
        "格式例如：",
        "「幫我轉 0.001 BNB 到 0x...」",
        "「轉錢給 0x... 2 USDT BNB鏈」",
        "目前對話轉帳支援 BNB Smart Chain 的 BNB、USDT、USDC、CAKE、WBNB。",
      ].join("\n"),
      model: "deterministic-transfer",
    });
    return;
  }

  const token = BSC_TRANSFER_TOKENS.get(draft.tokenSymbol);
  if (!token) {
    sendJson(response, 200, {
      intent: null,
      message: [
        `目前對話轉帳還沒有支援 ${draft.tokenSymbol}。`,
        "已接上的 BNB Smart Chain 代幣是：BNB、USDT、USDC、CAKE、WBNB。",
        "如果你要轉其他 BEP-20 token，我需要先把該 token 合約、decimals 和安全顯示接進白名單。",
      ].join("\n"),
      model: "deterministic-transfer",
    });
    return;
  }

  try {
    const intent = await createServerBscTransferIntent({
      amount: draft.amount,
      fromAddress: walletAddress,
      token,
      toAddress: draft.toAddress,
    });
    sendJson(response, 200, {
      intent,
      message: [
        `我已經準備 BNB Smart Chain ${token.symbol} 轉帳審核：${draft.amount} ${token.symbol} -> ${draft.toAddress}。`,
        "nonce、gas price、gas limit、value/calldata 都已經從真 BSC RPC 或白名單 token 合約準備。",
        "這還沒有送出；最後要你在本機 Token Core 檢查並簽名。",
      ].join("\n"),
      model: "deterministic-transfer",
    });
  } catch (error) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "我有收到轉帳要求，但沒有產生簽名 intent，因為真鏈上檢查沒有通過。",
        error instanceof Error ? error.message : "BSC transfer prepare failed.",
        "我不會用 fallback 假裝可轉；請先確認餘額、gas、收款地址和代幣。",
      ].join("\n"),
      model: "deterministic-transfer",
    });
  }
}

async function createServerBscTransferIntent(input) {
  const toAddress = normalizeServerEvmAddress(input.toAddress, "recipient");
  const fromAddress = normalizeServerEvmAddress(input.fromAddress, "source wallet");
  const amountValue = parseServerUnits(input.amount, input.token.decimals);
  if (amountValue <= 0n) {
    throw new Error(`${input.token.symbol} amount must be greater than zero.`);
  }

  const transferData = input.token.native ? "0x" : encodeServerErc20TransferData(toAddress, amountValue);
  const txTo = input.token.native ? toAddress : input.token.address;
  const txValue = input.token.native ? amountValue : 0n;
  if (!input.token.native) {
    const balance = await readServerBep20Balance({
      address: fromAddress,
      tokenAddress: input.token.address,
    });
    if (balance < amountValue) {
      throw new Error(
        `BSC ${input.token.symbol} 餘額不足：目前 ${formatServerUnits(balance, input.token.decimals, 8)} ${input.token.symbol}，需要 ${input.amount} ${input.token.symbol}。`,
      );
    }
  }

  const [nonceHex, gasPriceHex, gasEstimateHex] = await Promise.all([
    serverEthereumRpc("eth_getTransactionCount", [fromAddress, "latest"], "56"),
    serverEthereumRpc("eth_gasPrice", [], "56"),
    serverEthereumRpc("eth_estimateGas", [{
      data: transferData,
      from: fromAddress,
      to: txTo,
      value: `0x${txValue.toString(16)}`,
    }], "56"),
  ]);
  const gasLimit = addServerGasBuffer(BigInt(gasEstimateHex));
  const gasPrice = BigInt(gasPriceHex);
  const nonce = BigInt(nonceHex);

  return {
    actions: [
      {
        amount: `${input.amount.trim()} ${input.token.symbol}`,
        chain: "BNB Smart Chain",
        dappUrl: null,
        data: transferData,
        evmTx: {
          chainId: "56",
          data: transferData,
          gasLimit: gasLimit.toString(),
          gasPrice: gasPrice.toString(),
          nonce: nonce.toString(),
          to: txTo,
          txType: "00",
          value: txValue.toString(),
        },
        message: null,
        params: {
          gasLimit: gasLimit.toString(),
          gasPriceWei: gasPrice.toString(),
          nonce: nonce.toString(),
          tokenContract: input.token.native ? null : input.token.address,
        },
        to: toAddress,
        token: input.token.symbol,
        type: "transfer",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `bsc-${input.token.symbol.toLowerCase()}-transfer-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Recipient is a full EVM address shown in this review.",
      "Nonce, gas price, gas limit, and value were read from real BSC RPC before signing.",
      input.token.native
        ? "This is a native BNB transfer."
        : `This is a BEP-20 transfer through the verified ${input.token.symbol} contract ${input.token.address}.`,
      "Server and AI cannot sign this transaction.",
      "Final signing and broadcast happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Send ${input.amount.trim()} ${input.token.symbol} on BNB Smart Chain after local safety review.`,
    title: `BSC ${input.token.symbol} Transfer`,
  };
}

function isWalletTransferRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  if (/swap|pancake|puffer|venus|lista|renaiss|bitrefill/.test(text)) return false;
  return /(轉|转|匯|汇|發送|发送|send|transfer)/.test(text);
}

function extractBscTransferDraft(value, semanticFields = null) {
  const text = stringOrEmpty(value);
  const tokenSymbol = normalizeBscTransferTokenSymbol(semanticFields?.token) ?? extractBscTransferTokenSymbol(text);
  return {
    amount: nullableFieldString(semanticFields?.amount) ?? (tokenSymbol ? extractTokenAmount(text, tokenSymbol) : extractAnyTransferAmount(text)),
    chain: nullableFieldString(semanticFields?.chain),
    tokenSymbol,
    toAddress: normalizeOptionalServerEvmAddress(semanticFields?.toAddress) ?? text.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null,
  };
}

function extractBscTransferTokenSymbol(value) {
  const text = stringOrEmpty(value).toUpperCase();
  const match = text.match(/(^|[^A-Z0-9])(USDT|USDC|CAKE|WBNB|BNB)([^A-Z0-9]|$)/);
  return match?.[2] ?? null;
}

function normalizeBscTransferTokenSymbol(value) {
  const token = stringOrEmpty(value).toUpperCase().trim();
  if (!token) return null;
  if (token === "BEP20USDT" || token === "BSC-USDT") return "USDT";
  if (token === "BEP20USDC" || token === "BSC-USDC") return "USDC";
  return token;
}

function extractTokenAmount(value, tokenSymbol) {
  const token = tokenSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = stringOrEmpty(value);
  const beforeToken = text.match(new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${token}`, "i"))?.[1];
  if (beforeToken) return beforeToken;
  const afterToken = text.match(new RegExp(`${token}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"))?.[1];
  if (afterToken) return afterToken;
  return null;
}

function extractAnyTransferAmount(value) {
  const match = stringOrEmpty(value).match(/([0-9]+(?:\.[0-9]+)?)/);
  return match?.[1] ?? null;
}

function normalizeServerEvmAddress(value, label) {
  const text = stringOrEmpty(value).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    throw new Error(`${label} must be a full 0x EVM address.`);
  }
  return text;
}

function normalizeOptionalServerEvmAddress(value) {
  const text = stringOrEmpty(value).trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text : null;
}

function isBscLikeChain(value) {
  const text = stringOrEmpty(value).toLowerCase();
  return text === "56" || /bnb|bsc|binance/.test(text);
}

function addServerGasBuffer(gasEstimate) {
  return (gasEstimate * 120n) / 100n;
}

async function readServerBep20Balance(input) {
  const data = `0x70a08231${encodeServerAddress(input.address)}`;
  const result = await serverEthereumRpc("eth_call", [{ data, to: input.tokenAddress }, "latest"], "56");
  return BigInt(result);
}

function encodeServerErc20TransferData(toAddress, amount) {
  return `0xa9059cbb${encodeServerAddress(toAddress)}${encodeServerUint(amount)}`;
}

function encodeServerAddress(address) {
  return normalizeServerEvmAddress(address, "address").slice(2).toLowerCase().padStart(64, "0");
}

function createServerBscDappIntent(input) {
  return {
    actions: [
      {
        amount: null,
        chain: "BNB Smart Chain",
        dappUrl: input.dappUrl,
        data: null,
        message: null,
        params: {
          protocol: input.name,
          reviewOnly: true,
        },
        to: null,
        token: null,
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: input.riskLevel,
    safetyChecks: [
      ...input.safetyChecks,
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Prepare a ${input.category.toLowerCase()} interaction with ${input.name} on BNB Smart Chain.`,
    title: `${input.name} ${input.category} Intent`,
  };
}

function createRenaissListingSessionLoginIntent(listing, plan) {
  return {
    actions: [
      {
        amount: null,
        chain: "BNB Smart Chain",
        dappUrl: listing.cardUrl ?? "https://www.renaiss.xyz/marketplace",
        data: null,
        message: "Sign in to RENAISS with SIWE before creating a sell listing.",
        params: {
          action: "renaiss_session_login",
          cardUrl: listing.cardUrl,
          listingPriceUsdt: plan.askPrice.sellerReceivesDisplay,
          tokenId: listing.tokenId,
          walletAddress: plan.signerAddress,
        },
        to: null,
        token: null,
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-listing-login-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "info",
    safetyChecks: [
      "This only signs a RENAISS SIWE login message.",
      "No listing is created in this step.",
      "After login, the app will verify RENAISS ownerAddress before creating an Ask order.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Login to RENAISS before listing ${listing.cardUrl ?? `tokenId ${listing.tokenId}`}.`,
    title: "RENAISS Listing Login",
  };
}

function createRenaissListOrderIntent(listing, plan) {
  return {
    actions: [
      {
        amount: `${plan.askPrice.totalAskDisplay} USDT`,
        chain: "BNB Smart Chain",
        dappUrl: listing.cardUrl ?? plan.cardUrl,
        data: plan.ask.eip712Preimage,
        message: JSON.stringify(plan.ask.typedData, null, 2),
        params: {
          action: "renaiss_list_order_sign_and_submit",
          askData: plan.ask.askData,
          collectibleId: plan.collectibleId,
          collectibleName: plan.collectible?.name ?? null,
          expectedDigest: plan.ask.eip712Digest,
          orderbookContract: plan.contracts.orderbook,
          ownerAddress: plan.sellerAddress,
          safeAddress: plan.safe?.address ?? null,
          sellerReceivesUsdt: plan.askPrice.sellerReceivesDisplay,
          signatureMode: plan.signatureMode,
          tokenId: plan.tokenId.toString(),
          totalAskUsdt: plan.askPrice.totalAskDisplay,
          typedData: plan.ask.typedData,
        },
        to: plan.contracts.orderbook,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-listing-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "danger",
    safetyChecks: [
      plan.signatureMode === "safe_eip1271"
        ? "This signs the RENAISS Safe EIP-1271 wrapper for the Ask typed-data payload shown above."
        : "This signs the exact RENAISS Ask EIP-712 payload shown above.",
      "After local signature, the app submits RENAISS offer.createSellOffer with the current session cookie.",
      `Seller receives target: ${plan.askPrice.sellerReceivesDisplay} USDT`,
      `Total ask sent to RENAISS: ${plan.askPrice.totalAskDisplay} USDT`,
      `Seller wallet: ${plan.sellerAddress}`,
      `Collectible id: ${plan.collectibleId}`,
      `Orderbook contract: ${plan.contracts.orderbook}`,
      `EIP-712 digest: ${plan.ask.eip712Digest}`,
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `List ${plan.collectible?.name ?? `tokenId ${plan.tokenId}`} on RENAISS for total ask ${plan.askPrice.totalAskDisplay} USDT.`,
    title: "RENAISS Create Sell Offer",
  };
}

function createRenaissBlockedListingIntent(listing, plan) {
  return {
    actions: [
      {
        amount: `${plan.askPrice?.totalAskDisplay ?? listing.askPriceUsdt} USDT`,
        chain: "BNB Smart Chain",
        dappUrl: listing.cardUrl ?? plan.cardUrl ?? "https://www.renaiss.xyz/marketplace",
        data: null,
        message: null,
        params: {
          action: "renaiss_list_order_blocked",
          blockers: plan.blockers,
          session: plan.session ?? null,
          tokenId: plan.tokenId?.toString?.() ?? listing.tokenId,
        },
        to: null,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-listing-blocked-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "block",
    safetyChecks: plan.blockers.map((blocker) => blocker.message),
    serverCanExecute: false,
    status: "needs_review",
    summary: `Cannot safely list ${listing.cardUrl ?? `tokenId ${listing.tokenId}`} until the blockers are resolved.`,
    title: "RENAISS Listing Blocked",
  };
}

function createRenaissPurchaseReviewIntent(context) {
  return {
    actions: [
      {
        amount: String(context.askPriceUsd),
        chain: "BNB Smart Chain",
        dappUrl: context.renaissUrl ?? "https://www.renaiss.xyz/marketplace",
        data: null,
        message: null,
        params: {
          action: "renaiss_buy_now_review",
          askPriceUsdt: String(context.askPriceUsd),
          cardName: context.name,
          estimatedDiffPct: context.estimatedDiffPct,
          estimatedProfitUsd: context.estimatedProfitUsd,
          imageUrl: context.imageUrl,
          itemId: context.itemId,
          referenceMarket: context.bestMarket,
          requiresRenaissSession: true,
          reviewOnly: true,
        },
        to: null,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-purchase-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Verify the RENAISS item_id, card name, image, and listing URL before buying.",
      "Refresh the listing before signing because ask price and availability can change.",
      "Verify USDT spend amount, BNB gas funding, recipient, fees, and Permit2 allowance.",
      "The official RENAISS buyNow typed-data or transaction payload is not connected in this app yet.",
      "Do not sign until RENAISS returns the exact buyNow payload and Token Core decodes it on device.",
      "Server and AI cannot buy the card, sign the order, or broadcast the transaction.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Review buying ${context.name} on RENAISS at ${formatServerMoney(context.askPriceUsd)} USDT.`,
    title: "RENAISS Purchase Review",
  };
}

function mapBitrefillPaymentChain(method) {
  if (method === "ethereum") return "Ethereum Mainnet";
  if (method === "eth_base" || method === "usdc_base") return "Base";
  if (method === "usdc_erc20" || method === "usdt_erc20") return "Ethereum Mainnet";
  if (method === "bitcoin") return "Bitcoin";
  if (method === "lightning") return "Lightning";
  return method ?? null;
}

function sanitizeRenaissSession(value) {
  if (!value) {
    return {
      authenticated: false,
      cookieNames: [],
      sessionReady: false,
    };
  }

  return {
    authenticated: value.session.authenticated,
    cookieNames: value.cookieNames,
    createdAt: value.createdAt,
    id: value.id,
    origin: value.origin,
    ownerWalletAddress: value.session.ownerWalletAddress,
    sessionReady: Boolean(value.cookieHeader && value.session.authenticated),
    signedWalletAddress: value.session.signedWalletAddress,
    signedWalletLinked: value.session.signedWalletLinked,
    userId: value.session.userId,
    walletAddress: value.session.walletAddress,
    walletSource: value.session.walletSource,
  };
}

async function fetchRenaissJson(upstreamPath, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const upstream = await fetch(`${RENAISS_MONITOR_API_URL}${upstreamPath}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      method: options.method ?? "GET",
      signal: controller.signal,
    });
    const text = await upstream.text();
    const payload = text ? JSON.parse(text) : null;
    if (!upstream.ok) {
      const message = formatRenaissUpstreamError(payload?.detail ?? payload?.error ?? payload?.message);
      const error = new Error(message);
      error.statusCode = upstream.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("RENAISS monitor request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteRenaissLatestOpportunities() {
  return fetchRenaissJson("/v1/opportunities/latest", {
    method: "GET",
    timeoutMs: 10_000,
  });
}

function formatRenaissUpstreamError(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages = value.map(formatRenaissUpstreamError).filter(Boolean);
    if (messages.length) return messages.join(" / ");
  }
  if (value && typeof value === "object") {
    const direct = value.message ?? value.msg ?? value.error ?? value.detail ?? value.reason;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    try {
      return JSON.stringify(value).slice(0, 600);
    } catch {
      return "RENAISS monitor upstream returned an object error.";
    }
  }
  return "RENAISS monitor upstream request failed.";
}

function formatErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return formatRenaissUpstreamError(error);
}

function buildRenaissListingsQuery(requestUrl) {
  const output = new URLSearchParams();
  const passthrough = ["page", "pages", "step", "cardType", "orderBy", "dedupe", "q", "minAsk", "maxAsk"];
  for (const key of passthrough) {
    const value = requestUrl.searchParams.get(key);
    if (value !== null && value !== "") output.set(key, value);
  }
  output.set("limit", String(clampInteger(Number(requestUrl.searchParams.get("limit") ?? 5), 1, 100, 5)));
  return output;
}

async function handleBscDefiChat(userMessage, response) {
  const text = stringOrEmpty(userMessage).toLowerCase();
  if (text.includes("pancake") || /\bswap\b/.test(text)) {
    const token = inferPancakeTokenFromText(userMessage);
    const amount = extractBnbAmount(userMessage) ?? "0.001";
    sendJson(response, 200, {
      intent: createServerPancakeSwapIntent({ amountInBnb: amount, outputSymbol: token }),
      message: `我已經準備 PancakeSwap review intent：${amount} BNB -> ${token}。這不是送出交易，最後還要你在本機 Token Core 檢查並簽名。`,
      model: "deterministic-defi",
    });
    return;
  }

  if (text.includes("venus")) {
    sendJson(response, 200, {
      intent: createServerBscDappIntent({
        category: "Lending",
        dappUrl: VENUS_APP_URL,
        name: "Venus Protocol",
        riskLevel: "danger",
        safetyChecks: [
          "Review collateral factor, borrow amount, APY, and liquidation risk.",
          "Do not approve unlimited token spend.",
          "Do not sign until Token Core decodes the final DApp request.",
        ],
      }),
      message: "我已經準備 Venus lending review intent。這只會開啟風險審核與 DApp 請求，不會由 server 或 AI 代你供應、借款、還款或提款。",
      model: "deterministic-defi",
    });
    return;
  }

  if (text.includes("lista") || text.includes("slisbnb") || text.includes("lisusd") || text.includes("liquid staking")) {
    sendJson(response, 200, {
      intent: createServerBscDappIntent({
        category: "Liquid staking",
        dappUrl: LISTA_APP_URL,
        name: "Lista DAO",
        riskLevel: "danger",
        safetyChecks: [
          "Review BNB stake amount, received asset, and withdrawal or lock conditions.",
          "Review CDP collateral ratio before any lisUSD borrow intent.",
          "Do not sign until Token Core decodes the final DApp request.",
        ],
      }),
      message: "我已經準備 Lista liquid staking review intent。這只會整理 BNB staking / slisBNB / lisUSD 風險邊界，不會由 server 或 AI 代你簽名。",
      model: "deterministic-defi",
    });
    return;
  }

  sendJson(response, 200, {
    intent: null,
    message: "我可以準備 PancakeSwap swap、Venus lending、或 Lista liquid staking 的 review intent。請直接說明 protocol 和金額。",
    model: "deterministic-defi",
  });
}

async function proxyRenaissJson(response, upstreamPath, options = {}) {
  try {
    const payload = await fetchRenaissJson(upstreamPath, options);
    sendJson(response, 200, payload);
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : 502;
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : "RENAISS monitor proxy failed.",
    });
  }
}

async function readRenaissScanCache() {
  try {
    const raw = await fs.promises.readFile(RENAISS_SCAN_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.opportunities)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function readFreshRenaissScanCache() {
  const cached = await readRenaissScanCache();
  if (!cached?.opportunities?.length) return null;
  const cachedAt = cached.cache?.cachedAt ? new Date(cached.cache.cachedAt).getTime() : 0;
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
  if (Date.now() - cachedAt > RENAISS_FRESH_CACHE_MS) return null;
  return cached;
}

async function writeRenaissScanCache(payload) {
  const compactPayload = compactRenaissScanPayload(payload);
  await fs.promises.mkdir(path.dirname(RENAISS_SCAN_CACHE_PATH), { recursive: true });
  await fs.promises.writeFile(RENAISS_SCAN_CACHE_PATH, `${JSON.stringify(compactPayload, null, 2)}\n`, "utf8");
}

function withRenaissCacheMeta(payload, cache) {
  return {
    ...compactRenaissScanPayload(payload),
    cache,
  };
}

function normalizeRenaissCacheMeta(payload, fallback = {}) {
  const rawCache = payload?.cache && typeof payload.cache === "object" ? payload.cache : {};
  return {
    cachedAt: nullableString(rawCache.cachedAt ?? rawCache.cached_at ?? fallback.cachedAt ?? payload?.time_utc) ?? new Date().toISOString(),
    hit: typeof rawCache.hit === "boolean" ? rawCache.hit : undefined,
    reason: nullableString(rawCache.reason ?? fallback.reason),
    status: nullableString(fallback.status ?? rawCache.status) ?? (rawCache.hit === true ? "cached" : "live"),
  };
}

function compactRenaissRequestPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null && value !== undefined),
  );
}

function compactRenaissScanPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      cache: null,
      count: 0,
      min_profit_usd: 0,
      opportunities: [],
      reference_id: null,
      threshold_percent: 0,
      time_utc: new Date().toISOString(),
      wallet_budget_usd: null,
      wallet_notify: { sent: false },
    };
  }

  const opportunities = Array.isArray(payload.opportunities)
    ? payload.opportunities.map(sanitizeRenaissOpportunity).filter((item) => item.item_id)
    : [];
  return {
    cache: payload.cache ?? null,
    count: clampInteger(Number(payload.count ?? opportunities.length), 0, 1_000_000, opportunities.length),
    min_profit_usd: clampNumber(payload.min_profit_usd, 0, 1_000_000, 0),
    opportunities,
    reference_id: nullableString(payload.reference_id),
    threshold_percent: clampNumber(payload.threshold_percent, -100, 100, 0),
    time_utc: nullableString(payload.time_utc) ?? new Date().toISOString(),
    wallet_budget_usd: nullableNumber(payload.wallet_budget_usd, 0, 1_000_000),
    wallet_notify: payload.wallet_notify && typeof payload.wallet_notify === "object"
      ? {
          reason: nullableString(payload.wallet_notify.reason),
          sent: Boolean(payload.wallet_notify.sent),
          status_code: nullableNumber(payload.wallet_notify.status_code, 100, 599),
        }
      : { sent: false },
  };
}

function buildSystemPrompt(enabledSkills) {
  return [
    "You are a wallet agent inside a self-custodial wallet.",
    "You can chat and produce wallet intents only. You cannot execute actions.",
    "Never ask for private keys, seed phrases, cookies, Privy tokens, session tokens, or API keys.",
    "Any wallet action must be represented as an intent and must require local Token Core signing plus user confirmation.",
    "Do not claim that a transaction was executed, signed, submitted, or paid.",
    "Do not use emoji.",
    "Return strict JSON only. No markdown.",
    "Schema:",
    "For PancakeSwap BNB Chain swaps, use action type swap with chain BNB Smart Chain, amount as the BNB input amount, token as the output token only, and params.slippageBps as a number.",
    "For BNB to USDC, token must be USDC. For BNB to USDT, token must be USDT. For BNB to CAKE, token must be CAKE.",
    "For direct transfers, never create a transfer intent unless a deterministic server handler already prepared a complete evmTx with nonce, gas, value, and calldata. If transfer details are missing, return intent:null and ask for the exact chain, token, amount, and recipient.",
    "For Puffer staking, do not invent APY, balances, rates, calldata, gas, or nonce. If live prepared transaction data was not supplied by the app, explain that the Puffer mini app must prepare the review first and return intent:null.",
    "For Bitrefill commerce, do not invent products, prices, payment addresses, invoices, redemption codes, or order status. If Bitrefill API data was not supplied by the app, explain that Bitrefill credentials/search are required and return intent:null.",
    "For RENAISS card purchase or listing, never create a dapp_request or authorization intent. The server has deterministic RENAISS handlers for SIWE login, funding, Permit2, buyNow, and listing. If the deterministic handler did not provide data, return intent:null and explain what exact RENAISS data is missing.",
    "{\"message\":\"string\",\"intent\":null|{\"title\":\"string\",\"summary\":\"string\",\"riskLevel\":\"info|warning|danger|block\",\"actions\":[{\"type\":\"sign_message|transfer|dapp_request|swap\",\"chain\":null|string,\"to\":null|string,\"token\":null|string,\"amount\":null|string,\"message\":null|string,\"data\":null|string,\"dappUrl\":null|string,\"params\":null|object}],\"safetyChecks\":[\"string\"]}}",
    `Enabled skills: ${JSON.stringify(enabledSkills)}`,
  ].join("\n");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...corsHeaders,
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (payload === null) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload, jsonBigIntReplacer));
}

function jsonBigIntReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function serveStaticWeb(request, response, requestUrl) {
  const indexPath = path.join(STATIC_DIST_DIR, "index.html");
  if (!fs.existsSync(indexPath)) return false;

  const pathname = decodeURIComponent(requestUrl.pathname);
  const filePath = safeStaticJoin(STATIC_DIST_DIR, pathname === "/" ? "/index.html" : pathname);
  if (filePath && isReadableFile(filePath)) {
    sendStaticFile(request, response, filePath);
    return true;
  }

  if (!path.extname(pathname)) {
    sendStaticFile(request, response, indexPath);
    return true;
  }
  return false;
}

function sendStaticFile(request, response, filePath) {
  const extension = path.extname(filePath);
  response.writeHead(200, {
    ...getStaticSecurityHeaders(request),
    "Cache-Control": isImmutableAsset(filePath) ? "public, max-age=31536000, immutable" : "no-store",
    "Content-Type": staticContentTypes.get(extension) ?? "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function safeStaticJoin(root, pathname) {
  const resolved = path.resolve(root, `.${pathname}`);
  return resolved.startsWith(`${root}${path.sep}`) || resolved === root ? resolved : null;
}

function isReadableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isImmutableAsset(filePath) {
  return filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`);
}

function getStaticSecurityHeaders(request) {
  const host = String(request.headers.host ?? "localhost").split(":")[0];
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:8787 http://127.0.0.1:8787 https://accounts.google.com https://www.googleapis.com",
    "form-action 'self'",
  ].join("; ");
  const headers = {
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (!isLocalHost(host) && String(request.headers["x-forwarded-proto"] ?? "").toLowerCase() === "https") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function validateMessages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      if (item.role !== "user" && item.role !== "assistant") return null;
      if (typeof item.content !== "string" || item.content.trim().length === 0) return null;

      return {
        content: item.content.trim().slice(0, 6000),
        role: item.role,
      };
    })
    .filter(Boolean)
    .slice(-12);
}

function validateSkills(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      return {
        name: stringOrEmpty(item.name).slice(0, 80),
        policySummary: stringOrEmpty(item.policySummary).slice(0, 500),
        trigger: stringOrEmpty(item.trigger).slice(0, 300),
      };
    })
    .filter((item) => item && item.name.length > 0)
    .slice(0, 12);
}

function normalizeOptionalEvmAddress(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : null;
}

async function verifyGoogleBearerUser(request) {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    const error = new Error("Missing Google bearer token.");
    error.statusCode = 401;
    throw error;
  }

  const googleResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!googleResponse.ok) {
    const error = new Error(`Google token verification failed with HTTP ${googleResponse.status}.`);
    error.statusCode = 401;
    throw error;
  }
  const payload = await googleResponse.json();
  const sub = stringOrEmpty(payload.sub);
  const email = stringOrEmpty(payload.email);
  if (!sub || !email) {
    const error = new Error("Google token did not include stable sub/email.");
    error.statusCode = 401;
    throw error;
  }
  return {
    email,
    name: stringOrEmpty(payload.name) || email,
    sub,
  };
}

function extractBearerToken(value) {
  const match = stringOrEmpty(value).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getAuthErrorStatus(error) {
  if (error && typeof error === "object" && "statusCode" in error) {
    const status = Number(error.statusCode);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return 400;
}

function getWebWalletBackupPath(googleSub) {
  const digest = crypto.createHash("sha256").update(String(googleSub)).digest("hex");
  return path.join(WEB_WALLET_BACKUP_DIR, `${digest}.json`);
}

function sanitizeWebWalletBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("backup must be an object.");
  }
  const wallet = value.wallet;
  if (value.format !== "imtoken-agent-wallet-web-backup-v1" || !wallet || typeof wallet !== "object") {
    throw new Error("Unsupported web wallet backup format.");
  }

  const sanitized = {
    createdAt: requiredLimitedString(value.createdAt, "createdAt", 80),
    format: "imtoken-agent-wallet-web-backup-v1",
    wallet: {
      address: requiredAddress(wallet.address, "wallet.address"),
      credentialId: requiredLimitedString(wallet.credentialId, "wallet.credentialId", 2048),
      googleEmail: requiredLimitedString(wallet.googleEmail, "wallet.googleEmail", 320),
      googleName: requiredLimitedString(wallet.googleName, "wallet.googleName", 320),
      googleSub: requiredLimitedString(wallet.googleSub, "wallet.googleSub", 180),
      id: requiredLimitedString(wallet.id, "wallet.id", 260),
      keystoreJson: requiredLimitedString(wallet.keystoreJson, "wallet.keystoreJson", 300_000),
      rpId: requiredLimitedString(wallet.rpId, "wallet.rpId", 260),
    },
  };

  const savedAt = nullableString(value.savedAt);
  if (savedAt) sanitized.savedAt = savedAt.slice(0, 80);
  return sanitized;
}

function requiredLimitedString(value, label, maxLength) {
  const text = stringOrEmpty(value);
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too large.`);
  return text;
}

function requiredAddress(value, label) {
  const text = requiredLimitedString(value, label, 80);
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    throw new Error(`${label} must be an EVM address.`);
  }
  return text;
}

function hasRenaissSkill(enabledSkills) {
  return enabledSkills.some((skill) => {
    const text = `${skill.name} ${skill.trigger} ${skill.policySummary}`.toLowerCase();
    return text.includes("renaiss") || text.includes("卡牌") || text.includes("卡片");
  });
}

function hasBitrefillSkill(enabledSkills) {
  return enabledSkills.some((skill) => {
    const text = `${skill.name} ${skill.trigger} ${skill.policySummary}`.toLowerCase();
    return text.includes("bitrefill") || text.includes("gift card") || text.includes("esim") || text.includes("top-up");
  });
}

function hasPufferSkill(enabledSkills) {
  return enabledSkills.some((skill) => {
    const text = `${skill.name} ${skill.trigger} ${skill.policySummary}`.toLowerCase();
    return text.includes("puffer") || text.includes("pufeth") || text.includes("unifi");
  });
}

function isContextualRecommendationRequest(value) {
  const text = stringOrEmpty(value).toLowerCase().trim();
  if (!text) return false;
  if (isBitrefillRequest(text) || isRenaissRecommendationRequest(text) || isPufferRequest(text) || isBscDefiRequest(text)) {
    return false;
  }
  return /^(你)?推薦什麼[?？]?$|^(你)?推荐什么[?？]?$|有什麼推薦|有什么推荐|recommend\s+(something|anything)|what\s+do\s+you\s+recommend/.test(text);
}

function hasRecentBitrefillContext(messages) {
  return messages.slice(-8).some((message) => {
    const text = message.content.toLowerCase();
    return /bitrefill|gift card|giftcard|steam|禮品卡|礼品卡|儲值|充值|資料工具：bitrefill-api/.test(text);
  });
}

function hasRecentRenaissContext(messages) {
  return messages.slice(-8).some((message) => {
    const text = message.content.toLowerCase();
    return /renaiss|snkrdunk|pricecharting|renaiss_context_json|卡牌|卡片|psa\s*10/.test(text);
  });
}

async function classifyRenaissChatRoute({ enabledSkills, lastUserMessage, messages }) {
  if (!shouldClassifyRenaissChat(lastUserMessage, messages)) return null;

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;

  const model = process.env.MINIMAX_MODEL ?? "MiniMax-M2.7";
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  const minimaxResponse = await fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            "你是錢包 agent 的安全路由分類器，只負責判斷使用者下一步想進入哪一個 RENAISS 流程。",
            "不要回答使用者，不要產生 wallet intent，不要產生交易 payload，不要補資料。",
            "只允許回傳 strict JSON：{\"intent\":\"listing|purchase|recommendation|none\",\"confidence\":0,\"reason\":\"string\"}",
            "listing = 使用者要在 RENAISS 掛單、上架、出售、賣卡、設定 ask price。",
            "purchase = 使用者要買入先前推薦或分析過的 RENAISS 卡，或對購買流程做短確認。",
            "recommendation = 使用者要 RENAISS 特價卡、卡牌推薦、價格分析、警報或撿漏列表。",
            "none = Bitrefill、Puffer、swap、Venus、Lista、一般聊天、或不是 RENAISS。",
            "掛單/上架/出售/賣，永遠優先分類為 listing，不要分類成 purchase。",
            "買/購買/幫我買這張，只有在訊息或最近上下文有 RENAISS 卡片時才分類為 purchase。",
            "如果不確定，intent 用 none，confidence 低於 50。",
          ].join("\n"),
          role: "system",
        },
        {
          content: JSON.stringify({
            enabledSkills: enabledSkills.map((skill) => ({
              name: skill.name,
              policySummary: skill.policySummary,
              trigger: skill.trigger,
            })),
            lastUserMessage: stringOrEmpty(lastUserMessage).slice(0, 500),
            recentMessages: messages.slice(-8).map((message) => ({
              content: stringOrEmpty(message.content).slice(0, 900),
              role: message.role,
            })),
            recentRenaissPurchaseContext: findLatestRenaissPurchaseContext(messages),
          }),
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  let data;
  try {
    data = await minimaxResponse.json();
  } catch {
    data = null;
  }
  if (!minimaxResponse.ok) {
    throw new Error(data?.error?.message ?? data?.base_resp?.status_msg ?? "MiniMax RENAISS route classification failed.");
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    throw new Error("MiniMax RENAISS route classification did not include assistant content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(extractFirstJsonObject(rawContent));
  } catch {
    throw new Error("MiniMax RENAISS route classification was not strict JSON.");
  }

  const intent = stringOrEmpty(parsed.intent).toLowerCase();
  const confidence = nullableNumber(parsed.confidence, 0, 100) ?? 0;
  if (!["listing", "purchase", "recommendation", "none"].includes(intent)) {
    throw new Error("MiniMax RENAISS route classification returned an unknown intent.");
  }
  if (intent === "none" || confidence < 50) return null;
  return {
    confidence,
    intent,
    reason: stringOrEmpty(parsed.reason).slice(0, 240),
  };
}

function shouldClassifyRenaissChat(lastUserMessage, messages) {
  const text = stringOrEmpty(lastUserMessage).toLowerCase().trim();
  if (!text) return false;
  if (/bitrefill|gift card|giftcard|esim|top-?up|steam|uber|netflix|google play|doordash/.test(text)) return false;
  if (/pancakeswap|pancake|swap|puffer|venus|lista|staking|lend|borrow|質押|质押|借貸|借贷/.test(text)) return false;

  if (/renaiss|renaiss\.xyz|snkrdunk|pricecharting|pokemon|psa\s*10|卡牌|卡片|特價|特价|警報|警报|低價|低价|撿漏|捡漏|價差|价差/.test(text)) {
    return true;
  }
  if (/掛單|挂单|上架|出售|賣|卖|list\b|listing\b|sell\b|ask\s*price|askprice|開價|开价/.test(text)) {
    return true;
  }
  if (hasRecentRenaissContext(messages) && /買|买|購買|购买|要|好|確認|确认|可以|推薦|推荐|分析/.test(text)) {
    return true;
  }
  return false;
}

function isRenaissRecommendationRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  if (/bitrefill|gift card|giftcard|esim|top-?up/.test(text)) return false;
  if (isRenaissListingRequest(value)) return false;
  if (isRenaissPurchaseRequest(value)) return false;
  return /renaiss|pokemon|psa\s*10|snkrdunk|pricecharting|buy_candidate|monitor|alert|卡牌|卡片|特價|特价|警報|警报|低價|低价|撿漏|捡漏|價差|价差|分析第\s*\d+\s*張|分析第\s*\d+\s*张/.test(text);
}

function isRenaissPurchaseRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  if (/bitrefill|gift card|giftcard|pancake|puffer|venus|lista/.test(text)) return false;
  return /幫我買這張|帮我买这张|買這張|买这张|購買這張|购买这张|買它|买它|幫我買|帮我买|buy\s+(this|it|card)|purchase\s+(this|it|card)/.test(text);
}

function isGenericPurchaseRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  if (/bitrefill|gift card|giftcard|esim|top-?up|steam|uber|netflix|google play|doordash/.test(text)) return false;
  if (/pancakeswap|pancake|swap|puffer|venus|lista|staking|lend|borrow|質押|质押|借貸|借贷/.test(text)) return false;
  if (isRenaissListingRequest(value)) return false;
  return /我要買|我要买|想買|想买|購買|购买|買一下|买一下|buy\b|purchase\b/.test(text);
}

function isRenaissShortPurchaseConfirmation(value) {
  const text = stringOrEmpty(value).trim().toLowerCase();
  return /^(要|好|確認|确认|可以|買|买|買了|买了|買這個|买这个|要買|要买)$/.test(text);
}

function findLatestRenaissPurchaseContext(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const context = extractRenaissContextFromMessage(message.content);
    if (context) return context;
  }
  return null;
}

function extractRenaissContextFromMessage(content) {
  const match = stringOrEmpty(content).match(/RENAISS_CONTEXT_JSON:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    return sanitizeRenaissPurchaseContext(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

function sanitizeRenaissPurchaseContext(value) {
  if (!value || typeof value !== "object") return null;
  const itemId = stringOrEmpty(value.item_id).slice(0, 160);
  const name = stringOrEmpty(value.name).slice(0, 260);
  const askPriceUsd = nullableNumber(value.ask_price_usd, 0.01, 1_000_000);
  if (!itemId || !name || askPriceUsd === null) return null;

  return {
    askPriceUsd,
    bestMarket: nullableString(value.best_market),
    estimatedDiffPct: nullableNumber(value.estimated_diff_pct, -100, 10_000),
    estimatedProfitUsd: nullableNumber(value.estimated_profit_usd, -1_000_000, 1_000_000),
    imageUrl: normalizeHttpUrl(value.image_url),
    itemId,
    name,
    renaissUrl: normalizeHttpUrl(value.renaiss_url),
  };
}

function isRenaissListingRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  if (/bitrefill|gift card|giftcard|pancake|puffer|venus|lista/.test(text)) return false;
  const hasListingVerb = /掛單|挂单|上架|出售|賣|卖|list\b|listing\b|sell\b|ask\s*price|askprice|開價|开价/.test(text);
  if (!hasListingVerb) return false;
  if (/renaiss|renaiss\.xyz|卡牌|卡片|tokenid|token id/.test(text)) return true;
  return /^(我要|我想|我想要|幫我|帮我|可以|請|请)?\s*(掛單|挂单|上架|出售|賣|卖)/.test(text);
}

function extractRenaissListingDraft(value) {
  const text = stringOrEmpty(value);
  return {
    askPriceUsdt: extractRenaissAskPrice(text),
    cardUrl: extractRenaissCardUrl(text),
    tokenId: extractRenaissTokenId(text),
  };
}

function extractRenaissCardUrl(value) {
  const match = value.match(/https?:\/\/(?:www\.)?renaiss\.xyz\/[^\s)）"'<>]+/i);
  return match?.[0] ?? null;
}

function extractRenaissTokenId(value) {
  const explicit = value.match(/(?:token\s*id|tokenid|token|#)\s*[:：#]?\s*([0-9]{1,30})/i)?.[1];
  if (explicit) return explicit;

  const url = extractRenaissCardUrl(value);
  const urlToken = url?.match(/(?:tokenId|token-id|token_id|token|cards?|collectibles?|item)[=/:-]([0-9]{1,30})/i)?.[1]
    ?? url?.match(/\/([0-9]{1,30})(?:[/?#]|$)/)?.[1];
  return urlToken ?? null;
}

function extractRenaissAskPrice(value) {
  const patterns = [
    /(?:掛|挂|價格|价格|開價|开价|price|ask)\s*[:：]?\s*\$?\s*([0-9]+(?:\.[0-9]{1,4})?)\s*(?:usdt|usd|u)?/i,
    /\$([0-9]+(?:\.[0-9]{1,4})?)\s*(?:usdt|usd|u)?/i,
    /([0-9]+(?:\.[0-9]{1,4})?)\s*(?:usdt|usd)\b/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const parsed = match ? Number.parseFloat(match[1]) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000) {
      return Number(parsed.toFixed(4));
    }
  }
  return null;
}

function isBitrefillRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  return /bitrefill|gift card|giftcard|esim|top-?up|steam|uber|netflix|google play|doordash|禮品卡|礼品卡|儲值|充值/.test(text);
}

function isBitrefillCatalogRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  if (!/bitrefill|禮品卡|礼品卡|儲值|充值|gift card|giftcard|esim|top-?up/.test(text)) return false;
  return /有什麼|有什么|提供什麼|提供什么|有哪些|商品|服務|服务|類別|类别|品項|品项|catalog|products|categories/.test(text);
}

function isPufferRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  return /puffer|pufeth|unifi|stake eth|staking eth|質押|质押/.test(text);
}

function isBscDefiRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  return /pancakeswap|pancake|swap\s+[0-9.]+\s*bnb|venus|lista|slisbnb|lisusd|liquid staking|流動質押|流动质押/.test(text);
}

function pickBestRenaissOpportunity(opportunities) {
  return opportunities
    .map(sanitizeRenaissOpportunity)
    .filter((item) => item.item_id)
    .sort((left, right) => scoreRenaissOpportunity(right) - scoreRenaissOpportunity(left))[0] ?? null;
}

function isRenaissCardListRequest(value) {
  const text = stringOrEmpty(value).toLowerCase();
  return /特價卡|特价卡|低價卡|低价卡|卡片.*(有哪些|清單|列表|挑)|卡牌.*(有哪些|清單|列表|挑)|有哪些.*卡|現在有什麼.*卡|现在有什么.*卡|opportunities|deals|list/.test(text);
}

function rankRenaissOpportunities(opportunities) {
  return opportunities
    .map(sanitizeRenaissOpportunity)
    .filter((item) => item.item_id && item.name)
    .sort((left, right) => scoreRenaissOpportunity(right) - scoreRenaissOpportunity(left));
}

function isPositiveRenaissDeal(item) {
  const sourcePositive = ["pricecharting", "snkrdunk"].some((key) => Number(item.sources?.[key]?.diff_pct ?? 0) > 0);
  return Number(item.estimated_profit_usd ?? 0) > 0 || Number(item.estimated_diff_pct ?? 0) > 0 || sourcePositive;
}

function extractRenaissListIndex(value) {
  const match = stringOrEmpty(value).match(/分析第\s*([1-9][0-9]?)\s*[張张]/);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index > 0 && index <= 20 ? index : null;
}

function scoreRenaissOpportunity(item) {
  const actionScore = item.action === "BUY_CANDIDATE" ? 1_000 : 0;
  const actionableScore = item.actionable || item.is_opportunity ? 400 : 0;
  const profitScore = Number(item.estimated_profit_usd ?? 0);
  const spreadScore = Number(item.estimated_diff_pct ?? 0) * 4;
  const sourceScore = ["pricecharting", "snkrdunk"].reduce((score, key) => {
    const source = item.sources?.[key];
    return score + Number(source?.diff_pct ?? 0);
  }, 0);
  return actionScore + actionableScore + profitScore + spreadScore + sourceScore;
}

function formatRenaissChatRecommendation(item, review) {
  const opportunity = sanitizeRenaissOpportunity(item);
  const edge = formatRenaissOpportunityEdge(opportunity);
  const lines = [
    `我先推薦這張：${opportunity.name}`,
    `目前 ask $${formatServerMoney(opportunity.ask_price_usd)}，${edge}。`,
    `${review.headline}`,
  ];
  if (review.priceSummary) lines.push(`價格：${review.priceSummary}`);
  if (review.trendSummary) lines.push(`走勢：${review.trendSummary}`);
  if (review.cardNameSignals.length > 0) {
    lines.push(`卡名判斷：${review.cardNameSignals.join(" / ")}`);
  }
  if (review.reasons.length > 0) {
    lines.push(`我會這樣判斷：${review.reasons.join(" / ")}`);
  }
  if (review.riskFlags.length > 0) {
    lines.push(`風險：${review.riskFlags.join(" / ")}`);
  }
  lines.push(`結論：${formatRenaissVerdictLabel(review.verdict)}，信心 ${review.confidence}%。`);
  lines.push("你要我準備購買流程嗎？如果要，直接回「幫我買這張」。");
  return lines.join("\n");
}

function formatRenaissOpportunityList(items) {
  if (!items.length) {
    return [
      "目前沒有可列出的 RENAISS 特價卡片。",
      "我會繼續用 monitor 快取/遠端 API 查；你也可以稍後說「重新掃 RENAISS 特價卡」。",
    ].join("\n");
  }

  const lines = [
    "目前掃到的 RENAISS 特價卡片候選清單如下。這是排序清單，不是直接買入指令。",
    "你可以回「分析第 2 張」或貼卡名，我再用完整價格 records 做中文分析。",
  ];

  items.slice(0, 8).forEach((item, index) => {
    const bestSource = getBestRenaissSource(item);
    lines.push("");
    lines.push(`${index + 1}. ${item.name}`);
    lines.push(
      [
        `Ask $${formatServerMoney(item.ask_price_usd)}`,
        bestSource ? `參考 ${bestSource.label} 摘要均價 $${formatServerMoney(bestSource.avg_price_usd)}` : "參考摘要均價不足",
        item.estimated_diff_pct === null ? "價差不足" : `價差 ${item.estimated_diff_pct.toFixed(1)}%`,
        item.estimated_profit_usd === null
          ? "預估損益不足"
          : `預估 ${item.estimated_profit_usd >= 0 ? "+" : "-"}$${formatServerMoney(Math.abs(item.estimated_profit_usd))}`,
      ].join(" / "),
    );
    lines.push(`資料：${formatRenaissSourcesBrief(item)}`);
    const links = formatRenaissLinksBrief(item);
    if (links) lines.push(`來源連結：${links}`);
  });

  lines.push("");
  lines.push("要我深入看哪張，直接回「分析第 1 張」。要買的話也會先建立購買審核 intent，最後仍要你確認。");
  return lines.join("\n");
}

function getBestRenaissSource(item) {
  const sources = [
    { key: "pricecharting", label: "PriceCharting", ...item.sources?.pricecharting },
    { key: "snkrdunk", label: "SNKRDUNK", ...item.sources?.snkrdunk },
  ].filter((source) => typeof source.avg_price_usd === "number");
  return sources.sort((left, right) => Number(right.diff_pct ?? -Infinity) - Number(left.diff_pct ?? -Infinity))[0] ?? null;
}

function formatRenaissSourcesBrief(item) {
  const sourcePairs = [
    ["PriceCharting", item.sources?.pricecharting],
    ["SNKRDUNK", item.sources?.snkrdunk],
  ];
  const parts = sourcePairs
    .map(([label, source]) => {
      if (!source?.avg_price_usd) return null;
      const diff = source.diff_pct === null ? "價差不足" : `${source.diff_pct.toFixed(1)}%`;
      const samples = Number(source.records_total || source.sample_count || 0);
      return `${label} 摘要均價 $${formatServerMoney(source.avg_price_usd)} / ${diff}${samples ? ` / ${samples} 筆` : ""}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join("；") : "來源均價不足";
}

function formatRenaissLinksBrief(item) {
  const links = [];
  if (item.renaiss_url) links.push(`RENAISS ${item.renaiss_url}`);
  if (item.sources?.pricecharting?.url) links.push(`PriceCharting ${item.sources.pricecharting.url}`);
  if (item.sources?.snkrdunk?.url) links.push(`SNKRDUNK ${item.sources.snkrdunk.url}`);
  return links.join(" / ");
}

function formatRenaissOpportunityEdge(item) {
  const spread = item.estimated_diff_pct === null ? "無明確價差" : `${item.estimated_diff_pct.toFixed(1)}% 價差`;
  const profit = item.estimated_profit_usd === null ? "" : ` / 預估 $${formatServerMoney(item.estimated_profit_usd)}`;
  return `${item.action === "BUY_CANDIDATE" ? "候選" : "觀望"} / ${spread}${profit}`;
}

function formatRenaissVerdictLabel(value) {
  if (value === "buy_candidate") return "可考慮";
  if (value === "avoid") return "先不要";
  return "觀望";
}

function extractBitrefillQuery(value) {
  const text = stringOrEmpty(value);
  const lower = text.toLowerCase();
  const known = [
    "Google Play",
    "DoorDash",
    "Netflix",
    "Airbnb",
    "Steam",
    "Uber",
    "Apple",
  ];
  const match = known.find((item) => lower.includes(item.toLowerCase()));
  if (match) return match;
  const afterKeyword = text.match(/(?:find|search|buy|找|搜尋|搜索|買|购买)\s+([a-zA-Z0-9][a-zA-Z0-9 &-]{1,40})/i)?.[1];
  return afterKeyword?.trim() || null;
}

function extractCountryCode(value) {
  const text = stringOrEmpty(value).toUpperCase();
  const supported = new Set([
    "US", "TW", "JP", "HK", "SG", "KR", "CN", "CA", "GB", "AU", "DE", "FR", "IT", "ES", "NL", "SE",
    "ZA", "ID", "PH", "TH", "VN", "MY", "BR", "MX", "AR", "CL", "AE", "SA", "TR", "IN",
  ]);
  const explicit = [...text.matchAll(/\b([A-Z]{2})\b/g)]
    .map((match) => match[1])
    .reverse()
    .find((code) => supported.has(code));
  if (explicit) return explicit;
  if (/台灣|台湾|TAIWAN/.test(value)) return "TW";
  if (/日本|JAPAN/.test(value)) return "JP";
  if (/美國|美国|UNITED STATES|USA/.test(value)) return "US";
  return null;
}

function inferPancakeTokenFromText(value) {
  const text = stringOrEmpty(value).toUpperCase();
  for (const token of PANCAKESWAP_OUTPUTS) {
    if (new RegExp(`(^|[^A-Z0-9])${token}([^A-Z0-9]|$)`).test(text)) return token;
  }
  return "USDC";
}

function extractBnbAmount(value) {
  const match = stringOrEmpty(value).match(/([0-9]+(?:\.[0-9]+)?)\s*BNB/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000) return null;
  return match[1];
}

function formatBitrefillSearchMessage(products, input) {
  const lines = [
    `我已經用 Bitrefill 真 API 搜尋「${input.query}」(${input.country})。`,
    "可以先看這幾個商品：",
  ];
  for (const product of products.slice(0, 5)) {
    const packageText = product.packages
      .slice(0, 4)
      .map((item) => `${item.value ?? item.id}`)
      .join(", ");
    lines.push(`- ${product.name}：${product.currency ?? "-"} / ${product.inStock === false ? "缺貨" : "有庫存"} / 面額 ${packageText || "自訂"}`);
  }
  lines.push("如果要建立 invoice，先告訴我商品與面額；建立後仍然只會產生付款 intent，最後要你在本機 Token Core 確認。");
  return lines.join("\n");
}

function formatBitrefillCatalogMessage(products, input) {
  const groups = groupBitrefillProductsByCategory(products);
  const lines = [
    `我剛查 Bitrefill 真 API（${input.country}），這段是 API 目錄摘要，不是假裝 AI 推薦。`,
    "目前可用商品大致分成這幾類：",
  ];

  for (const group of groups.slice(0, 6)) {
    const names = group.products.slice(0, 3).map((product) => product.name).join("、");
    lines.push(`- ${group.label}：${names}`);
  }

  lines.push("如果你要買，直接講清楚商品、國家和面額，例如「用 Bitrefill 買 Steam US 20 美元」。");
  lines.push("如果你問「推薦什麼」，我會用 MiniMax 根據這份真 API 商品清單幫你挑，不會切去卡牌。");
  lines.push("建立 invoice 前會再查一次商品和面額；付款仍要你在本機 Token Core 確認。");
  return lines.join("\n");
}

function formatBitrefillAiRecommendation(review, input) {
  const lines = [
    `我用 Bitrefill 真 API 商品清單 + ${review.model} 幫你挑 ${input.country} 可買商品。`,
    review.headline,
  ].filter(Boolean);
  review.recommendations.forEach((item, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${item.name}`);
    lines.push(`適合：${item.bestFor}`);
    lines.push(`原因：${item.why}`);
    lines.push(`面額：${item.denominationHint}`);
  });
  lines.push("");
  lines.push(review.nextQuestion || "要買哪一個，直接回商品、國家和面額，例如「用 Bitrefill 買 Steam US 20 美元」。");
  lines.push("我會建立 invoice 審核 intent；付款最後仍要你在本機 Token Core 確認。");
  lines.push("資料工具：bitrefill-api + MiniMax");
  return lines.join("\n");
}

function normalizeBitrefillAiRecommendation(value, model) {
  if (!value || typeof value !== "object") {
    throw new Error("MiniMax Bitrefill recommendation JSON must be an object.");
  }
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations
        .map((item) => ({
          bestFor: stripEmoji(stringOrEmpty(item?.bestFor)).slice(0, 120),
          denominationHint: stripEmoji(stringOrEmpty(item?.denominationHint)).slice(0, 120),
          name: stripEmoji(stringOrEmpty(item?.name)).slice(0, 160),
          why: stripEmoji(stringOrEmpty(item?.why)).slice(0, 180),
        }))
        .filter((item) => item.name && item.why)
        .slice(0, 5)
    : [];
  if (recommendations.length === 0) {
    throw new Error("MiniMax Bitrefill recommendation did not include any products.");
  }
  return {
    headline: stripEmoji(stringOrEmpty(value.headline)).slice(0, 220),
    model,
    nextQuestion: stripEmoji(stringOrEmpty(value.nextQuestion)).slice(0, 220),
    recommendations,
  };
}

function stripEmoji(value) {
  return value.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s{2,}/g, " ").trim();
}

function groupBitrefillProductsByCategory(products) {
  const groups = new Map();
  for (const product of products) {
    const label = getBitrefillCategoryLabel(product);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(product);
  }

  return [...groups.entries()]
    .map(([label, groupProducts]) => ({ label, products: groupProducts }))
    .sort((left, right) => right.products.length - left.products.length);
}

function getBitrefillCategoryLabel(product) {
  const categories = (Array.isArray(product.categories) ? product.categories : []).join(" ");
  if (/refill|topup|mobile|phone|cellular/.test(categories)) return "手機儲值";
  if (/esim|sim/.test(categories)) return "eSIM";
  if (/food|restaurant|restaurants|dining/.test(categories)) return "餐飲";
  if (/game|gaming|steam|playstation|xbox|nintendo/.test(categories)) return "遊戲";
  if (/entertainment|music|movie|streaming|netflix|spotify/.test(categories)) return "娛樂訂閱";
  if (/apparel|fashion|clothing|shoes/.test(categories)) return "服飾";
  if (/travel|hotel|airline|transport/.test(categories)) return "旅遊交通";
  if (/shopping|ecommerce|retail|marketplace/.test(categories)) return "電商購物";
  if (/health|beauty|pharmacy/.test(categories)) return "健康美妝";
  return "其他";
}

function inferPufferNetworkMode(userMessage) {
  const text = String(userMessage ?? "").toLowerCase();
  if (/holesky|testnet|測試網|测试网/.test(text)) return "testnet";
  return "mainnet";
}

function isPufferSepoliaRequest(userMessage) {
  return /sepolia/i.test(String(userMessage ?? ""));
}

function getServerPufferConfig(networkMode = "mainnet") {
  const isTestnet = networkMode === "testnet";
  const sdkChain = isTestnet ? PUFFER_HOLESKY : PUFFER_MAINNET;
  const chain = isTestnet ? "Ethereum Holesky" : "Ethereum Mainnet";
  return {
    chain,
    chainId: isTestnet ? "17000" : "1",
    isTestnet,
    networkMode,
    pufEth: requireServerSdkAddress(TOKENS_ADDRESSES.pufETH[sdkChain], "pufETH", chain),
    pufferDepositor: requireServerSdkAddress(CONTRACT_ADDRESSES[sdkChain]?.PufferDepositor, "PufferDepositor", chain),
    pufferVault: requireServerSdkAddress(CONTRACT_ADDRESSES[sdkChain]?.PufferVault, "PufferVault", chain),
    sdkChain,
  };
}

async function readServerPufferSnapshot(networkMode = "mainnet") {
  const config = getServerPufferConfig(networkMode);
  const previewWei = await readServerPufferPreviewDeposit(
    parseServerUnits("1", PUFFER_DECIMALS),
    config.pufferVault,
    config.chainId,
  );
  return {
    chain: config.chain,
    chainId: config.chainId,
    isTestnet: config.isTestnet,
    networkMode: config.networkMode,
    pufEth: config.pufEth,
    pufferDepositor: config.pufferDepositor,
    pufferVault: config.pufferVault,
    rateLabel: `1 ETH = ${formatServerUnits(previewWei, PUFFER_DECIMALS, 6)} pufETH`,
    vaults: config.isTestnet ? [] : [
      {
        accepts: "pufETH",
        address: requireServerSdkAddress(VAULTS_ADDRESSES[UnifiToken.unifiETH][PUFFER_MAINNET].NucleusBoringVault, "UniFi ETH Vault"),
        name: "UniFi ETH Vault",
        outputToken: "unifiETH",
      },
      {
        accepts: "USDC / USDT / stablecoins",
        address: requireServerSdkAddress(VAULTS_ADDRESSES[UnifiToken.unifiUSD][PUFFER_MAINNET].NucleusBoringVault, "UniFi USD Vault"),
        name: "UniFi USD Vault",
        outputToken: "unifiUSD",
      },
      {
        accepts: "WBTC / BTC wrappers",
        address: requireServerSdkAddress(VAULTS_ADDRESSES[UnifiToken.unifiBTC][PUFFER_MAINNET].NucleusBoringVault, "UniFi BTC Vault"),
        name: "UniFi BTC Vault",
        outputToken: "unifiBTC",
      },
      {
        accepts: "pufETH",
        address: requireServerSdkAddress(VAULTS_ADDRESSES[UnifiToken.pufETHs][PUFFER_MAINNET].NucleusBoringVault, "pufETHs Vault"),
        name: "pufETHs Vault",
        outputToken: "pufETHs",
      },
    ],
  };
}

async function readServerPufferPreviewDeposit(amountWei, pufferVault, chainId = "1") {
  const data = `0x${PUFFER_PREVIEW_DEPOSIT_SELECTOR}${encodeServerUint(amountWei)}`;
  const result = await serverEthereumRpc("eth_call", [{ data, to: pufferVault }, "latest"], chainId);
  return BigInt(result);
}

async function serverEthereumRpc(method, params, chainId = "1") {
  const upstream = await fetch(getServerEvmRpcUrl(chainId), {
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const text = await upstream.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: { message: text || "Ethereum RPC returned non-JSON response." } };
  }
  if (!upstream.ok || payload.error) {
    throw new Error(payload.error?.message ?? `Ethereum RPC ${method} failed.`);
  }
  if (typeof payload.result !== "string") {
    throw new Error(`Ethereum RPC ${method} returned no result.`);
  }
  return payload.result;
}

function formatPufferChatMessage(snapshot) {
  const lines = [
    "我用 Puffer SDK 和 Ethereum RPC 讀到目前 pufETH review 資料：",
    `- 網路：${snapshot.chain} / chainId ${snapshot.chainId}`,
    `- 匯率：${snapshot.rateLabel}`,
    `- PufferVault：${snapshot.pufferVault}`,
    `- PufferDepositor：${snapshot.pufferDepositor}`,
    `- pufETH：${snapshot.pufEth}`,
    snapshot.vaults.length > 0 ? "UniFi / Puffer vault：" : "UniFi vault：目前 Puffer SDK 只列 Mainnet vault，Holesky 測試網不顯示 UniFi 機會。",
    ...snapshot.vaults.map((vault) => `- ${vault.name}：收 ${vault.accepts}，產出 ${vault.outputToken}，合約 ${vault.address}`),
    "如果要準備實際 ETH -> pufETH 交易，先建立/載入本機 Token Core 錢包，再到 Puffer mini app 或直接跟我說金額；最後仍需要你本機簽名。",
  ];
  return lines.join("\n");
}

function parseServerUnits(value, decimals) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amount must be a decimal number.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimals.`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

function formatServerUnits(value, decimals, maxFractionDigits) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

function encodeServerUint(value) {
  if (value < 0n) {
    throw new Error("Cannot ABI encode a negative integer.");
  }
  return value.toString(16).padStart(64, "0");
}

function requireServerSdkAddress(value, label, chain = "Ethereum Mainnet") {
  if (!value) {
    throw new Error(`Puffer SDK did not provide ${label} address for ${chain}.`);
  }
  return value;
}

function formatServerMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0.00";
  return number.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatServerTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "近期";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
  }).format(date);
}

function parseStrictAgentResponse(rawContent) {
  const jsonText = extractFirstJsonObject(rawContent);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("MiniMax response was not strict JSON, so no wallet intent was accepted.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("MiniMax response JSON must be an object.");
  }

  const message = stringOrEmpty(parsed.message).trim();
  if (!message) {
    throw new Error("MiniMax response JSON is missing message.");
  }

  return {
    intent: parsed.intent && typeof parsed.intent === "object" ? parsed.intent : null,
    message,
  };
}

function extractFirstJsonObject(rawContent) {
  const withoutThinking = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = withoutThinking.indexOf("{");
  if (start === -1) {
    throw new Error("MiniMax response did not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < withoutThinking.length; index += 1) {
    const char = withoutThinking[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      return withoutThinking.slice(start, index + 1);
    }
  }

  throw new Error("MiniMax response JSON object was incomplete.");
}

function normalizeWalletIntent(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("MiniMax intent must be null or an object.");
  }

  const title = stringOrEmpty(value.title).trim();
  const summary = stringOrEmpty(value.summary).trim();
  const riskLevel = normalizeRiskLevel(value.riskLevel);
  const safetyChecks = normalizeSafetyChecks(value.safetyChecks);
  const actions = normalizeActions(value.actions, `${title} ${summary} ${safetyChecks.join(" ")}`);
  const joined = JSON.stringify({ actions, safetyChecks, summary, title }).toLowerCase();

  if (!title || !summary) {
    throw new Error("Wallet intent is missing title or summary.");
  }

  if (containsForbiddenSecretRequest(joined)) {
    throw new Error("Wallet intent requested secrets or sessions and was blocked.");
  }

  if (containsRenaissGeneratedIntent(joined, actions)) {
    throw new Error("RENAISS wallet intents must be produced by the deterministic RENAISS flow, not MiniMax.");
  }

  if (!actions.length) {
    throw new Error("Wallet intent must include at least one action.");
  }

  return {
    actions,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel,
    safetyChecks,
    serverCanExecute: false,
    status: "needs_review",
    summary,
    title,
  };
}

function containsRenaissGeneratedIntent(joined, actions) {
  if (!joined.includes("renaiss")) return false;
  return actions.some((action) => {
    if (action.type !== "dapp_request") return false;
    const actionName = stringOrEmpty(action.params?.action).toLowerCase();
    return (
      actionName === "buy" ||
      actionName.includes("renaiss") ||
      stringOrEmpty(action.dappUrl).toLowerCase().includes("renaiss.xyz") ||
      stringOrEmpty(action.message).toLowerCase().includes("renaiss")
    );
  });
}

function normalizeActions(value, context = "") {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const type = normalizeActionType(item.type);
      if (!type) return null;

      return normalizePancakeSwapAction({
        amount: nullableString(item.amount),
        chain: nullableString(item.chain),
        dappUrl: nullableString(item.dappUrl),
        data: nullableString(item.data),
        message: nullableString(item.message),
        params: normalizeActionParams(item.params),
        to: nullableString(item.to),
        token: nullableString(item.token),
        type,
      }, context);
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizePancakeSwapAction(action, context) {
  const token = inferPancakeOutputToken(action, context);
  const chain = stringOrEmpty(action.chain).toLowerCase();
  const dappUrl = stringOrEmpty(action.dappUrl).toLowerCase();
  const to = stringOrEmpty(action.to).toLowerCase();
  const haystack = `${context} ${action.message ?? ""} ${action.data ?? ""} ${action.dappUrl ?? ""}`.toLowerCase();
  const looksLikeBsc = chain === "bsc" || chain.includes("bnb") || haystack.includes("bnb smart chain");
  const looksLikePancake =
    dappUrl.includes("pancakeswap.finance") ||
    to === PANCAKESWAP_V2_ROUTER.toLowerCase() ||
    haystack.includes("pancakeswap");

  if (
    (action.type === "swap" || action.type === "dapp_request") &&
    looksLikeBsc &&
    (looksLikePancake || action.type === "swap") &&
    action.amount &&
    PANCAKESWAP_OUTPUTS.has(token)
  ) {
    return {
      ...action,
      chain: "BNB Smart Chain",
      dappUrl: PANCAKESWAP_SWAP_URL,
      params: {
        ...(action.params ?? {}),
        inputToken: "BNB",
        outputToken: token,
        protocol: "PancakeSwap V2",
        router: PANCAKESWAP_V2_ROUTER,
        slippageBps: Number(action.params?.slippageBps ?? 100),
      },
      to: PANCAKESWAP_V2_ROUTER,
      token,
      type: "swap",
    };
  }

  return action;
}

function inferPancakeOutputToken(action, context) {
  const values = [
    action.params?.outputToken,
    context,
    action.message,
    action.data,
    action.dappUrl,
    action.token,
  ];
  const haystack = values.map((value) => stringOrEmpty(value).toUpperCase()).join(" ");

  for (const token of PANCAKESWAP_OUTPUTS) {
    if (new RegExp(`(^|[^A-Z0-9])${token}([^A-Z0-9]|$)`).test(haystack)) {
      return token;
    }
  }

  return stringOrEmpty(action.token)
    .toUpperCase()
    .replace(/^BNB\s*->\s*/, "")
    .trim();
}

function normalizeActionType(value) {
  if (value === "sign_message" || value === "transfer" || value === "dapp_request" || value === "swap") {
    return value;
  }
  return null;
}

function normalizeActionParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const output = {};
  for (const [key, rawValue] of Object.entries(value).slice(0, 12)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
    if (!safeKey) continue;
    if (typeof rawValue === "boolean" || typeof rawValue === "number" || rawValue === null) {
      output[safeKey] = rawValue;
    } else if (typeof rawValue === "string") {
      output[safeKey] = rawValue.slice(0, 500);
    }
  }

  return Object.keys(output).length > 0 ? output : null;
}

function normalizeRiskLevel(value) {
  if (value === "info" || value === "warning" || value === "danger" || value === "block") {
    return value;
  }
  return "warning";
}

function sanitizeRenaissOpportunity(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const source = value.sources && typeof value.sources === "object" ? value.sources : {};
  const targetGrade = inferRenaissTargetGrade(value);
  return {
    action: stringOrEmpty(value.action).slice(0, 40),
    actionable: Boolean(value.actionable),
    ask_price_usd: nullableNumber(value.ask_price_usd, 0, 10_000_000),
    best_market: nullableString(value.best_market),
    estimated_diff_pct: nullableNumber(value.estimated_diff_pct, -10_000, 10_000),
    estimated_profit_usd: nullableNumber(value.estimated_profit_usd, -10_000_000, 10_000_000),
    grade: nullableString(value.grade),
    image_url: nullableString(value.image_url),
    is_opportunity: Boolean(value.is_opportunity),
    item_id: stringOrEmpty(value.item_id).slice(0, 120),
    name: stringOrEmpty(value.name).slice(0, 500),
    renaiss_url: nullableString(value.renaiss_url),
    sources: {
      pricecharting: sanitizeRenaissSource(source.pricecharting, targetGrade),
      snkrdunk: sanitizeRenaissSource(source.snkrdunk, targetGrade),
    },
  };
}

function sanitizeRenaissAnalysisResponse(value, fallbackOpportunity) {
  const source = value && typeof value === "object" ? value : {};
  return {
    min_profit_usd: nullableNumber(source.min_profit_usd, 0, 1_000_000),
    result: sanitizeRenaissOpportunity(source.result ?? fallbackOpportunity),
    threshold_percent: nullableNumber(source.threshold_percent, -100, 100),
    time_utc: nullableString(source.time_utc),
    wallet_budget_usd: nullableNumber(source.wallet_budget_usd, 0, 1_000_000),
  };
}

function sanitizeRenaissSource(value, targetGrade = null) {
  if (!value || typeof value !== "object") {
    return {
      avg_price_usd: null,
      diff_pct: null,
      meets_threshold: false,
      records_total: 0,
      sample_count: 0,
      trend: null,
      url: null,
    };
  }

  const hasNormalizedRecords = Array.isArray(value.records_normalized) && value.records_normalized.length > 0;
  const trend = hasNormalizedRecords
    ? buildRenaissSourceTrend(value, targetGrade)
    : sanitizeProvidedRenaissTrend(value.trend, targetGrade) ?? buildRenaissSourceTrend(value, targetGrade);
  return {
    avg_price_usd: nullableNumber(value.avg_price_usd, 0, 10_000_000),
    diff_pct: nullableNumber(value.diff_pct, -10_000, 10_000),
    meets_threshold: Boolean(value.meets_threshold),
    records_total: clampInteger(Number(value.records_total ?? trend.records_total), 0, 1_000_000, 0),
    sample_count: clampInteger(Number(value.sample_count ?? 0), 0, 1_000_000, 0),
    trend,
    url: nullableString(value.url),
  };
}

function sanitizeProvidedRenaissTrend(value, targetGrade = null) {
  if (!value || typeof value !== "object") return null;
  const normalizedCount = clampInteger(Number(value.normalized_count ?? 0), 0, 1_000_000, 0);
  const recentCount = clampInteger(Number(value.recent_count ?? 0), 0, 1_000_000, 0);
  const recordsTotal = clampInteger(Number(value.records_total ?? normalizedCount), 0, 1_000_000, normalizedCount);
  const direction = ["uptrend", "downtrend", "flat", "insufficient"].includes(value.direction)
    ? value.direction
    : "insufficient";
  const compactRecords = Array.isArray(value.compact_records)
    ? value.compact_records
        .map((record) => ({
          date_iso: nullableString(record?.date_iso),
          grade: nullableString(record?.grade),
          price_jpy: nullableNumber(record?.price_jpy, 0, 100_000_000),
          price_usd: nullableNumber(record?.price_usd, 0, 10_000_000),
          title: nullableString(record?.title),
          url: nullableString(record?.url),
        }))
        .filter((record) => record.price_usd !== null || record.price_jpy !== null)
        .slice(-80)
    : [];
  return {
    compact_records: compactRecords,
    direction,
    earliest_date: nullableString(value.earliest_date),
    grade_filter: nullableString(value.grade_filter ?? normalizeRenaissGrade(targetGrade)),
    latest_date: nullableString(value.latest_date),
    latest_price_usd: nullableNumber(value.latest_price_usd, 0, 10_000_000),
    median_price_usd: nullableNumber(value.median_price_usd, 0, 10_000_000),
    normalized_count: normalizedCount,
    recent_avg_usd: nullableNumber(value.recent_avg_usd, 0, 10_000_000),
    recent_count: recentCount,
    recent_end_date: nullableString(value.recent_end_date),
    recent_start_date: nullableString(value.recent_start_date),
    records_total: recordsTotal,
    trend_pct: nullableNumber(value.trend_pct, -10_000, 10_000),
    used_grade_filter: Boolean(value.used_grade_filter),
  };
}

function buildRenaissTrendContext(value) {
  const source = value?.sources && typeof value.sources === "object" ? value.sources : {};
  const targetGrade = inferRenaissTargetGrade(value);
  return {
    pricecharting: buildRenaissSourceTrend(source.pricecharting, targetGrade),
    snkrdunk: buildRenaissSourceTrend(source.snkrdunk, targetGrade),
  };
}

function buildRenaissPriceContext(value) {
  const opportunity = sanitizeRenaissOpportunity(value);
  const sources = opportunity.sources ?? {};
  return {
    ask_price_usd: opportunity.ask_price_usd ?? null,
    best_market: opportunity.best_market ?? null,
    grade: opportunity.grade ?? null,
    sources: {
      pricecharting: buildRenaissPriceSourceContext(sources.pricecharting),
      snkrdunk: buildRenaissPriceSourceContext(sources.snkrdunk),
    },
  };
}

function buildRenaissPriceSourceContext(source) {
  return {
    diff_pct: source?.diff_pct ?? null,
    latest_date: source?.trend?.latest_date ?? null,
    latest_price_usd: source?.trend?.latest_price_usd ?? null,
    recent_avg_usd: source?.trend?.recent_avg_usd ?? null,
    recent_count: source?.trend?.recent_count ?? 0,
    recent_end_date: source?.trend?.recent_end_date ?? null,
    recent_start_date: source?.trend?.recent_start_date ?? null,
    sample_count: source?.sample_count ?? 0,
    summary_avg_price_usd: source?.avg_price_usd ?? null,
    trend_direction: source?.trend?.direction ?? "insufficient",
    trend_pct: source?.trend?.trend_pct ?? null,
    used_grade_filter: source?.trend?.used_grade_filter ?? false,
  };
}

function buildRenaissSourceTrend(source, targetGrade = null) {
  const records = normalizeRenaissPriceRecords(source?.records_normalized);
  const targetGradeKey = normalizeRenaissGrade(targetGrade);
  const gradeMatchedRecords = targetGradeKey
    ? records.filter((record) => normalizeRenaissGrade(record.grade) === targetGradeKey)
    : [];
  const trendRecords = gradeMatchedRecords.some((record) => record.price_usd !== null)
    ? gradeMatchedRecords
    : records;
  const usedGradeFilter = trendRecords === gradeMatchedRecords && gradeMatchedRecords.length > 0;
  const pricedRecords = trendRecords
    .filter((record) => record.price_usd !== null)
    .sort((left, right) => {
      const leftTime = dateTimeOrZero(left.date_iso);
      const rightTime = dateTimeOrZero(right.date_iso);
      return leftTime === rightTime ? 0 : leftTime - rightTime;
    });
  const prices = pricedRecords.map((record) => record.price_usd).filter((price) => price !== null);
  const recordsTotal = clampInteger(Number(source?.records_total ?? records.length), 0, 1_000_000, records.length);

  if (prices.length < 3) {
    return {
      compact_records: pricedRecords.slice(-20),
      direction: "insufficient",
      earliest_date: pricedRecords[0]?.date_iso ?? null,
      grade_filter: usedGradeFilter ? targetGradeKey : null,
      latest_date: pricedRecords.at(-1)?.date_iso ?? null,
      latest_price_usd: pricedRecords.at(-1)?.price_usd ?? null,
      median_price_usd: median(prices),
      normalized_count: pricedRecords.length,
      recent_avg_usd: average(prices),
      recent_count: pricedRecords.length,
      recent_end_date: pricedRecords.at(-1)?.date_iso ?? null,
      recent_start_date: pricedRecords[0]?.date_iso ?? null,
      records_total: recordsTotal,
      trend_pct: null,
      used_grade_filter: usedGradeFilter,
    };
  }

  const windowSize = Math.min(12, Math.max(3, Math.ceil(prices.length * 0.2)));
  const recentPrices = prices.slice(-windowSize);
  const recentRecords = pricedRecords.slice(-windowSize);
  const previousPrices = prices.slice(Math.max(0, prices.length - windowSize * 2), prices.length - windowSize);
  const recentAvg = average(recentPrices);
  const previousAvg = previousPrices.length > 0 ? average(previousPrices) : prices[0];
  const trendPct = percentChange(previousAvg, recentAvg);
  const direction =
    trendPct === null || Math.abs(trendPct) < 5
      ? "flat"
      : trendPct > 0
        ? "uptrend"
        : "downtrend";

  return {
    compact_records: pricedRecords.slice(-80),
    direction,
    earliest_date: pricedRecords[0]?.date_iso ?? null,
    grade_filter: usedGradeFilter ? targetGradeKey : null,
    latest_date: pricedRecords.at(-1)?.date_iso ?? null,
    latest_price_usd: pricedRecords.at(-1)?.price_usd ?? null,
    median_price_usd: median(prices),
    normalized_count: pricedRecords.length,
    recent_avg_usd: recentAvg,
    recent_count: recentRecords.length,
    recent_end_date: recentRecords.at(-1)?.date_iso ?? null,
    recent_start_date: recentRecords[0]?.date_iso ?? null,
    records_total: recordsTotal,
    trend_pct: trendPct,
    used_grade_filter: usedGradeFilter,
  };
}

function inferRenaissTargetGrade(value) {
  const explicitGrade = nullableString(value?.grade);
  if (explicitGrade) return explicitGrade;
  const name = stringOrEmpty(value?.name);
  const psa = name.match(/PSA\s*([0-9]{1,2})/i);
  if (psa) return `PSA ${psa[1]}`;
  const bgs = name.match(/BGS\s*([0-9](?:\.[0-9])?)/i);
  if (bgs) return `BGS ${bgs[1]}`;
  return null;
}

function normalizeRenaissGrade(value) {
  const raw = stringOrEmpty(value).toUpperCase();
  const psa = raw.match(/PSA\s*([0-9]{1,2})/);
  if (psa) return `PSA ${psa[1]}`;
  const bgs = raw.match(/BGS\s*([0-9](?:\.[0-9])?)/);
  if (bgs) return `BGS ${bgs[1]}`;
  if (raw.includes("UNGRADED")) return "UNGRADED";
  return raw.replace(/[^A-Z0-9.]+/g, " ").trim();
}

function normalizeRenaissPriceRecords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((record) => {
      if (!record || typeof record !== "object") return null;
      const priceUsd = nullableNumber(record.price_usd, 0, 10_000_000);
      return {
        date_iso: nullableString(record.date_iso),
        grade: nullableString(record.grade),
        price_jpy: nullableNumber(record.price_jpy, 0, 2_000_000_000),
        price_usd: priceUsd,
        title: nullableString(record.title ?? record.name),
        url: nullableString(record.url),
      };
    })
    .filter(Boolean)
    .slice(0, 2_000);
}

function dateTimeOrZero(value) {
  const time = Date.parse(stringOrEmpty(value));
  return Number.isFinite(time) ? time : 0;
}

function average(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function median(values) {
  const numbers = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle];
}

function percentChange(base, next) {
  if (base === null || next === null || !Number.isFinite(base) || !Number.isFinite(next) || base <= 0) {
    return null;
  }
  return ((next - base) / base) * 100;
}

function buildDeterministicRenaissReviewFacts(item) {
  const opportunity = sanitizeRenaissOpportunity(item);
  const source = getBestRenaissSource(opportunity);
  const ask = opportunity.ask_price_usd;
  const summaryAvg = source?.avg_price_usd ?? null;
  const trend = source?.trend ?? null;
  const estimatedProfit = Number.isFinite(summaryAvg) && Number.isFinite(ask)
    ? summaryAvg - ask
    : opportunity.estimated_profit_usd;
  const estimatedDiffPct = Number.isFinite(summaryAvg) && summaryAvg > 0 && Number.isFinite(estimatedProfit)
    ? (estimatedProfit / summaryAvg) * 100
    : opportunity.estimated_diff_pct;
  const sourceLabel = source?.label ?? opportunity.best_market ?? "參考市場";
  const priceSummary = Number.isFinite(ask) && Number.isFinite(summaryAvg)
    ? [
        `掛牌 $${formatServerMoney(ask)}`,
        `${sourceLabel} 摘要參考均價 $${formatServerMoney(summaryAvg)}`,
        Number.isFinite(estimatedProfit)
          ? `預估損益 ${estimatedProfit >= 0 ? "+" : "-"}$${formatServerMoney(Math.abs(estimatedProfit))}`
          : null,
        Number.isFinite(estimatedDiffPct)
          ? `價差 ${estimatedDiffPct.toFixed(1)}%`
          : null,
      ].filter(Boolean).join(" / ")
    : "價格基準不足，不能只靠模型判斷。";
  const trendSummary = formatDeterministicTrendSummary(sourceLabel, trend);
  const reasons = [];
  if (Number.isFinite(ask) && Number.isFinite(summaryAvg) && Number.isFinite(estimatedProfit)) {
    reasons.push(
      estimatedProfit >= 0
        ? `掛牌低於${sourceLabel}摘要參考均價，預估 +$${formatServerMoney(estimatedProfit)}。`
        : `掛牌高於${sourceLabel}摘要參考均價，預估 -$${formatServerMoney(Math.abs(estimatedProfit))}。`,
    );
  }
  if (Number.isFinite(trend?.recent_avg_usd)) {
    reasons.push(
      `近期成交均價 $${formatServerMoney(trend.recent_avg_usd)}（${formatServerDateRange(trend.recent_start_date, trend.recent_end_date)}）。`,
    );
  }
  if (Number.isFinite(trend?.latest_price_usd)) {
    reasons.push(`最新成交 $${formatServerMoney(trend.latest_price_usd)}（${formatServerDate(trend.latest_date) || "日期不足"}）。`);
  }

  const riskFlags = [];
  const priced = Array.isArray(trend?.compact_records)
    ? trend.compact_records.map((record) => Number(record.price_usd)).filter(Number.isFinite)
    : [];
  if (priced.length >= 2) {
    const min = Math.min(...priced);
    const max = Math.max(...priced);
    if (max > min * 3) {
      riskFlags.push(`成交區間很寬 $${formatServerMoney(min)}-$${formatServerMoney(max)}，需核對異常成交。`);
    }
  }
  const missingOtherSource = source?.key === "pricecharting"
    ? !Number.isFinite(opportunity.sources?.snkrdunk?.avg_price_usd)
    : !Number.isFinite(opportunity.sources?.pricecharting?.avg_price_usd);
  if (missingOtherSource) {
    riskFlags.push(`主要依賴${sourceLabel}，另一來源缺少可用摘要均價。`);
  }

  const verdict = deriveDeterministicRenaissVerdict(opportunity, source, estimatedProfit, estimatedDiffPct);
  return {
    minConfidence: verdict.minConfidence,
    priceSummary,
    reasons,
    riskFlags,
    trendSummary,
    verdict: verdict.value,
  };
}

function formatDeterministicTrendSummary(sourceLabel, trend) {
  if (!trend || !Number.isFinite(trend.recent_avg_usd)) {
    return `${sourceLabel} 近期成交資料不足；只能先用摘要參考均價做初篩。`;
  }
  const parts = [
    `${sourceLabel} 近期成交均價 $${formatServerMoney(trend.recent_avg_usd)}（${formatServerDateRange(trend.recent_start_date, trend.recent_end_date)}，${trend.recent_count ?? 0} 筆）`,
  ];
  if (Number.isFinite(trend.latest_price_usd)) {
    parts.push(`最新成交 $${formatServerMoney(trend.latest_price_usd)}（${formatServerDate(trend.latest_date) || "日期不足"}）`);
  }
  if (Number.isFinite(trend.trend_pct)) {
    const direction = trend.direction === "uptrend" ? "走強" : trend.direction === "downtrend" ? "走弱" : "持平";
    parts.push(`${direction} ${trend.trend_pct >= 0 ? "+" : ""}${trend.trend_pct.toFixed(1)}%`);
  }
  return `${parts.join(" / ")}。`;
}

function deriveDeterministicRenaissVerdict(opportunity, source, estimatedProfit, estimatedDiffPct) {
  const direction = source?.trend?.direction;
  const positive = Number.isFinite(estimatedProfit)
    ? estimatedProfit > 0
    : Number.isFinite(estimatedDiffPct) && estimatedDiffPct > 0;
  if (positive && direction === "downtrend") {
    return { minConfidence: 50, value: "watch" };
  }
  if (positive && (direction === "uptrend" || direction === "flat")) {
    return { minConfidence: 72, value: "buy_candidate" };
  }
  if (positive && opportunity.action === "BUY_CANDIDATE") {
    return { minConfidence: 62, value: "buy_candidate" };
  }
  if (!positive) {
    return { minConfidence: 45, value: "avoid" };
  }
  return { minConfidence: 50, value: "watch" };
}

function formatServerDateRange(start, end) {
  const startText = formatServerDate(start);
  const endText = formatServerDate(end);
  if (startText && endText) return `${startText}-${endText}`;
  return startText || endText || "日期不足";
}

function formatServerDate(value) {
  const date = stringOrEmpty(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replaceAll("-", "/") : "";
}

function mergeReviewList(primary, secondary, limit) {
  const values = [...(primary ?? []), ...(secondary ?? [])]
    .map((item) => stringOrEmpty(item).trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, limit).map((item) => item.slice(0, 220));
}

function filterUnsafeGeneratedPriceClaims(values) {
  return normalizeStringList(values, 5).filter((item) => !/[$％%]|均價|均价|價差|价差|低於|低于|高於|高于|預估|预估/.test(item));
}

function normalizeRenaissAiReview(value, model, deterministicFacts = null) {
  if (!value || typeof value !== "object") {
    throw new Error("MiniMax RENAISS review JSON must be an object.");
  }

  const generatedReasons = filterUnsafeGeneratedPriceClaims(value.reasons);
  const generatedRisks = filterUnsafeGeneratedPriceClaims(value.riskFlags);
  const confidence = clampInteger(Number(value.confidence ?? 0), 0, 100, 0);
  return {
    cardNameSignals: normalizeStringList(value.cardNameSignals, 5),
    confidence: deterministicFacts?.minConfidence
      ? Math.max(confidence, deterministicFacts.minConfidence)
      : confidence,
    headline: stringOrEmpty(value.headline).trim().slice(0, 220),
    marketDataUsed: normalizeStringList(value.marketDataUsed, 5),
    model,
    nextChecks: normalizeStringList(value.nextChecks, 5),
    priceSummary: stringOrEmpty(deterministicFacts?.priceSummary ?? value.priceSummary).trim().slice(0, 320),
    reasons: mergeReviewList(deterministicFacts?.reasons, generatedReasons, 5),
    riskFlags: mergeReviewList(deterministicFacts?.riskFlags, generatedRisks, 5),
    trendSummary: stringOrEmpty(deterministicFacts?.trendSummary ?? value.trendSummary).trim().slice(0, 360),
    verdict: deterministicFacts?.verdict ?? normalizeRenaissVerdict(value.verdict),
  };
}

function normalizeStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringOrEmpty(item).trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, 220));
}

function normalizeRenaissVerdict(value) {
  if (value === "buy_candidate" || value === "watch" || value === "avoid") {
    return value;
  }
  return "watch";
}

function normalizeSafetyChecks(value) {
  if (!Array.isArray(value)) {
    return [
      "Server produced intent only.",
      "User confirmation is required.",
      "Token Core local signing is required.",
    ];
  }

  const checks = value
    .map((item) => stringOrEmpty(item).trim())
    .filter(Boolean)
    .slice(0, 8);

  return [
    ...checks,
    "Server produced intent only.",
    "Token Core local signing is required.",
  ];
}

function containsForbiddenSecretRequest(value) {
  return [
    "private key",
    "seed phrase",
    "mnemonic",
    "cookie",
    "session token",
    "privy token",
    "api key",
  ].some((word) => value.includes(word));
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function nullableString(value) {
  const text = stringOrEmpty(value).trim();
  return text.length > 0 ? text.slice(0, 2000) : null;
}

function nullableFieldString(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return nullableString(value);
}

function normalizeHttpUrl(value) {
  const text = nullableString(value);
  if (!text || !/^https?:\/\//i.test(text)) return null;
  return text;
}

function nullableNumber(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(number, min), max);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function clampInteger(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(Math.max(value, min), max));
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/g, "");
}

function isAuthorizedRenaissWebhook(request) {
  const token = stringOrEmpty(process.env.RENAISS_WEBHOOK_TOKEN).trim();
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value.replace(/^["']|["']$/g, "");
  }
}
