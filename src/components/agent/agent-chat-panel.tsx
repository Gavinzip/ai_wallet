import * as Haptics from "expo-haptics";
import { ArrowUp, Bot, Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";

import { ChatBubble } from "@/components/agent/chat-bubble";
import { IntentReviewCard } from "@/components/agent/intent-review-card";
import { BorderGlow } from "@/components/ui/border-glow";
import { initialAgentMessages } from "@/data/agent";
import { sendAgentChat } from "@/services/agent-chat";
import { consumeBrowserExtensionSnapshotPrompt } from "@/services/extension/browser-extension-bridge";
import { useRenaissRecommendations } from "@/state/renaiss-recommendations-context";
import { colors, radii } from "@/theme/tokens";
import type { AgentMessage, AgentSkill } from "@/types/agent";
import type { WalletIntent } from "@/types/intent";
import type {
  RenaissAiReviewResponse,
  RenaissAnalyzeResponse,
  RenaissOpportunity,
} from "@/types/renaiss-monitor";

type AgentChatPanelProps = {
  enabledSkills: AgentSkill[];
  signingMode: "passkey" | "password";
  tokenCoreReady: boolean;
  visibleSkills: AgentSkill[];
};

export function AgentChatPanel({
  enabledSkills,
  signingMode,
  tokenCoreReady,
  visibleSkills,
}: AgentChatPanelProps) {
  const { height, width } = useWindowDimensions();
  const messageScrollRef = useRef<ScrollView | null>(null);
  const {
    analyzeOpportunity,
    error: recommendationsError,
    isReviewing,
    isScanning,
    recommendations,
    reviewingItemId,
    scan,
    usingCachedScan,
  } = useRenaissRecommendations();
  const [messages, setMessages] = useState<AgentMessage[]>(initialAgentMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<WalletIntent | null>(null);
  const compact = width < 420;
  const canvasHeight = Math.max(compact ? 520 : 620, height - (compact ? 240 : 280));
  const showLanding = messages.length === 0 && !isSending && !pendingIntent;

  useEffect(() => {
    const extensionPrompt = consumeBrowserExtensionSnapshotPrompt();
    if (!extensionPrompt) return;
    setDraft(extensionPrompt);
    setMessages((current) => [
      ...current,
      {
        from: "system",
        id: `extension-${Date.now()}`,
        text: "Chrome extension page snapshot imported. Review it or edit the prompt before sending.",
        timestamp: timestamp(),
      },
    ]);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      messageScrollRef.current?.scrollToEnd({ animated: messages.length > 0 });
    });
  }, [messages.length, isSending]);

  const timestamp = () =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

  const appendRenaissAnalysis = (payload: {
    analysis?: RenaissAnalyzeResponse | null;
    item: RenaissOpportunity;
    review: RenaissAiReviewResponse;
  }) => {
    setMessages((current) => [
      ...current,
      {
        from: "agent",
        id: `renaiss-${Date.now()}`,
        model: payload.review.model,
        renaissAnalysis: {
          analysis: payload.analysis ?? null,
          item: payload.item,
          review: payload.review,
        },
        text: formatRenaissAnalysisMessage(payload.item, payload.review),
        timestamp: timestamp(),
      },
    ]);
  };

  const selectRenaissRecommendation = async (item: RenaissOpportunity) => {
    try {
      const payload = await analyzeOpportunity(item);
      appendRenaissAnalysis(payload);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          from: "system",
          id: `renaiss-error-${Date.now()}`,
          text: error instanceof Error ? error.message : "RENAISS analysis failed.",
          timestamp: timestamp(),
        },
      ]);
    }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || isSending) return;

    if (process.env.EXPO_OS === "ios") {
      void Haptics.selectionAsync();
    }

    const userMessage: AgentMessage = {
      from: "user",
      id: `user-${Date.now()}`,
      text,
      timestamp: timestamp(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);

    try {
      const response = await sendAgentChat(nextMessages, enabledSkills);
      setPendingIntent(response.intent);
      setMessages((current) => [
        ...current,
        {
          from: "agent",
          id: `agent-${Date.now()}`,
          model: response.model,
          renaissAnalysis: response.renaissAnalysis,
          text: response.message,
          timestamp: timestamp(),
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          from: "system",
          id: `system-${Date.now()}`,
          text: error instanceof Error ? error.message : "Agent chat failed.",
          timestamp: timestamp(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={{ gap: 18, minHeight: canvasHeight }}>
      <AgentHeader skillsCount={enabledSkills.length} tokenCoreReady={tokenCoreReady} />

      <View style={{ flex: 1, minHeight: canvasHeight - 170 }}>
        <ScrollView
          ref={messageScrollRef}
          contentContainerStyle={{
            flexGrow: 1,
            gap: showLanding ? 22 : 12,
            justifyContent: showLanding ? "center" : "flex-end",
            paddingHorizontal: compact ? 2 : 4,
            paddingVertical: compact ? 14 : 18,
          }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {showLanding ? (
            <EmptyAgentState
              isScanning={isScanning}
              recommendationsCount={recommendations.length}
              tokenCoreReady={tokenCoreReady}
            />
          ) : null}

          {showLanding ? (
            <QuickPromptRail
              onSelect={(text) => {
                void send(text);
              }}
            />
          ) : null}

          {showLanding && visibleSkills.some((skill) => skill.id === "renaiss-buyer" && skill.enabled) ? (
            <RenaissRecommendationPrelude
              compact={compact}
              error={recommendationsError}
              isReviewing={isReviewing}
              isScanning={isScanning}
              onSelect={(item) => {
                void selectRenaissRecommendation(item);
              }}
              recommendations={recommendations}
              reviewingItemId={reviewingItemId}
              scanCachedAt={scan?.cache?.cachedAt ?? null}
              usingCachedScan={usingCachedScan}
            />
          ) : null}

          {messages.map((message) => (
            <Animated.View entering={FadeInUp.duration(140)} key={message.id}>
              <ChatBubble message={message} />
            </Animated.View>
          ))}

          {isSending ? (
            <Animated.View entering={FadeIn.duration(120)}>
              <TypingBubble />
            </Animated.View>
          ) : null}

        </ScrollView>
      </View>

      {pendingIntent ? (
        <Animated.View entering={FadeInDown.duration(160)}>
          <IntentReviewCard
            intent={pendingIntent}
            signingAvailable={tokenCoreReady}
            signingMode={signingMode}
          />
        </Animated.View>
      ) : null}

      <PromptComposer
        compact={compact}
        draft={draft}
        isSending={isSending}
        onChangeDraft={setDraft}
        onSend={() => {
          void send();
        }}
      />
    </View>
  );
}

function AgentHeader({
  skillsCount,
  tokenCoreReady,
}: {
  skillsCount: number;
  tokenCoreReady: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 2,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.ink,
          borderRadius: radii.pill,
          height: 44,
          justifyContent: "center",
          width: 44,
        }}
      >
        <Bot color="#FFFFFF" size={21} strokeWidth={2.5} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
          Wallet Agent
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
          {tokenCoreReady ? "Token Core Ready" : "Desktop Verify"} / {skillsCount} Skills
        </Text>
      </View>
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.blueSoft,
          borderRadius: radii.pill,
          height: 38,
          justifyContent: "center",
          width: 38,
        }}
      >
        <Sparkles color={colors.blue} size={19} strokeWidth={2.4} />
      </View>
    </View>
  );
}

const quickPrompts = [
  "幫我推薦 RENAISS 撿漏卡並分析走勢",
  "幫我準備 RENAISS 掛單審核",
  "用 Bitrefill 找美國 Steam 禮品卡",
  "檢查 Puffer pufETH 和 UniFi vault",
  "用 PancakeSwap 把 0.001 BNB 換成 USDC",
  "檢查 Venus 借貸風險",
];

function QuickPromptRail({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      style={{
        alignSelf: "stretch",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: colors.textMuted,
          flexBasis: "100%",
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.3,
          textAlign: "center",
        }}
      >
        建議指令，不是 AI 回覆
      </Text>
      {quickPrompts.map((prompt) => (
        <Pressable
          accessibilityLabel={prompt}
          accessibilityRole="button"
          key={prompt}
          onPress={() => onSelect(prompt)}
          style={({ pressed }) => ({
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radii.pill,
            borderWidth: 1,
            opacity: pressed ? 0.72 : 1,
            paddingHorizontal: 12,
            paddingVertical: 9,
          })}
        >
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900" }}>
            {prompt}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

function EmptyAgentState({
  isScanning,
  recommendationsCount,
  tokenCoreReady,
}: {
  isScanning: boolean;
  recommendationsCount: number;
  tokenCoreReady: boolean;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={{
        alignItems: "center",
        alignSelf: "center",
        gap: 10,
        maxWidth: 520,
        paddingHorizontal: 18,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.blueSoft,
          borderRadius: radii.pill,
          height: 44,
          justifyContent: "center",
          width: 44,
        }}
      >
        <Sparkles color={colors.blue} size={22} strokeWidth={2.5} />
      </View>
      <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900", textAlign: "center" }}>
        接下來要我幫你做什麼？
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 13,
          fontWeight: "700",
          lineHeight: 19,
          textAlign: "center",
        }}
      >
        {tokenCoreReady
          ? isScanning
            ? "我已經在背景檢查 RENAISS 價格，找到卡片會直接列在下面。"
            : recommendationsCount > 0
              ? "下面有即時 RENAISS 推薦，也可以直接用文字叫我分析。"
              : "可以問 swap、DeFi 風險、或叫我找 RENAISS 撿漏卡。Token Core 只在本機簽名。"
          : "Desktop Verify can inspect transaction previews. Live signing needs Token Core runtime."}
      </Text>
    </Animated.View>
  );
}

function RenaissRecommendationPrelude({
  compact,
  error,
  isReviewing,
  isScanning,
  onSelect,
  recommendations,
  reviewingItemId,
  scanCachedAt,
  usingCachedScan,
}: {
  compact: boolean;
  error: string | null;
  isReviewing: boolean;
  isScanning: boolean;
  onSelect: (item: RenaissOpportunity) => void;
  recommendations: RenaissOpportunity[];
  reviewingItemId: string | null;
  scanCachedAt: string | null;
  usingCachedScan: boolean;
}) {
  const visibleRecommendations = [...recommendations]
    .sort((left, right) => scoreRecommendation(right) - scoreRecommendation(left))
    .slice(0, 5);

  if (error && recommendations.length === 0) {
    return (
      <Text style={{ color: colors.red, fontSize: 13, fontWeight: "800", textAlign: "center" }}>
        {error}
      </Text>
    );
  }

  if (recommendations.length === 0) {
    return (
      <View style={{ alignItems: "center", gap: 8 }}>
        {isScanning ? <ActivityIndicator color={colors.blue} size="small" /> : null}
        <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "800", textAlign: "center" }}>
          {isScanning ? "正在預先整理推薦卡片..." : "目前沒有 RENAISS 推薦卡片。"}
        </Text>
      </View>
    );
  }

  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      style={{
        alignSelf: "stretch",
        gap: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "900" }}>
        RENAISS 推薦
      </Text>
      {usingCachedScan ? (
        <Text style={{ color: colors.amber, fontSize: 12, fontWeight: "900", lineHeight: 16 }}>
          {isScanning ? "正在背景抓最新 RENAISS 掃描；目前先顯示上次成功快取" : "遠端 API 尚未回傳最新結果，先顯示上次成功掃描快取"}
          {scanCachedAt ? `（${formatScanTime(scanCachedAt)}）` : ""}。
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 24 }}
      >
        {visibleRecommendations.map((item) => (
          <RenaissRecommendationCard
            compact={compact}
            isLoading={isReviewing && reviewingItemId === item.item_id}
            item={item}
            key={item.item_id}
            onPress={() => onSelect(item)}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

function RenaissRecommendationCard({
  compact,
  isLoading,
  item,
  onPress,
}: {
  compact: boolean;
  isLoading: boolean;
  item: RenaissOpportunity;
  onPress: () => void;
}) {
  const bestSource = getBestSource(item);
  const profit = getProfitMeta(item);
  const marketLabel = bestSource.label;
  const averageLabel = bestSource.avgPrice === null ? "無摘要均價" : `$${formatMoney(bestSource.avgPrice)}`;
  const spreadLabel = item.estimated_diff_pct === null ? "無價差" : `${item.estimated_diff_pct.toFixed(1)}%`;

  return (
    <Pressable
      accessibilityLabel={`Analyze ${item.name}`}
      accessibilityRole="button"
      disabled={isLoading}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: 18,
        borderWidth: 1,
        gap: 9,
        maxWidth: compact ? 224 : 260,
        opacity: isLoading ? 0.7 : pressed ? 0.72 : 1,
        padding: 10,
        width: compact ? 212 : 244,
      })}
    >
      <View style={{ flexDirection: "row", gap: 10 }}>
        {item.image_url ? (
          <Image
            resizeMode="contain"
            source={{ uri: item.image_url }}
            style={{
              backgroundColor: colors.surfaceStrong,
              borderRadius: 10,
              height: compact ? 92 : 104,
              objectFit: "contain",
              width: compact ? 68 : 78,
            }}
          />
        ) : (
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.surfaceMuted,
              borderRadius: 10,
              height: compact ? 92 : 104,
              justifyContent: "center",
              width: compact ? 68 : 78,
            }}
          >
            <Bot color={colors.textMuted} size={20} strokeWidth={2.4} />
          </View>
        )}
        <View style={{ flex: 1, gap: 7 }}>
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: profit.background,
              borderRadius: radii.pill,
              paddingHorizontal: 8,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: profit.color, fontSize: 11, fontWeight: "900" }}>
              {profit.label}
            </Text>
          </View>
          <Text numberOfLines={4} style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 17 }}>
            {item.name}
          </Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <MetricLine label="目前掛牌" value={`$${formatMoney(item.ask_price_usd)}`} />
        <MetricLine label={`${marketLabel} 摘要均價`} value={averageLabel} />
        <MetricLine label="預估損益" tone={profit.tone} value={profit.value} />
        <MetricLine label="價差" tone={profit.tone} value={spreadLabel} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <SourceChip label="RENAISS" url={item.renaiss_url} />
        <SourceChip label="PriceCharting" url={item.sources.pricecharting.url} />
        <SourceChip label="SNKRDUNK" url={item.sources.snkrdunk.url} />
      </View>

      <Text numberOfLines={3} style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 17 }}>
        {bestSource.url ? "可點來源核對價格。" : "目前缺少可用來源連結。"}
      </Text>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        {isLoading ? <ActivityIndicator color={colors.violet} size="small" /> : null}
        <Text style={{ color: colors.violet, fontSize: 12, fontWeight: "900" }}>
          {isLoading ? "分析中" : "點我分析"}
        </Text>
      </View>
    </Pressable>
  );
}

function MetricLine({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "negative" | "positive";
  value: string;
}) {
  const valueColor = tone === "positive" ? "#08785F" : tone === "negative" ? colors.red : colors.text;
  return (
    <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
      <Text style={{ color: colors.textMuted, flex: 1, fontSize: 11, fontWeight: "800" }}>
        {label}
      </Text>
      <Text style={{ color: valueColor, fontSize: 12, fontWeight: "900" }}>
        {value}
      </Text>
    </View>
  );
}

function SourceChip({ label, url }: { label: string; url?: string | null }) {
  if (!url) return null;
  return (
    <Text
      onPress={(event) => {
        event?.stopPropagation?.();
        void Linking.openURL(url);
      }}
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.pill,
        color: colors.blue,
        fontSize: 11,
        fontWeight: "900",
        overflow: "hidden",
        paddingHorizontal: 8,
        paddingVertical: 6,
      }}
    >
      {label}
    </Text>
  );
}

function PromptComposer({
  compact,
  draft,
  isSending,
  onChangeDraft,
  onSend,
}: {
  compact: boolean;
  draft: string;
  isSending: boolean;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
}) {
  const canSend = draft.trim().length > 0 && !isSending;

  return (
    <BorderGlow
      active={draft.trim().length > 0}
      animated={false}
      backgroundColor="#FFFFFF"
      borderRadius={26}
      colors={["#c084fc", "#f472b6", "#38bdf8"]}
      fillOpacity={0}
      glowColor="210 90 62"
      glowIntensity={0.72}
      glowRadius={18}
      style={{ width: "100%" }}
    >
      <View
        style={{
          alignItems: "flex-end",
          flexDirection: "row",
          gap: 10,
          minHeight: compact ? 58 : 62,
          padding: 8,
        }}
      >
        <TextInput
          multiline
          onChangeText={onChangeDraft}
          placeholder="Ask the wallet agent..."
          placeholderTextColor={colors.textSoft}
          returnKeyType="send"
          style={{
            color: colors.text,
            flex: 1,
            fontSize: 16,
            lineHeight: 22,
            maxHeight: 96,
            minHeight: 42,
            paddingHorizontal: 8,
            paddingVertical: 9,
            textAlignVertical: "top",
          }}
          value={draft}
          onSubmitEditing={onSend}
        />

        <Pressable
          accessibilityLabel="Send agent message"
          accessibilityRole="button"
          disabled={!canSend}
          onPress={onSend}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: canSend ? colors.ink : "rgba(17,17,19,0.18)",
            borderRadius: radii.pill,
            height: 44,
            justifyContent: "center",
            opacity: canSend ? (pressed ? 0.78 : 1) : 0.72,
            width: 44,
          })}
        >
          {isSending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ArrowUp color="#FFFFFF" size={22} strokeWidth={2.5} />
          )}
        </Pressable>
      </View>
    </BorderGlow>
  );
}

function formatRenaissAnalysisMessage(
  item: RenaissOpportunity,
  review: RenaissAiReviewResponse,
) {
  const lines = [
    `我看完 ${item.name} 了。${review.headline}`,
  ];
  lines.push(`結論：${formatVerdictLabel(review.verdict)}，信心 ${review.confidence}%。`);
  lines.push("要我準備購買流程的話，直接跟我說「幫我買這張」。");
  return lines.join("\n");
}

function formatVerdictLabel(value: RenaissAiReviewResponse["verdict"]) {
  if (value === "buy_candidate") return "可考慮";
  if (value === "avoid") return "先不要";
  return "觀望";
}

function scoreRecommendation(item: RenaissOpportunity) {
  const actionScore = item.action === "BUY_CANDIDATE" ? 10_000 : 0;
  const profitScore = Number(item.estimated_profit_usd ?? -999) * 10;
  const spreadScore = Number(item.estimated_diff_pct ?? -999);
  return actionScore + profitScore + spreadScore;
}

function getBestSource(item: RenaissOpportunity) {
  const market = (item.best_market ?? "").toLowerCase();
  const key =
    market.includes("snkr")
      ? "snkrdunk"
      : market.includes("price")
        ? "pricecharting"
        : pickHighestAverageSource(item);
  const source = item.sources[key];
  return {
    avgPrice: source?.avg_price_usd ?? null,
    label: key === "snkrdunk" ? "SNKRDUNK" : "PriceCharting",
    url: source?.url ?? null,
  };
}

function pickHighestAverageSource(item: RenaissOpportunity): "pricecharting" | "snkrdunk" {
  const pricecharting = item.sources.pricecharting.avg_price_usd ?? -1;
  const snkrdunk = item.sources.snkrdunk.avg_price_usd ?? -1;
  return snkrdunk > pricecharting ? "snkrdunk" : "pricecharting";
}

function getProfitMeta(item: RenaissOpportunity) {
  const profit = item.estimated_profit_usd;
  if (profit === null) {
    return {
      background: colors.surfaceMuted,
      color: colors.textMuted,
      label: "資料不足",
      tone: "default" as const,
      value: "無法估算",
    };
  }
  if (profit > 0) {
    return {
      background: colors.mintSoft,
      color: "#08785F",
      label: `預估可賺 $${formatMoney(profit)}`,
      tone: "positive" as const,
      value: `+$${formatMoney(profit)}`,
    };
  }
  return {
    background: colors.redSoft,
    color: colors.red,
    label: `可能高估 $${formatMoney(Math.abs(profit))}`,
    tone: "negative" as const,
    value: `-$${formatMoney(Math.abs(profit))}`,
  };
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatScanTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "近期";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function TypingBubble() {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderCurve: "continuous",
        borderRadius: 18,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 13,
        paddingVertical: 11,
      }}
    >
      <ActivityIndicator color={colors.blue} size="small" />
      <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "800" }}>
        Thinking
      </Text>
    </View>
  );
}
