import { ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";

import { RiskBadge } from "@/components/agent/risk-badge";
import { evaluatePermitReview } from "@/security/risk-policy";
import { colors, radii, shadows } from "@/theme/tokens";
import type { PermitReview } from "@/types/security";

type PermitReviewCardProps = {
  review: PermitReview;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.text,
          fontSize: 14,
          lineHeight: 19,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function PermitReviewCard({ review }: PermitReviewCardProps) {
  const decision = evaluatePermitReview(review);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 16,
        padding: 18,
      }}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 21, fontWeight: "800" }}>
            {review.title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>{review.chain}</Text>
        </View>
        <RiskBadge severity={decision.severity} />
      </View>

      <View
        style={{
          backgroundColor: colors.mintSoft,
          borderRadius: radii.md,
          flexDirection: "row",
          gap: 10,
          padding: 12,
        }}
      >
        <ShieldCheck color={colors.mint} size={19} strokeWidth={2.3} />
        <Text style={{ color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 }}>
          {decision.reasons.join(" ")}
        </Text>
      </View>

      <View style={{ gap: 14 }}>
        <Row label="TOKEN" value={review.token} />
        <Row label="AMOUNT" value={review.amount} />
        <Row label="SPENDER CONTRACT" value={review.spender} />
        <Row label="RECIPIENT WALLET" value={review.recipient} />
        <Row label="WITNESS" value={review.witness} />
      </View>

      <View style={{ gap: 8 }}>
        {review.notes.map((note) => (
          <Text key={note} style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            - {note}
          </Text>
        ))}
      </View>
    </View>
  );
}
