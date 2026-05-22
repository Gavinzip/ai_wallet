export type RenaissListingAttribute = {
  trait: string;
  value: string;
};

export type RenaissListing = {
  id: string;
  item_id: string;
  name: string;
  ask_price: number;
  fmv?: number | null;
  grade?: string | null;
  attributes?: RenaissListingAttribute[];
  image_url?: string | null;
  renaiss_url?: string | null;
};

export type RenaissSourceSignal = {
  avg_price_usd: number | null;
  sample_count: number;
  diff_pct: number | null;
  url: string | null;
  meets_threshold: boolean;
  records_total?: number;
  records_raw?: unknown[];
  records_normalized?: RenaissPriceRecord[];
  trend?: RenaissPriceTrend | null;
};

export type RenaissPriceRecord = {
  date_iso?: string | null;
  grade?: string | null;
  price_jpy?: number | null;
  price_usd?: number | null;
  title?: string | null;
  url?: string | null;
  [key: string]: unknown;
};

export type RenaissPriceTrend = {
  compact_records?: RenaissPriceRecord[];
  direction: "uptrend" | "downtrend" | "flat" | "insufficient";
  earliest_date: string | null;
  latest_date: string | null;
  latest_price_usd: number | null;
  median_price_usd: number | null;
  normalized_count: number;
  recent_avg_usd: number | null;
  records_total: number;
  trend_pct: number | null;
};

export type RenaissOpportunity = {
  item_id: string;
  name: string;
  grade?: string | null;
  ask_price_usd: number;
  renaiss_url?: string | null;
  image_url?: string | null;
  sources: {
    pricecharting: RenaissSourceSignal;
    snkrdunk: RenaissSourceSignal;
  };
  best_market: string | null;
  estimated_profit_usd: number | null;
  estimated_diff_pct: number | null;
  is_opportunity: boolean;
  actionable: boolean;
  action: "BUY_CANDIDATE" | "WATCH";
};

export type RenaissLatestResponse = {
  time_utc: string;
  count: number;
  items: RenaissListing[];
};

export type RenaissScanRequest = {
  cache_ttl_seconds?: number | null;
  force_refresh?: boolean;
  include_full_records?: boolean;
  keep_limit?: number;
  limit?: number;
  threshold_percent?: number | null;
  min_profit_usd?: number;
  wallet_budget_usd?: number | null;
  only_actionable?: boolean;
  reference_id?: string | null;
  scan_limit?: number;
  use_cache?: boolean;
};

export type RenaissScanResponse = {
  cache?: {
    cachedAt: string | null;
    hit?: boolean;
    reason?: string | null;
    status: "cached" | "live" | "stale";
  } | null;
  time_utc: string;
  reference_id: string | null;
  threshold_percent: number;
  min_profit_usd: number;
  wallet_budget_usd: number | null;
  count: number;
  opportunities: RenaissOpportunity[];
  wallet_notify: {
    sent: boolean;
    reason?: string;
    status_code?: number;
  };
};

export type RenaissAnalyzeResponse = {
  time_utc: string;
  threshold_percent: number;
  min_profit_usd: number;
  wallet_budget_usd: number | null;
  result: RenaissOpportunity;
};

export type RenaissAiReviewResponse = {
  cardNameSignals: string[];
  confidence: number;
  headline: string;
  marketDataUsed: string[];
  model: string;
  nextChecks: string[];
  priceSummary: string;
  reasons: string[];
  riskFlags: string[];
  trendSummary: string;
  verdict: "buy_candidate" | "watch" | "avoid";
};

export type RenaissWebhookInboxResponse = {
  count: number;
  alerts: unknown[];
};

export type RenaissHeadlessSessionResponse = {
  authenticated: boolean;
  cookieNames: string[];
  createdAt?: string;
  id?: string;
  origin?: string;
  ownerWalletAddress?: string | null;
  sessionReady: boolean;
  signedWalletAddress?: string | null;
  signedWalletLinked?: boolean;
  userId?: string | null;
  walletAddress?: string | null;
  walletSource?: string | null;
};
