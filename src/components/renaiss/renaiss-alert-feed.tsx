import {
  BellRing,
  Brain,
  ExternalLink,
  Radar,
  RefreshCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from "react-native";

import {
  analyzeRenaissItem,
  fetchCachedRenaissOpportunities,
  fetchRenaissHeadlessSession,
  fetchRenaissLatestListings,
  fetchRenaissWebhookAlerts,
  prepareRenaissHeadlessSession,
  reviewRenaissOpportunity,
  scanRenaissOpportunities,
} from "@/services/renaiss/renaiss-monitor-api";
import { colors, radii, shadows } from "@/theme/tokens";
import type {
  RenaissAiReviewResponse,
  RenaissAnalyzeResponse,
  RenaissHeadlessSessionResponse,
  RenaissLatestResponse,
  RenaissListing,
  RenaissOpportunity,
  RenaissScanResponse,
} from "@/types/renaiss-monitor";

type BrowserNotificationPermission = "default" | "denied" | "granted";
type BrowserNotificationStatus = BrowserNotificationPermission | "unsupported";
type BrowserNotificationConstructor = {
  permission: BrowserNotificationPermission;
  requestPermission: () => Promise<BrowserNotificationPermission>;
  new (title: string, options?: { body?: string; tag?: string }): unknown;
};

type RenaissAlertFeedProps = {
  compact?: boolean;
  onAnalysisComplete?: (payload: {
    analysis: RenaissAnalyzeResponse;
    item: RenaissOpportunity;
    review: RenaissAiReviewResponse;
  }) => void;
  variant?: "agent" | "workspace";
};

export function RenaissAlertFeed({
  compact = false,
  onAnalysisComplete,
  variant = "workspace",
}: RenaissAlertFeedProps) {
  const isAgentVariant = variant === "agent";
  const [latest, setLatest] = useState<RenaissLatestResponse | null>(null);
  const [scan, setScan] = useState<RenaissScanResponse | null>(null);
  const [session, setSession] = useState<RenaissHeadlessSessionResponse | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<RenaissOpportunity | null>(null);
  const [analysis, setAnalysis] = useState<RenaissAnalyzeResponse | null>(null);
  const [aiReview, setAiReview] = useState<RenaissAiReviewResponse | null>(null);
  const [webhookCount, setWebhookCount] = useState(0);
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<BrowserNotificationStatus>(
    getNotificationStatus(),
  );
  const [scanLimit, setScanLimit] = useState(3);
  const [minEdgePct, setMinEdgePct] = useState<number | null>(null);
  const [budgetCap, setBudgetCap] = useState<number | null>(null);
  const [onlyActionable, setOnlyActionable] = useState(false);

  const opportunities = useMemo(() => scan?.opportunities ?? [], [scan]);
  const latestItems = latest?.items ?? [];
  const alertCandidates = useMemo(
    () => opportunities.filter(isAlertCandidate),
    [opportunities],
  );

  const loadLatest = useCallback(async () => {
    setIsLoadingLatest(true);
    setError(null);
    try {
      const [latestResponse, webhookResponse] = await Promise.all([
        fetchRenaissLatestListings(compact ? 3 : 5),
        fetchRenaissWebhookAlerts(),
      ]);
      setLatest(latestResponse);
      setWebhookCount(webhookResponse.count);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "RENAISS latest listings failed.");
    } finally {
      setIsLoadingLatest(false);
    }
  }, [compact]);

  const notifyBrowser = useCallback((scanResponse: RenaissScanResponse) => {
    const notification = getBrowserNotification();
    if (!notification || notification.permission !== "granted") return;

    const firstAlert = scanResponse.opportunities.find(isAlertCandidate);
    if (!firstAlert) return;

    new notification("RENAISS price alert", {
      body: `${firstAlert.name} / ${formatOpportunityEdge(firstAlert)}`,
      tag: `renaiss-${firstAlert.item_id}`,
    });
  }, []);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    try {
      const scanResponse = await scanRenaissOpportunities({
        limit: scanLimit,
        min_profit_usd: 0,
        only_actionable: onlyActionable,
        reference_id: `wallet-agent-${Date.now()}`,
        threshold_percent: minEdgePct,
        wallet_budget_usd: budgetCap,
      });
      setScan(scanResponse);
      setSelectedOpportunity((current) => current ?? scanResponse.opportunities[0] ?? null);
      notifyBrowser(scanResponse);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "RENAISS opportunity scan failed.");
    } finally {
      setIsScanning(false);
    }
  }, [budgetCap, minEdgePct, notifyBrowser, onlyActionable, scanLimit]);

  const loadCachedScan = useCallback(async () => {
    try {
      const cached = await fetchCachedRenaissOpportunities();
      if (cached?.opportunities.length) {
        setScan((current) => current ?? cached);
        setSelectedOpportunity((current) => current ?? cached.opportunities[0] ?? null);
      }
    } catch {
      // Cache is an optional warm start; live scan remains the source of truth.
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      setSession(await fetchRenaissHeadlessSession());
    } catch {
      setSession(null);
    }
  }, []);

  const prepareSession = async () => {
    setIsPreparingSession(true);
    setError(null);
    try {
      setSession(await prepareRenaissHeadlessSession());
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "RENAISS headless login failed.");
    } finally {
      setIsPreparingSession(false);
    }
  };

  const requestNotifications = async () => {
    const notification = getBrowserNotification();
    if (!notification) {
      setNotificationStatus("unsupported");
      return;
    }
    const permission = await notification.requestPermission();
    setNotificationStatus(permission);
  };

  const analyzeOpportunity = async (item: RenaissOpportunity) => {
    setSelectedOpportunity(item);
    setAnalysis(null);
    setAiReview(null);
    setReviewError(null);
    setIsReviewing(true);
    try {
      const analysisResponse = await analyzeRenaissItem({
        itemId: item.item_id,
        thresholdPercent: minEdgePct,
        walletBudgetUsd: budgetCap,
      });
      const reviewResponse = await reviewRenaissOpportunity({
        analysis: analysisResponse,
        opportunity: analysisResponse.result,
      });
      setAnalysis(analysisResponse);
      setAiReview(reviewResponse);
      setSelectedOpportunity(analysisResponse.result);
      onAnalysisComplete?.({
        analysis: analysisResponse,
        item: analysisResponse.result,
        review: reviewResponse,
      });
    } catch (reviewFailure) {
      setReviewError(reviewFailure instanceof Error ? reviewFailure.message : "RENAISS AI review failed.");
    } finally {
      setIsReviewing(false);
    }
  };

  useEffect(() => {
    if (isAgentVariant) return;
    void loadLatest();
    void loadSession();
  }, [isAgentVariant, loadLatest, loadSession]);

  useEffect(() => {
    void loadCachedScan();
    void runScan();
  }, [loadCachedScan, runScan]);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderCurve: "continuous",
        borderRadius: compact ? 22 : radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: compact ? 12 : 14,
        padding: compact ? 14 : 16,
      }}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 12 }}>
        <View
          style={{
            alignItems: "center",
            backgroundColor: alertCandidates.length > 0 ? colors.amberSoft : colors.mintSoft,
            borderRadius: radii.pill,
            height: 38,
            justifyContent: "center",
            width: 38,
          }}
        >
          <Radar
            color={alertCandidates.length > 0 ? colors.amber : colors.mint}
            size={20}
            strokeWidth={2.4}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: compact ? 17 : 20, fontWeight: "900" }}>
            {isAgentVariant ? "Card recommendations" : "RENAISS Price Radar"}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            {isAgentVariant
              ? "Live monitor cards ranked by spread. Tap one and the agent will analyze the full price trend."
              : "Polls your Zeabur monitor, ranks card spreads, and lets AI review each card before any buy flow."}
          </Text>
        </View>
      </View>

      <AlertSummary
        alertCount={alertCandidates.length}
        isScanning={isScanning}
        scan={scan}
      />

      {!isAgentVariant ? (
        <>
          <ScanControls
            budgetCap={budgetCap}
            minEdgePct={minEdgePct}
            onlyActionable={onlyActionable}
            scanLimit={scanLimit}
            setBudgetCap={setBudgetCap}
            setMinEdgePct={setMinEdgePct}
            setOnlyActionable={setOnlyActionable}
            setScanLimit={setScanLimit}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <MonitorButton
              disabled={isLoadingLatest}
              icon={isLoadingLatest ? "loading" : "refresh"}
              label="Refresh"
              onPress={() => {
                void loadLatest();
              }}
            />
            <MonitorButton
              disabled={isScanning}
              icon={isScanning ? "loading" : "scan"}
              label="Scan now"
              onPress={() => {
                void runScan();
              }}
            />
            <MonitorButton
              disabled={notificationStatus === "unsupported" || notificationStatus === "granted"}
              icon="bell"
              label={notificationStatus === "granted" ? "Push on" : "Enable push"}
              onPress={() => {
                void requestNotifications();
              }}
            />
            <MonitorButton
              disabled={isPreparingSession}
              icon={isPreparingSession ? "loading" : "login"}
              label="Prepare session"
              onPress={() => {
                void prepareSession();
              }}
            />
          </View>
        </>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <StatusPill label={`${alertCandidates.length} alert`} tone={alertCandidates.length > 0 ? "amber" : "muted"} />
        <StatusPill label={`${opportunities.length} ranked`} />
        {scan?.cache?.status === "cached" || scan?.cache?.status === "stale" ? (
          <StatusPill label="cached scan" tone="amber" />
        ) : null}
        {!isAgentVariant ? (
          <>
            <StatusPill label={`${webhookCount} webhook`} />
            <StatusPill label={session?.sessionReady ? "session ready" : "session offline"} tone={session?.sessionReady ? "mint" : "muted"} />
          </>
        ) : null}
      </View>

      {error ? (
        <Text style={{ color: colors.red, fontSize: 13, fontWeight: "800", lineHeight: 18 }}>
          {error}
        </Text>
      ) : null}

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
          Recommended Cards
        </Text>
        {opportunities.length > 0 ? (
          opportunities.map((item) => (
            <OpportunityCard
              isLoading={isReviewing && selectedOpportunity?.item_id === item.item_id}
              isSelected={selectedOpportunity?.item_id === item.item_id}
              item={item}
              key={item.item_id}
              onAnalyze={() => {
                void analyzeOpportunity(item);
              }}
              variant={variant}
            />
          ))
        ) : (
          <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            {isScanning ? "Scanning monitor prices..." : "No monitor result loaded yet."}
          </Text>
        )}
      </View>

      {selectedOpportunity ? (
        <AiReviewCard
          analysis={analysis}
          error={reviewError}
          isLoading={isReviewing}
          item={selectedOpportunity}
          review={aiReview}
        />
      ) : null}

      {!isAgentVariant && session?.sessionReady ? (
        <SessionCard session={session} />
      ) : null}

      {!isAgentVariant ? (
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
          Live Listings
        </Text>
        {latestItems.length > 0 ? (
          latestItems.slice(0, compact ? 2 : 4).map((item) => (
            <ListingCard item={item} key={item.item_id} />
          ))
        ) : (
          <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            {isLoadingLatest ? "Loading RENAISS listings..." : "No listings loaded yet."}
          </Text>
        )}
      </View>
      ) : null}
    </View>
  );
}

function AlertSummary({
  alertCount,
  isScanning,
  scan,
}: {
  alertCount: number;
  isScanning: boolean;
  scan: RenaissScanResponse | null;
}) {
  const text = isScanning
    ? "Checking RENAISS cards against reference markets..."
    : alertCount > 0
      ? `${alertCount} buy alert${alertCount === 1 ? "" : "s"} need review.`
      : scan
        ? "No buy alert right now. Showing watchlist cards with the best available spreads."
        : "Waiting for the first monitor scan.";

  return (
    <View
      style={{
        backgroundColor: alertCount > 0 ? colors.amberSoft : colors.surfaceMuted,
        borderRadius: radii.md,
        padding: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 18 }}>
        {text}
      </Text>
      {scan ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
          Last scan: {scan.count} cards / threshold {scan.threshold_percent}% / min profit ${formatMoney(scan.min_profit_usd)}
        </Text>
      ) : null}
      {scan?.cache?.status === "cached" || scan?.cache?.status === "stale" ? (
        <Text style={{ color: colors.amber, fontSize: 12, fontWeight: "900", lineHeight: 17 }}>
          Using the last successful scan cache{scan.cache.cachedAt ? ` from ${formatScanTime(scan.cache.cachedAt)}` : ""}.
        </Text>
      ) : null}
    </View>
  );
}

function ScanControls({
  budgetCap,
  minEdgePct,
  onlyActionable,
  scanLimit,
  setBudgetCap,
  setMinEdgePct,
  setOnlyActionable,
  setScanLimit,
}: {
  budgetCap: number | null;
  minEdgePct: number | null;
  onlyActionable: boolean;
  scanLimit: number;
  setBudgetCap: (value: number | null) => void;
  setMinEdgePct: (value: number | null) => void;
  setOnlyActionable: (value: boolean) => void;
  setScanLimit: (value: number) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <SlidersHorizontal color={colors.textMuted} size={15} strokeWidth={2.4} />
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "900" }}>
          Scan policy
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
        {[3, 5, 10].map((value) => (
          <OptionChip
            isActive={scanLimit === value}
            key={value}
            label={`${value} cards`}
            onPress={() => setScanLimit(value)}
          />
        ))}
        {[
          { label: "Default edge", value: null },
          { label: "10% edge", value: 10 },
          { label: "20% edge", value: 20 },
        ].map((option) => (
          <OptionChip
            isActive={minEdgePct === option.value}
            key={option.label}
            label={option.label}
            onPress={() => setMinEdgePct(option.value)}
          />
        ))}
        {[
          { label: "Any budget", value: null },
          { label: "$100 cap", value: 100 },
          { label: "$500 cap", value: 500 },
          { label: "$1k cap", value: 1000 },
        ].map((option) => (
          <OptionChip
            isActive={budgetCap === option.value}
            key={option.label}
            label={option.label}
            onPress={() => setBudgetCap(option.value)}
          />
        ))}
        <OptionChip
          isActive={onlyActionable}
          label="Only buy candidates"
          onPress={() => setOnlyActionable(!onlyActionable)}
        />
      </View>
    </View>
  );
}

function OptionChip({
  isActive,
  label,
  onPress,
}: {
  isActive: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: isActive ? colors.ink : colors.surfaceMuted,
        borderRadius: radii.pill,
        opacity: pressed ? 0.72 : 1,
        paddingHorizontal: 10,
        paddingVertical: 7,
      })}
    >
      <Text style={{ color: isActive ? "#FFFFFF" : colors.textMuted, fontSize: 12, fontWeight: "900" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function MonitorButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  icon: "bell" | "loading" | "login" | "refresh" | "scan";
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.ink,
        borderRadius: radii.pill,
        flexDirection: "row",
        gap: 8,
        minHeight: 38,
        opacity: disabled ? 0.58 : pressed ? 0.74 : 1,
        paddingHorizontal: 13,
      })}
    >
      {icon === "loading" ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : icon === "bell" ? (
        <BellRing color="#FFFFFF" size={15} strokeWidth={2.4} />
      ) : icon === "login" ? (
        <Radar color="#FFFFFF" size={15} strokeWidth={2.4} />
      ) : icon === "refresh" ? (
        <RefreshCcw color="#FFFFFF" size={15} strokeWidth={2.4} />
      ) : (
        <Search color="#FFFFFF" size={15} strokeWidth={2.4} />
      )}
      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SessionCard({ session }: { session: RenaissHeadlessSessionResponse }) {
  return (
    <View
      style={{
        backgroundColor: colors.mintSoft,
        borderRadius: radii.md,
        gap: 7,
        padding: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
        RENAISS session prepared
      </Text>
      <SessionRow label="Owner wallet" value={shortAddress(session.ownerWalletAddress)} />
      <SessionRow label="App wallet" value={shortAddress(session.walletAddress)} />
      <SessionRow label="Signed wallet linked" value={session.signedWalletLinked ? "true" : "false"} />
      <SessionRow label="Cookie names" value={session.cookieNames.join(", ") || "(none)"} />
      <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
        Cookie values stay on the local agent server. buyNow remains disabled until order signing is connected.
      </Text>
    </View>
  );
}

function AiReviewCard({
  analysis,
  error,
  isLoading,
  item,
  review,
}: {
  analysis: RenaissAnalyzeResponse | null;
  error: string | null;
  isLoading: boolean;
  item: RenaissOpportunity;
  review: RenaissAiReviewResponse | null;
}) {
  const verdictTone =
    review?.verdict === "buy_candidate" ? "mint" : review?.verdict === "avoid" ? "red" : "amber";

  return (
    <View
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        gap: 10,
        padding: 12,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <Brain color={colors.violet} size={17} strokeWidth={2.4} />
        <Text style={{ color: colors.text, flex: 1, fontSize: 14, fontWeight: "900" }}>
          AI buy review
        </Text>
        {review ? (
          <StatusPill label={`${review.verdict.replace("_", " ")} ${review.confidence}%`} tone={verdictTone} />
        ) : null}
      </View>

      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 18 }}>
        {item.name}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
        Ask ${formatMoney(item.ask_price_usd)} / {formatOpportunityEdge(analysis?.result ?? item)}
      </Text>

      {isLoading ? (
        <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
          <ActivityIndicator color={colors.violet} size="small" />
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "900" }}>
            Asking MiniMax to review the real monitor payload...
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: colors.red, fontSize: 12, fontWeight: "900", lineHeight: 17 }}>
          {error}
        </Text>
      ) : null}

      {review ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 18 }}>
            {review.headline}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
            {review.priceSummary}
          </Text>
          {review.trendSummary ? (
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
              {review.trendSummary}
            </Text>
          ) : null}
          <ReviewList label="Card name signals" values={review.cardNameSignals} />
          <ReviewList label="Market data used" values={review.marketDataUsed} />
          <ReviewList label="Reasons" values={review.reasons} />
          <ReviewList label="Risk flags" values={review.riskFlags} />
          <ReviewList label="Next checks" values={review.nextChecks} />
        </View>
      ) : null}
    </View>
  );
}

function ReviewList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900" }}>
        {label}
      </Text>
      {values.map((value) => (
        <Text key={value} style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
          {value}
        </Text>
      ))}
    </View>
  );
}

function SessionRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "900", width: 118 }}>
        {label}
      </Text>
      <Text selectable style={{ color: colors.text, flex: 1, fontSize: 12, fontWeight: "800" }}>
        {value}
      </Text>
    </View>
  );
}

function StatusPill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "amber" | "mint" | "muted" | "red";
}) {
  const palette = {
    amber: { background: colors.amberSoft, text: "#9B5C00" },
    mint: { background: colors.mintSoft, text: "#08785F" },
    muted: { background: colors.surfaceMuted, text: colors.textMuted },
    red: { background: colors.redSoft, text: colors.red },
  }[tone];

  return (
    <View
      style={{
        backgroundColor: palette.background,
        borderRadius: radii.pill,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 12, fontWeight: "900" }}>
        {label}
      </Text>
    </View>
  );
}

function ListingCard({ item }: { item: RenaissListing }) {
  return (
    <MarketCard
      actionLabel="Open card"
      imageUrl={item.image_url}
      meta={`${item.grade ?? "Ungraded"} / ask $${formatMoney(item.ask_price)}`}
      onPress={() => openUrl(item.renaiss_url)}
      title={item.name}
    />
  );
}

function OpportunityCard({
  isLoading,
  isSelected,
  item,
  onAnalyze,
  variant,
}: {
  isLoading: boolean;
  isSelected: boolean;
  item: RenaissOpportunity;
  onAnalyze: () => void;
  variant: "agent" | "workspace";
}) {
  const alert = isAlertCandidate(item);
  const tone = alert ? "amber" : item.action === "BUY_CANDIDATE" ? "mint" : "muted";
  const isAgentVariant = variant === "agent";
  const cardStyle = {
    backgroundColor: isSelected ? "#FAFAF8" : colors.surfaceMuted,
    borderColor: isSelected ? colors.ink : "transparent",
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  } as const;

  const content = (
    <>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 11 }}>
        {item.image_url ? (
          <Image
            source={{ uri: item.image_url }}
            style={{
              backgroundColor: colors.surfaceStrong,
              borderRadius: radii.sm,
              height: 62,
              width: 48,
            }}
          />
        ) : null}
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <StatusPill label={item.action} tone={tone} />
            <StatusPill label={item.actionable ? "actionable" : "needs review"} tone={item.actionable ? "mint" : "muted"} />
          </View>
          <Text numberOfLines={2} style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 17 }}>
            {item.name}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
            Ask ${formatMoney(item.ask_price_usd)} / {formatOpportunityEdge(item)}
          </Text>
        </View>
      </View>

      <View style={{ gap: 5 }}>
        <SourceLine label="PriceCharting" source={item.sources.pricecharting} />
        <SourceLine label="SNKRDUNK" source={item.sources.snkrdunk} />
      </View>

      {isAgentVariant ? (
        <View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>
          {isLoading ? (
            <ActivityIndicator color={colors.violet} size="small" />
          ) : (
            <Brain color={colors.violet} size={14} strokeWidth={2.4} />
          )}
          <Text style={{ color: colors.violet, fontSize: 12, fontWeight: "900" }}>
            {isLoading ? "Analyzing full trend..." : "Tap for full trend analysis"}
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={onAnalyze}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.ink,
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 7,
            minHeight: 34,
            opacity: isLoading ? 0.6 : pressed ? 0.74 : 1,
            paddingHorizontal: 12,
          })}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Brain color="#FFFFFF" size={14} strokeWidth={2.4} />
          )}
          <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>
            AI Review
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => openUrl(item.renaiss_url)}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 7,
            minHeight: 34,
            opacity: pressed ? 0.72 : 1,
            paddingHorizontal: 12,
          })}
        >
          <ExternalLink color={colors.textMuted} size={14} strokeWidth={2.4} />
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "900" }}>
            RENAISS
          </Text>
        </Pressable>
        </View>
      )}
    </>
  );

  if (isAgentVariant) {
    return (
      <Pressable
        accessibilityLabel={`Analyze ${item.name}`}
        accessibilityRole="button"
        disabled={isLoading}
        onPress={onAnalyze}
        style={({ pressed }) => ({
          ...cardStyle,
          opacity: isLoading ? 0.76 : pressed ? 0.72 : 1,
        })}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={cardStyle}>
      {content}
    </View>
  );
}

function SourceLine({
  label,
  source,
}: {
  label: string;
  source: RenaissOpportunity["sources"]["pricecharting"];
}) {
  const trendLabel = formatTrendLabel(source.trend);
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "900", width: 86 }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, flex: 1, fontSize: 11, fontWeight: "800" }}>
        {source.avg_price_usd === null ? "No market sample" : `$${formatMoney(source.avg_price_usd)}`}
        {source.diff_pct === null ? "" : ` / ${source.diff_pct.toFixed(1)}%`}
        {source.records_total ? ` / ${source.records_total} records` : source.sample_count ? ` / ${source.sample_count} samples` : ""}
        {trendLabel ? ` / ${trendLabel}` : ""}
      </Text>
    </View>
  );
}

function MarketCard({
  actionLabel,
  imageUrl,
  meta,
  onPress,
  title,
}: {
  actionLabel: string;
  imageUrl?: string | null;
  meta: string;
  onPress: () => void;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={actionLabel}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        flexDirection: "row",
        gap: 11,
        opacity: pressed ? 0.76 : 1,
        padding: 10,
      })}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{
            backgroundColor: colors.surfaceStrong,
            borderRadius: radii.sm,
            height: 54,
            width: 42,
          }}
        />
      ) : null}
      <View style={{ flex: 1, gap: 4 }}>
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 17 }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
          {meta}
        </Text>
      </View>
      <ExternalLink color={colors.textMuted} size={16} strokeWidth={2.3} />
    </Pressable>
  );
}

function isAlertCandidate(item: RenaissOpportunity) {
  return (
    item.action === "BUY_CANDIDATE" ||
    item.actionable ||
    (item.estimated_profit_usd !== null && item.estimated_profit_usd > 0) ||
    (item.estimated_diff_pct !== null && item.estimated_diff_pct >= 10)
  );
}

function formatOpportunityEdge(item: RenaissOpportunity) {
  const diff = item.estimated_diff_pct === null ? "no spread" : `${item.estimated_diff_pct.toFixed(1)}%`;
  const profit =
    item.estimated_profit_usd === null ? "" : ` / est. $${formatMoney(item.estimated_profit_usd)}`;
  return `${item.best_market ?? "No market"} / ${diff}${profit}`;
}

function formatTrendLabel(source: RenaissOpportunity["sources"]["pricecharting"]["trend"]) {
  if (!source || source.direction === "insufficient") return "";
  const pct = source.trend_pct === null ? "" : ` ${source.trend_pct >= 0 ? "+" : ""}${source.trend_pct.toFixed(1)}%`;
  return `${source.direction}${pct}`;
}

function getBrowserNotification() {
  return (globalThis as { Notification?: BrowserNotificationConstructor }).Notification ?? null;
}

function getNotificationStatus(): BrowserNotificationStatus {
  const notification = getBrowserNotification();
  return notification?.permission ?? "unsupported";
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatScanTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortAddress(value?: string | null) {
  if (!value) return "(none)";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function openUrl(url?: string | null) {
  if (!url) return;
  void Linking.openURL(url);
}
