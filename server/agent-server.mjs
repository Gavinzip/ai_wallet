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

import { createRenaissHeadlessSession } from "./renaiss-headless-auth.mjs";

loadDotEnv();

const port = Number(process.env.PORT ?? process.env.AGENT_SERVER_PORT ?? 8787);
const projectRoot = process.cwd();
const STATIC_DIST_DIR = path.resolve(process.env.WEB_DIST_DIR ?? path.join(projectRoot, "dist"));
const PANCAKESWAP_SWAP_URL = "https://pancakeswap.finance/swap";
const PANCAKESWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const PANCAKESWAP_OUTPUTS = new Set(["USDC", "USDT", "CAKE"]);
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
const RENAISS_SCAN_CACHE_PATH = process.env.RENAISS_SCAN_CACHE_PATH ??
  path.join(process.cwd(), ".tmp", "renaiss-scan-cache.json");
const WEB_WALLET_BACKUP_DIR = process.env.WEB_WALLET_BACKUP_DIR ??
  path.join(process.cwd(), ".tmp", "web-wallet-backups");
const renaissWebhookAlerts = [];
let activeRenaissSession = null;

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

  if (request.method === "GET" && requestUrl.pathname === "/api/renaiss/session/current") {
    sendJson(response, 200, sanitizeRenaissSession(activeRenaissSession));
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

  if (request.method === "POST" && requestUrl.pathname === "/api/ethereum/rpc") {
    await handleEthereumRpcProxy(request, response);
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
    if (!messages.length) {
      sendJson(response, 400, {
        error: "At least one user message is required.",
      });
      return;
    }

    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
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
    if (hasPufferSkill(enabledSkills) && isPufferRequest(lastUserMessage)) {
      await handlePufferChat(lastUserMessage, response);
      return;
    }
    if (hasRenaissSkill(enabledSkills) && isRenaissListingRequest(lastUserMessage)) {
      await handleRenaissListingChat(lastUserMessage, response);
      return;
    }
    if (hasRenaissSkill(enabledSkills) && isRenaissPurchaseRequest(lastUserMessage)) {
      await handleRenaissPurchaseChat(messages, response);
      return;
    }
    if (
      hasRenaissSkill(enabledSkills)
      && isGenericPurchaseRequest(lastUserMessage)
      && findLatestRenaissPurchaseContext(messages)
    ) {
      await handleRenaissPurchaseChat(messages, response);
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
    await proxyRenaissJson(response, "/v1/analyze/item-id", {
      body: payload,
      method: "POST",
      timeoutMs: RENAISS_PROXY_TIMEOUT_MS,
    });
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
    const scanPayload = compactRenaissRequestPayload({
      cache_ttl_seconds: 60,
      force_refresh: false,
      include_full_records: false,
      keep_limit: 5,
      limit: 5,
      min_profit_usd: 0,
      notify_wallet: false,
      only_actionable: false,
      reference_id: `agent-chat-${Date.now()}`,
      scan_limit: 30,
      threshold_percent: null,
      use_cache: true,
      wallet_budget_usd: null,
    });
    let scanCacheNotice = null;
    let analysisNotice = null;
    let scan = await readRenaissScanCache();
    if (scan) {
      scanCacheNotice = `先用背景整理好的推薦快取（${formatServerTime(scan.cache?.cachedAt)}）。`;
    } else {
      try {
        scan = await fetchRemoteRenaissLatestOpportunities();
        scanCacheNotice = `使用 RENAISS API 最新快取（${formatServerTime(scan.cache?.cachedAt ?? scan.time_utc)}）。`;
      } catch (scanError) {
        try {
          scan = await fetchRenaissJson("/v1/opportunities/scan", {
            body: scanPayload,
            method: "POST",
            timeoutMs: 45_000,
          });
        } catch (refreshError) {
          const cached = await readRenaissScanCache();
          if (!cached?.opportunities?.length) throw refreshError;
          scan = cached;
          scanCacheNotice = `遠端掃描暫時失敗，先用最近一次成功快取（原因：${formatErrorMessage(refreshError)}）。`;
        }
      }
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

async function handleRenaissListingChat(userMessage, response) {
  const listing = extractRenaissListingDraft(userMessage);
  if (!listing.cardUrl && !listing.tokenId) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以，我可以先幫你準備 RENAISS 掛單審核。",
        "請貼 RENAISS 卡片連結或 tokenId，並告訴我掛單價格，例如：",
        "「幫我在 RENAISS 掛單 https://www.renaiss.xyz/... 價格 120 USDT」",
      ].join("\n"),
      model: "renaiss-order-review",
    });
    return;
  }

  if (listing.askPriceUsdt === null) {
    sendJson(response, 200, {
      intent: createRenaissListingReviewIntent(listing),
      message: [
        "我已經抓到你要掛單的 RENAISS 卡片，但還缺掛單價格。",
        "請補一句價格，例如：「掛 120 USDT」。",
        "我會先做掛單審核，不會替你送出掛單；真正送單要等 RENAISS 回傳官方 list/order typed-data 後，在本機 Token Core 確認簽名。",
      ].join("\n"),
      model: "renaiss-order-review",
    });
    return;
  }

  sendJson(response, 200, {
    intent: createRenaissListingReviewIntent(listing),
    message: [
      "我已經準備好 RENAISS 掛單審核。",
      listing.cardUrl ? `卡片連結：${listing.cardUrl}` : `tokenId：${listing.tokenId}`,
      `掛單價格：${listing.askPriceUsdt} USDT`,
      "目前這是 review intent：我會幫你檢查卡片、價格、收款與簽名內容；真正掛單仍需要 RENAISS 官方 payload，最後由你在本機 Token Core/RENAISS 確認。",
    ].join("\n"),
    model: "renaiss-order-review",
  });
}

async function handleRenaissPurchaseChat(messages, response) {
  const context = findLatestRenaissPurchaseContext(messages);

  if (!context) {
    sendJson(response, 200, {
      intent: null,
      message: [
        "可以，但我需要先知道是哪一張 RENAISS 卡。",
        "請先點一張推薦卡做分析，或直接貼 RENAISS 商品頁連結和價格。",
        "拿到 item_id、商品頁、ask price 後，我會建立購買審核 intent；不會讓模型自己猜卡片或價格。",
      ].join("\n"),
      model: "renaiss-purchase-review",
    });
    return;
  }

  sendJson(response, 200, {
    intent: createRenaissPurchaseReviewIntent(context),
    message: [
      "可以，我已經幫你準備 RENAISS 購買審核。",
      `卡片：${context.name}`,
      `目前 RENAISS ask：$${formatServerMoney(context.askPriceUsd)} USDT`,
      context.estimatedProfitUsd === null
        ? "預估損益：資料不足，需進一步核對來源。"
        : `預估損益：${context.estimatedProfitUsd >= 0 ? "+" : "-"}$${formatServerMoney(Math.abs(context.estimatedProfitUsd))}`,
      "下一步不是直接付款，而是先核對商品頁、價格、交易 payload、USDT/BNB 餘額和 Permit2/簽名內容。",
      "等 RENAISS buyNow 官方 payload 接上後，最後仍要你在本機 Token Core 確認簽名。",
    ].join("\n"),
    model: "renaiss-purchase-review",
  });
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
            opportunity,
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

  return normalizeRenaissAiReview(JSON.parse(extractFirstJsonObject(rawContent)), model);
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
    sendJson(response, 200, sanitizeRenaissSession(activeRenaissSession));
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "RENAISS headless login failed.",
    });
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

async function handleEthereumRpcProxy(request, response) {
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

    const upstream = await fetch(getServerEthereumRpcUrl(chainId), {
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
      payload = { error: { message: text || "Ethereum RPC upstream returned non-JSON response." } };
    }
    if (!upstream.ok) {
      sendJson(response, upstream.status, {
        error: payload?.error?.message ?? payload?.message ?? "Ethereum RPC upstream request failed.",
      });
      return;
    }
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Ethereum RPC proxy failed.",
    });
  }
}

function getServerEthereumRpcUrl(chainId) {
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

function createRenaissListingReviewIntent(listing) {
  const hasPrice = listing.askPriceUsdt !== null;
  const subject = listing.cardUrl || (listing.tokenId ? `tokenId ${listing.tokenId}` : "RENAISS card");
  return {
    actions: [
      {
        amount: hasPrice ? String(listing.askPriceUsdt) : null,
        chain: "BNB Smart Chain",
        dappUrl: listing.cardUrl ?? "https://www.renaiss.xyz/marketplace",
        data: null,
        message: null,
        params: {
          action: "renaiss_list_order_review",
          askPriceUsdt: hasPrice ? String(listing.askPriceUsdt) : null,
          cardUrl: listing.cardUrl,
          reviewOnly: true,
          tokenId: listing.tokenId,
        },
        to: null,
        token: "USDT",
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: `renaiss-listing-${Date.now()}`,
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: hasPrice ? "warning" : "info",
    safetyChecks: [
      "Verify the RENAISS card page and tokenId before listing.",
      "Verify ask price, currency, proceeds address, expiry, and fees before signing.",
      "The official RENAISS list/order typed-data payload is not connected in this app yet.",
      "Do not sign until RENAISS returns the exact order payload and Token Core decodes it on device.",
      "Server and AI cannot list the card or sign the order.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: hasPrice
      ? `Review listing ${subject} at ${listing.askPriceUsdt} USDT on RENAISS.`
      : `Review listing setup for ${subject}; ask price is still missing.`,
    title: "RENAISS Listing Review",
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
    "For Puffer staking, do not invent APY, balances, rates, calldata, gas, or nonce. If live prepared transaction data was not supplied by the app, explain that the Puffer mini app must prepare the review first and return intent:null.",
    "For Bitrefill commerce, do not invent products, prices, payment addresses, invoices, redemption codes, or order status. If Bitrefill API data was not supplied by the app, explain that Bitrefill credentials/search are required and return intent:null.",
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
  response.end(JSON.stringify(payload));
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
    "Cross-Origin-Opener-Policy": "same-origin",
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
  if (!/renaiss|renaiss\.xyz|卡牌|卡片|tokenid|token id/.test(text)) return false;
  return /掛單|挂单|上架|出售|賣|卖|list\b|listing\b|sell\b|ask\s*price|askprice|開價|开价/.test(text);
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
        bestSource ? `參考 ${bestSource.label} 均價 $${formatServerMoney(bestSource.avg_price_usd)}` : "參考均價不足",
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
      return `${label} avg $${formatServerMoney(source.avg_price_usd)} / ${diff}${samples ? ` / ${samples} 筆` : ""}`;
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
  const upstream = await fetch(getServerEthereumRpcUrl(chainId), {
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
      pricecharting: sanitizeRenaissSource(source.pricecharting),
      snkrdunk: sanitizeRenaissSource(source.snkrdunk),
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

function sanitizeRenaissSource(value) {
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

  const trend = buildRenaissSourceTrend(value);
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

function buildRenaissTrendContext(value) {
  const source = value?.sources && typeof value.sources === "object" ? value.sources : {};
  return {
    pricecharting: buildRenaissSourceTrend(source.pricecharting),
    snkrdunk: buildRenaissSourceTrend(source.snkrdunk),
  };
}

function buildRenaissSourceTrend(source) {
  const records = normalizeRenaissPriceRecords(source?.records_normalized);
  const pricedRecords = records
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
      latest_date: pricedRecords.at(-1)?.date_iso ?? null,
      latest_price_usd: pricedRecords.at(-1)?.price_usd ?? null,
      median_price_usd: median(prices),
      normalized_count: pricedRecords.length,
      recent_avg_usd: average(prices),
      records_total: recordsTotal,
      trend_pct: null,
    };
  }

  const windowSize = Math.min(12, Math.max(3, Math.ceil(prices.length * 0.2)));
  const recentPrices = prices.slice(-windowSize);
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
    latest_date: pricedRecords.at(-1)?.date_iso ?? null,
    latest_price_usd: pricedRecords.at(-1)?.price_usd ?? null,
    median_price_usd: median(prices),
    normalized_count: pricedRecords.length,
    recent_avg_usd: recentAvg,
    records_total: recordsTotal,
    trend_pct: trendPct,
  };
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

function normalizeRenaissAiReview(value, model) {
  if (!value || typeof value !== "object") {
    throw new Error("MiniMax RENAISS review JSON must be an object.");
  }

  return {
    cardNameSignals: normalizeStringList(value.cardNameSignals, 5),
    confidence: clampInteger(Number(value.confidence ?? 0), 0, 100, 0),
    headline: stringOrEmpty(value.headline).trim().slice(0, 220),
    marketDataUsed: normalizeStringList(value.marketDataUsed, 5),
    model,
    nextChecks: normalizeStringList(value.nextChecks, 5),
    priceSummary: stringOrEmpty(value.priceSummary).trim().slice(0, 320),
    reasons: normalizeStringList(value.reasons, 5),
    riskFlags: normalizeStringList(value.riskFlags, 5),
    trendSummary: stringOrEmpty(value.trendSummary).trim().slice(0, 360),
    verdict: normalizeRenaissVerdict(value.verdict),
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
