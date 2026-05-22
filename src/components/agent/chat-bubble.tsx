import { Brain, ExternalLink, ShoppingBag, TrendingDown, TrendingUp } from "lucide-react-native";
import { Image, Linking, Pressable, Text, View } from "react-native";

import { colors, radii } from "@/theme/tokens";
import type { AgentMessage, RenaissAnalysisMessage } from "@/types/agent";
import type { RenaissAiReviewResponse } from "@/types/renaiss-monitor";

type ChatBubbleProps = {
  message: AgentMessage;
};

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.from === "user";
  const isSystem = message.from === "system";

  if (message.renaissAnalysis && !isUser) {
    return (
      <View style={{ alignSelf: "flex-start", maxWidth: "96%", width: "100%" }}>
        <RenaissAnalysisCard payload={message.renaissAnalysis} timestamp={message.timestamp} />
      </View>
    );
  }

  return (
    <View
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        backgroundColor: isUser ? colors.ink : isSystem ? colors.amberSoft : colors.surface,
        borderColor: isSystem ? colors.amberSoft : colors.border,
        borderCurve: "continuous",
        borderRadius: 20,
        borderWidth: isUser ? 0 : 1,
        maxWidth: "86%",
        paddingHorizontal: 15,
        paddingVertical: 11,
      }}
    >
      <Text
        style={{
          color: isUser ? "#FFFFFF" : colors.text,
          fontSize: 15,
          lineHeight: 21,
        }}
      >
        {message.text}
      </Text>
      {!isUser && message.model ? <SourceBadge model={message.model} /> : null}
      <Text
        style={{
          alignSelf: "flex-end",
          color: isUser ? "rgba(255,255,255,0.72)" : colors.textSoft,
          fontSize: 11,
          paddingTop: 5,
        }}
      >
        {message.timestamp}
      </Text>
    </View>
  );
}

function RenaissAnalysisCard({
  payload,
  timestamp,
}: {
  payload: RenaissAnalysisMessage;
  timestamp: string;
}) {
  const { item, review } = payload;
  const verdict = getVerdictMeta(review.verdict);
  const priceChartingUrl = item.sources.pricecharting.url;
  const snkrdunkUrl = item.sources.snkrdunk.url;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderCurve: "continuous",
        borderRadius: 24,
        borderWidth: 1,
        gap: 14,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: "row", gap: 12 }}>
        {item.image_url ? (
          <Image
            source={{ uri: item.image_url }}
            style={{
              backgroundColor: colors.surfaceStrong,
              borderRadius: 12,
              height: 124,
              width: 92,
            }}
          />
        ) : null}
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <View
              style={{
                backgroundColor: verdict.background,
                borderRadius: radii.pill,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: verdict.text, fontSize: 12, fontWeight: "900" }}>
                {verdict.label} / 信心 {review.confidence}%
              </Text>
            </View>
            <View
              style={{
                alignItems: "center",
                backgroundColor: colors.surfaceMuted,
                borderRadius: radii.pill,
                flexDirection: "row",
                gap: 5,
                paddingHorizontal: 9,
                paddingVertical: 6,
              }}
            >
              {getTrendIcon(review.trendSummary)}
              <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "900" }}>
                {getTrendLabel(review.trendSummary)}
              </Text>
            </View>
          </View>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", lineHeight: 21 }}>
            {item.name}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "800", lineHeight: 18 }}>
            Ask ${formatMoney(item.ask_price_usd)} / {formatOpportunityEdge(item)}
          </Text>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 18 }}>
            {review.headline}
          </Text>
        </View>
      </View>

      <InfoBlock title="價格重點" value={review.priceSummary} />
      <InfoBlock title="走勢判斷" value={review.trendSummary} />
      <InfoList title="我看到的重點" values={review.reasons.slice(0, 3)} />
      <InfoList title="主要風險" values={review.riskFlags.slice(0, 3)} tone="danger" />

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
          來源連結
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <LinkChip label="RENAISS 商品頁" url={item.renaiss_url} />
          <LinkChip label="PriceCharting" url={priceChartingUrl} />
          <LinkChip label="SNKRDUNK" url={snkrdunkUrl} />
        </View>
      </View>

      <SourceBadge model={review.model} />

      <View
        style={{
          backgroundColor: colors.blueSoft,
          borderRadius: 18,
          gap: 8,
          padding: 12,
        }}
      >
        <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
          <ShoppingBag color={colors.blue} size={16} strokeWidth={2.5} />
          <Text style={{ color: colors.text, flex: 1, fontSize: 13, fontWeight: "900" }}>
            要我幫你準備購買嗎？
          </Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", lineHeight: 17 }}>
          如果你要買，直接回「幫我買這張」。我會建立購買審核 intent，先核對卡片、價格、來源和交易風險，最後仍需要你確認。
        </Text>
      </View>

      <Text style={{ alignSelf: "flex-end", color: colors.textSoft, fontSize: 11 }}>
        {timestamp}
      </Text>
    </View>
  );
}

function SourceBadge({ model }: { model: string }) {
  const isAi = !model.startsWith("deterministic-")
    && model !== "bitrefill-api"
    && model !== "puffer-sdk"
    && model !== "renaiss-monitor"
    && model !== "renaiss-order-review";
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: isAi ? colors.blueSoft : colors.surfaceMuted,
        borderColor: isAi ? colors.blueSoft : colors.border,
        borderWidth: 1,
        borderRadius: radii.pill,
        marginTop: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text style={{ color: isAi ? colors.blue : colors.text, fontSize: 11, fontWeight: "900" }}>
        {isAi ? `AI：${model}` : `資料工具：${model}`}
      </Text>
    </View>
  );
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  if (!value) return null;
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
        {title}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "800", lineHeight: 18 }}>
        {value}
      </Text>
    </View>
  );
}

function InfoList({
  title,
  tone = "default",
  values,
}: {
  title: string;
  tone?: "danger" | "default";
  values: string[];
}) {
  if (values.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
        {title}
      </Text>
      {values.map((value) => (
        <View key={value} style={{ flexDirection: "row", gap: 7 }}>
          <Text style={{ color: tone === "danger" ? colors.red : colors.blue, fontSize: 12, fontWeight: "900" }}>
            •
          </Text>
          <Text style={{ color: colors.textMuted, flex: 1, fontSize: 13, fontWeight: "800", lineHeight: 18 }}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LinkChip({ label, url }: { label: string; url?: string | null }) {
  if (!url) return null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(url);
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.pill,
        flexDirection: "row",
        gap: 6,
        opacity: pressed ? 0.72 : 1,
        paddingHorizontal: 11,
        paddingVertical: 8,
      })}
    >
      <ExternalLink color={colors.textMuted} size={13} strokeWidth={2.4} />
      <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "900" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function getVerdictMeta(verdict: RenaissAiReviewResponse["verdict"]) {
  if (verdict === "buy_candidate") {
    return { background: colors.mintSoft, label: "可考慮", text: "#08785F" };
  }
  if (verdict === "avoid") {
    return { background: colors.redSoft, label: "先不要", text: colors.red };
  }
  return { background: colors.amberSoft, label: "觀望", text: "#9B5C00" };
}

function getTrendIcon(summary: string) {
  const lower = summary.toLowerCase();
  if (lower.includes("down") || summary.includes("下")) {
    return <TrendingDown color={colors.red} size={13} strokeWidth={2.4} />;
  }
  if (lower.includes("up") || summary.includes("上")) {
    return <TrendingUp color="#08785F" size={13} strokeWidth={2.4} />;
  }
  return <Brain color={colors.textMuted} size={13} strokeWidth={2.4} />;
}

function getTrendLabel(summary: string) {
  const lower = summary.toLowerCase();
  if (lower.includes("down") || summary.includes("下")) return "走弱";
  if (lower.includes("up") || summary.includes("上")) return "走強";
  return "需觀察";
}

function formatOpportunityEdge(item: RenaissAnalysisMessage["item"]) {
  const diff = item.estimated_diff_pct === null ? "無明確價差" : `${item.estimated_diff_pct.toFixed(1)}%`;
  const profit = item.estimated_profit_usd === null ? "" : ` / 預估 $${formatMoney(item.estimated_profit_usd)}`;
  return `${item.best_market ?? "無市場均價"} / ${diff}${profit}`;
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}
