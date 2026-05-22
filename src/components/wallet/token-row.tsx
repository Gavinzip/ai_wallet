import { Text, View } from "react-native";

import { MiniSparkline } from "@/components/wallet/mini-sparkline";
import { colors, radii } from "@/theme/tokens";
import type { WalletToken } from "@/types/wallet";
import { formatSignedPercent } from "@/utils/format";

type TokenRowProps = {
  token: WalletToken;
};

export function TokenRow({ token }: TokenRowProps) {
  const hasMarketData = typeof token.change === "number" && token.sparkline.length > 0;
  const isPositive = (token.change ?? 0) >= 0;
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
          {token.chain ? `${token.symbol} · ${token.chain}` : token.symbol}
        </Text>
      </View>

      {hasMarketData ? (
        <View style={{ alignItems: "center", minWidth: 78 }}>
          <MiniSparkline color={changeColor} data={token.sparkline} />
        </View>
      ) : null}

      <View style={{ alignItems: "flex-end", minWidth: 120 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 18,
            fontVariant: ["tabular-nums"],
            fontWeight: "800",
          }}
        >
          {token.balanceLabel}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: hasMarketData ? changeColor : colors.textSoft,
            fontSize: 12,
            fontVariant: ["tabular-nums"],
            fontWeight: "600",
            maxWidth: 160,
          }}
        >
          {hasMarketData ? formatSignedPercent(token.change ?? 0) : token.fiatValue}
        </Text>
      </View>
    </View>
  );
}
