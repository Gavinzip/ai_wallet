import { getAgentApiBaseUrl, readJsonResponse } from "@/services/api-base-url";
import type {
  RenaissAnalyzeResponse,
  RenaissAiReviewResponse,
  RenaissHeadlessSessionResponse,
  RenaissLatestResponse,
  RenaissOpportunity,
  RenaissScanRequest,
  RenaissScanResponse,
  RenaissWebhookInboxResponse,
} from "@/types/renaiss-monitor";

export async function fetchRenaissLatestListings(limit = 5): Promise<RenaissLatestResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/listings/latest?limit=${limit}`);
  return readJsonResponse<RenaissLatestResponse>(response, "RENAISS monitor request failed.");
}

export async function scanRenaissOpportunities(
  input: RenaissScanRequest = {},
): Promise<RenaissScanResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/opportunities/scan`, {
    body: JSON.stringify({
      cache_ttl_seconds: input.cache_ttl_seconds ?? null,
      force_refresh: input.force_refresh ?? false,
      include_full_records: input.include_full_records ?? false,
      keep_limit: input.keep_limit ?? input.limit ?? 5,
      limit: input.limit ?? input.keep_limit ?? 5,
      min_profit_usd: input.min_profit_usd ?? 0,
      only_actionable: input.only_actionable ?? false,
      reference_id: input.reference_id ?? null,
      scan_limit: input.scan_limit ?? 30,
      threshold_percent: input.threshold_percent ?? null,
      use_cache: input.use_cache ?? true,
      wallet_budget_usd: input.wallet_budget_usd ?? null,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return readJsonResponse<RenaissScanResponse>(response, "RENAISS monitor request failed.");
}

export async function fetchLatestRenaissOpportunities(): Promise<RenaissScanResponse | null> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/opportunities/latest`);
  if (response.status === 404) return null;
  return readJsonResponse<RenaissScanResponse>(response, "RENAISS latest opportunities request failed.");
}

export async function fetchCachedRenaissOpportunities(): Promise<RenaissScanResponse | null> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/opportunities/cache`);
  if (response.status === 404) return null;
  return readJsonResponse<RenaissScanResponse>(response, "RENAISS cache request failed.");
}

export async function analyzeRenaissItem(input: {
  itemId: string;
  minProfitUsd?: number;
  thresholdPercent?: number | null;
  walletBudgetUsd?: number | null;
}): Promise<RenaissAnalyzeResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/analyze/item-id`, {
    body: JSON.stringify({
      item_id: input.itemId,
      include_full_records: true,
      min_profit_usd: input.minProfitUsd ?? 0,
      threshold_percent: input.thresholdPercent ?? null,
      wallet_budget_usd: input.walletBudgetUsd ?? null,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return readJsonResponse<RenaissAnalyzeResponse>(response, "RENAISS monitor request failed.");
}

export async function fetchRenaissWebhookAlerts(): Promise<RenaissWebhookInboxResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/alerts`);
  return readJsonResponse<RenaissWebhookInboxResponse>(response, "RENAISS monitor request failed.");
}

export async function reviewRenaissOpportunity(input: {
  analysis?: RenaissAnalyzeResponse | null;
  opportunity: RenaissOpportunity;
}): Promise<RenaissAiReviewResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/ai-review`, {
    body: JSON.stringify({
      analysis: input.analysis,
      opportunity: input.opportunity,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return readJsonResponse<RenaissAiReviewResponse>(response, "RENAISS monitor request failed.");
}

export async function fetchRenaissHeadlessSession(): Promise<RenaissHeadlessSessionResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/session/current`);
  return readJsonResponse<RenaissHeadlessSessionResponse>(response, "RENAISS monitor request failed.");
}

export async function prepareRenaissHeadlessSession(): Promise<RenaissHeadlessSessionResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("RENAISS monitor API")}/api/renaiss/session/headless-login`, {
    method: "POST",
  });
  return readJsonResponse<RenaissHeadlessSessionResponse>(response, "RENAISS monitor request failed.");
}
