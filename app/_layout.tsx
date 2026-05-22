import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { TokenCoreSmokeTest } from "@/dev/token-core-smoke-test";
import { RenaissRecommendationsProvider } from "@/state/renaiss-recommendations-context";
import { SkillRegistryProvider } from "@/state/skill-registry-context";
import { colors } from "@/theme/tokens";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SkillRegistryProvider>
          <RenaissRecommendationsProvider>
            <TokenCoreSmokeTest />
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: colors.background },
                headerShown: false,
              }}
            >
              <Stack.Screen name="(tabs)" />
            </Stack>
          </RenaissRecommendationsProvider>
        </SkillRegistryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
