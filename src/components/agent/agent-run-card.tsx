import { Check, Circle, Loader2, ShieldAlert } from "lucide-react-native";
import { Text, View } from "react-native";

import { colors, radii, shadows } from "@/theme/tokens";
import type { AgentRunStep, AgentStepStatus } from "@/types/agent";

type AgentRunCardProps = {
  steps: AgentRunStep[];
};

function StepIcon({ status }: { status: AgentStepStatus }) {
  const iconProps = { size: 17, strokeWidth: 2.4 };

  if (status === "done") return <Check color="#FFFFFF" {...iconProps} />;
  if (status === "active") return <Loader2 color="#FFFFFF" {...iconProps} />;
  if (status === "blocked") return <ShieldAlert color="#FFFFFF" {...iconProps} />;
  return <Circle color={colors.textMuted} {...iconProps} />;
}

function statusColor(status: AgentStepStatus) {
  if (status === "done") return colors.mint;
  if (status === "active") return colors.blue;
  if (status === "blocked") return colors.red;
  return colors.surfaceStrong;
}

export function AgentRunCard({ steps }: AgentRunCardProps) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 18,
        padding: 18,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "700" }}>
          RENAISS Automation Status
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          This skill stays inactive until the real marketplace detector and wallet execution path are connected.
        </Text>
      </View>

      <View style={{ gap: 14 }}>
        {steps.map((step) => (
          <View key={step.id} style={{ flexDirection: "row", gap: 12 }}>
            <View
              style={{
                alignItems: "center",
                backgroundColor: statusColor(step.status),
                borderRadius: radii.pill,
                height: 28,
                justifyContent: "center",
                marginTop: 2,
                width: 28,
              }}
            >
              <StepIcon status={step.status} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                {step.label}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
                {step.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
