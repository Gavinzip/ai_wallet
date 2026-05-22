import type { PropsWithChildren } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";

import { colors } from "@/theme/tokens";

type ScreenProps = PropsWithChildren<{
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
}>;

export function Screen({ children, contentContainerStyle }: ScreenProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={[
        {
          gap: 24,
          paddingBottom: 124,
          paddingHorizontal: 22,
          paddingTop: 22,
        },
        contentContainerStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
}
