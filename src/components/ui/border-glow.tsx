import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

type BorderGlowProps = PropsWithChildren<{
  active?: boolean;
  animated?: boolean;
  backgroundColor?: string;
  borderRadius?: number;
  className?: string;
  colors?: string[];
  coneSpread?: number;
  contentStyle?: StyleProp<ViewStyle>;
  edgeSensitivity?: number;
  fillOpacity?: number;
  glowColor?: string;
  glowIntensity?: number;
  glowRadius?: number;
  style?: StyleProp<ViewStyle>;
}>;

function parseHSL(hslStr: string) {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 40, l: 80, s: 80 };
  return { h: Number.parseFloat(match[1]), s: Number.parseFloat(match[2]), l: Number.parseFloat(match[3]) };
}

function hslToRgba(hslStr: string, alpha: number) {
  const { h, s, l } = parseHSL(hslStr);
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = h / 60;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = lightness - chroma / 2;
  const [r1, g1, b1] =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function BorderGlow({
  active = false,
  animated = false,
  backgroundColor = "rgba(255,255,255,0.62)",
  borderRadius = 28,
  children,
  colors = ["#C084FC", "#F472B6", "#38BDF8"],
  contentStyle,
  edgeSensitivity = 30,
  glowColor = "210 90 62",
  glowIntensity = 1,
  glowRadius = 40,
  style,
}: BorderGlowProps) {
  const progress = useSharedValue(active || animated ? 1 : 0);
  const sweep = useSharedValue(0);
  const minOpacity = Math.max(0.18, Math.min(edgeSensitivity / 100, 0.72));

  useEffect(() => {
    progress.value = withTiming(active || animated ? 1 : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, animated, progress]);

  useEffect(() => {
    if (!animated) {
      sweep.value = withTiming(0, {
        duration: 320,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    sweep.value = withRepeat(
      withTiming(1, {
        duration: 5200,
        easing: Easing.inOut(Easing.cubic),
      }),
      -1,
      false,
    );
  }, [animated, sweep]);

  const ringStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 1], [minOpacity, 1]);
    const borderColor = interpolateColor(
      sweep.value,
      [0, 0.33, 0.66, 1],
      [
        colors[0] ?? "#38BDF8",
        colors[1] ?? "#41DDB3",
        colors[2] ?? "#F472B6",
        colors[0] ?? "#38BDF8",
      ],
    );

    return {
      borderColor,
      opacity,
    };
  });

  return (
    <Animated.View
      entering={FadeIn.duration(240)}
      style={[
        {
          backgroundColor,
          borderRadius,
          boxShadow: `0 18px ${Math.max(34, glowRadius + 8)}px ${hslToRgba(
            glowColor,
            0.11 * glowIntensity,
          )}`,
          isolation: "isolate",
          overflow: "visible",
          position: "relative",
        },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius,
            borderWidth: 1.2,
          },
          ringStyle,
        ]}
      />
      <View style={[{ borderRadius, overflow: "hidden", position: "relative" }, contentStyle]}>
        {children}
      </View>
    </Animated.View>
  );
}
