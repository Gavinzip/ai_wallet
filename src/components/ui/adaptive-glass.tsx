import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

type AdaptiveGlassProps = PropsWithChildren<{
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}>;

export function AdaptiveGlass({ children, intensity = 72, style }: AdaptiveGlassProps) {
  if (isLiquidGlassAvailable()) {
    return <GlassView style={style}>{children}</GlassView>;
  }

  if (process.env.EXPO_OS === "web") {
    return <View style={style}>{children}</View>;
  }

  return (
    <BlurView intensity={intensity} tint="systemMaterial" style={style}>
      {children}
    </BlurView>
  );
}
