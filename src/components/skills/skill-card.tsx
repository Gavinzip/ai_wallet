import { ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { RiskBadge } from "@/components/agent/risk-badge";
import { colors, radii, shadows } from "@/theme/tokens";
import type { AgentSkill } from "@/types/agent";

type SkillCardProps = {
  skill: AgentSkill;
  onToggle: (id: string) => void;
};

export function SkillCard({ onToggle, skill }: SkillCardProps) {
  const ToggleIcon = skill.enabled ? ToggleRight : ToggleLeft;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: skill.enabled ? colors.border : colors.surfaceStrong,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 14,
        opacity: skill.enabled ? 1 : 0.62,
        padding: 16,
      }}
    >
      <View
        style={{
          alignItems: "flex-start",
          flexDirection: "row",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>
            {skill.name}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
            {skill.description}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: skill.enabled }}
          onPress={() => onToggle(skill.id)}
          style={{ padding: 2 }}
        >
          <ToggleIcon
            color={skill.enabled ? colors.blue : colors.textSoft}
            size={34}
            strokeWidth={2.2}
          />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <RiskBadge severity={skill.riskLevel} />
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <ShieldCheck color={colors.textMuted} size={13} strokeWidth={2.4} />
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
            {skill.source}
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "800" }}>
            TRIGGER
          </Text>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
            {skill.trigger}
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "800" }}>
            POLICY
          </Text>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
            {skill.policySummary}
          </Text>
        </View>
      </View>
    </View>
  );
}
