import * as Haptics from "expo-haptics";
import { Copy, Settings2 } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { colors, radii, shadows } from "@/theme/tokens";
import type { WalletSummary } from "@/types/wallet";
import { shortenAddress } from "@/utils/format";

type WalletHeaderProps = {
  summary: WalletSummary;
};

export function WalletHeader({ summary }: WalletHeaderProps) {
  const handleCopy = () => {
    if (process.env.EXPO_OS === "ios") {
      Haptics.selectionAsync();
    }
  };

  return (
    <View style={{ gap: 26 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 14 }}>
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.blueSoft,
            borderRadius: radii.pill,
            height: 58,
            justifyContent: "center",
            overflow: "hidden",
            width: 58,
          }}
        >
          <View
            style={{
              backgroundColor: colors.blue,
              borderRadius: radii.pill,
              height: 36,
              opacity: 0.82,
              position: "absolute",
              right: 4,
              top: 18,
              width: 36,
            }}
          />
          <View
            style={{
              backgroundColor: colors.mint,
              borderRadius: radii.pill,
              height: 34,
              left: 5,
              opacity: 0.72,
              position: "absolute",
              top: 8,
              width: 34,
            }}
          />
          <View
            style={{
              backgroundColor: colors.violet,
              borderRadius: radii.pill,
              bottom: 8,
              height: 32,
              opacity: 0.7,
              position: "absolute",
              right: 8,
              width: 32,
            }}
          />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "600" }}>
            {summary.name}
          </Text>
          {summary.address ? (
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
              <Text selectable style={{ color: colors.textMuted, fontSize: 17 }}>
                {shortenAddress(summary.address, 6, 4)}
              </Text>
              <Pressable
                accessibilityLabel="Copy wallet address"
                accessibilityRole="button"
                onPress={handleCopy}
                style={{ padding: 4 }}
              >
                <Copy color={colors.textMuted} size={18} strokeWidth={2} />
              </Pressable>
            </View>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: 17 }}>
              No verified wallet loaded
            </Text>
          )}
        </View>

        <Pressable
          accessibilityLabel="Wallet settings"
          accessibilityRole="button"
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.pill,
            borderWidth: 1,
            boxShadow: shadows.button,
            height: 46,
            justifyContent: "center",
            width: 46,
          }}
        >
          <Settings2 color={colors.text} size={22} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 52,
            fontVariant: ["tabular-nums"],
            fontWeight: "500",
            letterSpacing: 0,
          }}
        >
          {summary.totalValue ?? "--"}
        </Text>
        {summary.dailyPnl ? (
          <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
            <Text
              style={{
                color: summary.dailyPnlTone === "positive" ? colors.mint : colors.red,
                fontSize: 19,
                fontWeight: "600",
              }}
            >
              {summary.dailyPnl.split(" ")[0]}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 18 }}>today</Text>
          </View>
        ) : null}
        <Text selectable style={{ color: colors.textSoft, fontSize: 13 }}>
          {summary.integrationMode === "token-core-native"
            ? summary.statusMessage
            : summary.statusMessage}
        </Text>
      </View>
    </View>
  );
}
