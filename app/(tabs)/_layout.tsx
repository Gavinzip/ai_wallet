import { Tabs } from "expo-router";
import { Bot, Clock3, House, WandSparkles } from "lucide-react-native";

import { WalletMotionTabBar } from "@/components/navigation/wallet-motion-tab-bar";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <WalletMotionTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, size }) => (
            <House color={color} size={size} strokeWidth={2.3} />
          ),
          tabBarLabel: "Wallet",
        }}
      />
      <Tabs.Screen
        name="agent"
        options={{
          title: "Agent",
          tabBarIcon: ({ color, size }) => (
            <Bot color={color} size={size} strokeWidth={2.3} />
          ),
          tabBarLabel: "Agent",
        }}
      />
      <Tabs.Screen
        name="skills"
        options={{
          title: "Skills",
          tabBarIcon: ({ color, size }) => (
            <WandSparkles color={color} size={size} strokeWidth={2.3} />
          ),
          tabBarLabel: "Skills",
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarIcon: ({ color, size }) => (
            <Clock3 color={color} size={size} strokeWidth={2.3} />
          ),
          tabBarLabel: "Activity",
        }}
      />
    </Tabs>
  );
}
