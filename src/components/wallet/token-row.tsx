import { Text, View } from "react-native";

import { MiniSparkline } from "@/components/wallet/mini-sparkline";
import { colors, radii } from "@/theme/tokens";
import type { WalletToken } from "@/types/wallet";
import { formatSignedPercent } from "@/utils/format";

type TokenRowProps = {
  token: WalletToken;
};

export function TokenRow({ token }: TokenRowProps) {
  const isPositive = token.change >= 0;
  const changeColor = isPositive ? colors.mint : colors.red;

  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 78,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: token.accent,
          borderRadius: radii.pill,
          height: 52,
          justifyContent: "center",
          width: 52,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "700" }}>
          {token.iconLabel}
        </Text>
      </View>

      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.text, fontSize: 23, fontWeight: "500" }}
        >
          {token.name}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSoft, fontSize: 18 }}>
          {token.symbol}
        </Text>
      </View>

      <View style={{ alignItems: "center", minWidth: 78 }}>
        <MiniSparkline color={changeColor} data={token.sparkline} />
      </View>

      <View style={{ alignItems: "flex-end", minWidth: 86 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            fontVariant: ["tabular-nums"],
            fontWeight: "500",
          }}
        >
          {token.fiatValue}
        </Text>
        <Text
          style={{
            color: changeColor,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
            fontWeight: "600",
          }}
        >
          {formatSignedPercent(token.change)}
        </Text>
      </View>
    </View>
  );
}
