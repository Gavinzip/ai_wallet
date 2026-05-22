import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, shadows } from "@/theme/tokens";

type MotionTabItemProps = {
  focused: boolean;
  label: string;
  icon: ReactNode;
  onPress: () => void;
};

function MotionTabItem({ focused, icon, label, onPress }: MotionTabItemProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  const press = useSharedValue(0);
  const [labelWidth, setLabelWidth] = useState(0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, { duration: 210 });
  }, [focused, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: focused ? colors.blue : "transparent",
    transform: [
      {
        scale: withSpring(interpolate(press.value, [0, 1], [1, 0.94])),
      },
    ],
    width: 48 + progress.value * Math.min(labelWidth + 26, 86),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-8, 0]) }],
    width: progress.value * Math.min(labelWidth + 10, 74),
  }));

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: 110 });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: 160 });
      }}
      style={{ minHeight: 52 }}
    >
      <Text
        numberOfLines={1}
        onLayout={(event) => setLabelWidth(Math.ceil(event.nativeEvent.layout.width))}
        style={{ fontSize: 14, fontWeight: "700", opacity: 0, position: "absolute" }}
      >
        {label}
      </Text>
      <Animated.View
        style={[
          {
            alignItems: "center",
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 8,
            height: 52,
            justifyContent: "center",
            overflow: "hidden",
            paddingHorizontal: 14,
          },
          animatedStyle,
        ]}
      >
        {icon}
        <Animated.View style={[{ overflow: "hidden" }, labelStyle]}>
          <Text
            numberOfLines={1}
            style={{
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: "700",
            }}
          >
            {label}
          </Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export function WalletMotionTabBar({ descriptors, navigation, state }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const items = useMemo(
    () =>
      state.routes
        .map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : typeof options.title === "string"
                ? options.title
                : route.name;

          if ((options as { href?: unknown }).href === null) {
            return null;
          }

          return {
            index,
            key: route.key,
            label,
            routeName: route.name,
            renderIcon: options.tabBarIcon,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [descriptors, state.routes],
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        alignItems: "center",
        bottom: Math.max(insets.bottom, 14),
        left: 0,
        position: "absolute",
        right: 0,
      }}
    >
      <BlurView
        intensity={78}
        tint="light"
        style={{
          backgroundColor: "rgba(255,255,255,0.84)",
          borderColor: "rgba(255,255,255,0.9)",
          borderRadius: radii.pill,
          borderWidth: 1,
          boxShadow: shadows.dock,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 4,
            minHeight: 66,
            paddingHorizontal: 8,
            paddingVertical: 7,
          }}
        >
          {items.map((item) => {
            const focused = state.index === item.index;
            const iconColor = focused ? "#FFFFFF" : colors.text;
            const icon = item.renderIcon?.({
              color: iconColor,
              focused,
              size: 23,
            });

            return (
              <MotionTabItem
                key={item.key}
                focused={focused}
                icon={icon}
                label={item.label}
                onPress={() => {
                  if (process.env.EXPO_OS === "ios") {
                    Haptics.selectionAsync();
                  }

                  const event = navigation.emit({
                    canPreventDefault: true,
                    target: item.key,
                    type: "tabPress",
                  });

                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(item.routeName);
                  }
                }}
              />
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}
