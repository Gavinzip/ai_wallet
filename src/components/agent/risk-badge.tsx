import { Text, View } from "react-native";

import { colors, radii } from "@/theme/tokens";
import type { RiskSeverity } from "@/types/security";

type RiskBadgeProps = {
  severity: RiskSeverity;
};

const severityTheme: Record<RiskSeverity, { background: string; color: string; label: string }> = {
  block: { background: colors.redSoft, color: colors.red, label: "Block" },
  danger: { background: colors.redSoft, color: colors.red, label: "Danger" },
  info: { background: colors.blueSoft, color: colors.blue, label: "Info" },
  warning: { background: colors.amberSoft, color: "#B26A00", label: "Warning" },
};

export function RiskBadge({ severity }: RiskBadgeProps) {
  const theme = severityTheme[severity];

  return (
    <View
      style={{
        backgroundColor: theme.background,
        borderRadius: radii.pill,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text style={{ color: theme.color, fontSize: 12, fontWeight: "800" }}>
        {theme.label}
      </Text>
    </View>
  );
}
