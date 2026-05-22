import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";

import {
  analyzeRenaissItem,
  fetchCachedRenaissOpportunities,
  fetchLatestRenaissOpportunities,
  reviewRenaissOpportunity,
} from "@/services/renaiss/renaiss-monitor-api";
import type {
  RenaissAiReviewResponse,
  RenaissAnalyzeResponse,
  RenaissOpportunity,
  RenaissScanResponse,
} from "@/types/renaiss-monitor";

type RenaissAnalysisPayload = {
  analysis: RenaissAnalyzeResponse;
  item: RenaissOpportunity;
  review: RenaissAiReviewResponse;
};

type RenaissRefreshOptions = {
  force?: boolean;
  reason?: string;
};

type RenaissRecommendationsContextValue = {
  analyzeOpportunity: (item: RenaissOpportunity) => Promise<RenaissAnalysisPayload>;
  error: string | null;
  isReviewing: boolean;
  isScanning: boolean;
  recommendations: RenaissOpportunity[];
  refresh: (options?: RenaissRefreshOptions) => Promise<RenaissScanResponse>;
  reviewingItemId: string | null;
  scan: RenaissScanResponse | null;
  usingCachedScan: boolean;
};

const RenaissRecommendationsContext = createContext<RenaissRecommendationsContextValue | null>(null);
const BACKGROUND_SCAN_INTERVAL_MS = 60_000;
const MIN_NON_FORCED_REFRESH_INTERVAL_MS = 20_000;

export function RenaissRecommendationsProvider({ children }: PropsWithChildren) {
  const scanInFlightRef = useRef<Promise<RenaissScanResponse> | null>(null);
  const lastRefreshStartedAtRef = useRef(0);
  const scanRef = useRef<RenaissScanResponse | null>(null);
  const [scan, setScan] = useState<RenaissScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewingItemId, setReviewingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options: RenaissRefreshOptions = {}) => {
    if (scanInFlightRef.current) return scanInFlightRef.current;
    const now = Date.now();
    if (!options.force && now - lastRefreshStartedAtRef.current < MIN_NON_FORCED_REFRESH_INTERVAL_MS) {
      if (scanRef.current) return scanRef.current;
    }
    lastRefreshStartedAtRef.current = now;

    const task = (async () => {
      const latest = await fetchLatestRenaissOpportunities().catch(() => null);
      if (latest?.opportunities.length) {
        setScan(latest);
        return latest;
      }

      const cached = await fetchCachedRenaissOpportunities();
      if (cached?.opportunities.length) {
        setScan(cached);
        return cached;
      }

      throw new Error("RENAISS monitor has no cached opportunities yet. Wait for the remote auto-refresh job to finish.");
    })();
    scanInFlightRef.current = task;
    setIsScanning(true);
    setError(null);

    try {
      const response = await task;
      return response;
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "RENAISS recommendation scan failed.";
      setError(message);
      throw scanError;
    } finally {
      scanInFlightRef.current = null;
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);

  const analyzeOpportunity = useCallback(async (item: RenaissOpportunity) => {
    setIsReviewing(true);
    setReviewingItemId(item.item_id);
    setError(null);

    try {
      const analysis = await analyzeRenaissItem({
        itemId: item.item_id,
        minProfitUsd: 0,
        thresholdPercent: null,
        walletBudgetUsd: null,
      });
      const review = await reviewRenaissOpportunity({
        analysis,
        opportunity: analysis.result,
      });
      return {
        analysis,
        item: analysis.result,
        review,
      };
    } catch (reviewError) {
      const message = reviewError instanceof Error ? reviewError.message : "RENAISS AI review failed.";
      setError(message);
      throw reviewError;
    } finally {
      setIsReviewing(false);
      setReviewingItemId(null);
    }
  }, []);

  useEffect(() => {
    void fetchLatestRenaissOpportunities()
      .then(async (latest) => {
        if (latest?.opportunities.length) {
          setScan(latest);
          return;
        }
        const cached = await fetchCachedRenaissOpportunities();
        if (cached?.opportunities.length) {
          setScan(cached);
        }
      })
      .catch(() => {
        void fetchCachedRenaissOpportunities()
          .then((cached) => {
            if (cached?.opportunities.length) setScan(cached);
          })
          .catch(() => {
            // No cache should not block the live scan.
          });
      });
    void refresh({ force: true, reason: "wallet-background-startup" }).catch(() => {
      // Error is stored in context for the UI; no fake recommendation is generated.
    });
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh({ reason: "wallet-background-interval" }).catch(() => {
        // The current cache stays visible while the next interval retries.
      });
    }, BACKGROUND_SCAN_INTERVAL_MS);

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh({ force: true, reason: "wallet-background-active" }).catch(() => {
          // The current cache stays visible while the app retries later.
        });
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      analyzeOpportunity,
      error,
      isReviewing,
      isScanning,
      recommendations: scan?.opportunities ?? [],
      refresh,
      reviewingItemId,
      scan,
      usingCachedScan: scan?.cache?.status === "cached" || scan?.cache?.status === "stale",
    }),
    [analyzeOpportunity, error, isReviewing, isScanning, refresh, reviewingItemId, scan],
  );

  return (
    <RenaissRecommendationsContext.Provider value={value}>
      {children}
    </RenaissRecommendationsContext.Provider>
  );
}

export function useRenaissRecommendations() {
  const value = React.use(RenaissRecommendationsContext);

  if (!value) {
    throw new Error("useRenaissRecommendations must be used inside RenaissRecommendationsProvider");
  }

  return value;
}
