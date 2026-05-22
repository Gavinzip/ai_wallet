import { Pressable, Text, View } from "react-native";

import { TokenRow } from "@/components/wallet/token-row";
import { colors, radii } from "@/theme/tokens";
import type { WalletToken } from "@/types/wallet";

type TokenListProps = {
  tokens: WalletToken[];
};

export function TokenList({ tokens }: TokenListProps) {
  return (
    <View style={{ gap: 22 }}>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: colors.textMuted, fontSize: 22, fontWeight: "500" }}>
          Explore tokens
        </Text>
        <Pressable
          accessibilityLabel="Manage tokens"
          accessibilityRole="button"
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.pill,
            borderWidth: 1,
            paddingHorizontal: 18,
            paddingVertical: 10,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>
            Manage
          </Text>
        </Pressable>
      </View>
      {tokens.length > 0 ? (
        <View style={{ gap: 18 }}>
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} />
          ))}
        </View>
      ) : (
        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.lg,
            borderWidth: 1,
            gap: 8,
            padding: 18,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>
            No verified balances loaded
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
            Balance rows will appear only after Token Core wallet access and a real chain balance provider are connected.
          </Text>
        </View>
      )}
    </View>
  );
}
