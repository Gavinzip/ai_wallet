import * as Haptics from "expo-haptics";
import { Pressable, ScrollView, Text, View } from "react-native";

import { colors, radii, shadows } from "@/theme/tokens";
import type { WalletAction } from "@/types/wallet";

type ActionRailProps = {
  actions: WalletAction[];
  disabledActionIds?: WalletAction["id"][];
  onActionPress: (action: WalletAction) => void;
};

export function ActionRail({ actions, disabledActionIds = [], onActionPress }: ActionRailProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingVertical: 6 }}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        const accent =
          action.tone === "agent"
            ? colors.blue
            : action.tone === "receive"
              ? colors.mint
              : colors.text;
        const disabled = disabledActionIds.includes(action.id);

        return (
          <Pressable
            key={action.id}
            accessibilityLabel={action.label}
            accessibilityRole="button"
            onPress={() => {
              if (process.env.EXPO_OS === "ios") {
                void Haptics.selectionAsync();
              }
              onActionPress(action);
            }}
            style={({ pressed }) => ({
              backgroundColor: colors.surface,
              borderColor: action.tone === "agent" ? colors.blueSoft : colors.border,
              borderRadius: radii.lg,
              borderWidth: 1,
              boxShadow: shadows.button,
              gap: 22,
              minHeight: 132,
              opacity: disabled ? 0.42 : pressed ? 0.72 : 1,
              padding: 22,
              width: 154,
            })}
          >
            <View
              style={{
                alignItems: "center",
                backgroundColor: action.tone === "agent" ? colors.blueSoft : colors.surfaceMuted,
                borderRadius: radii.pill,
                height: 42,
                justifyContent: "center",
                width: 42,
              }}
            >
              <Icon color={accent} size={24} strokeWidth={2.1} />
            </View>
            <Text style={{ color: colors.text, fontSize: 21, fontWeight: "500" }}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
