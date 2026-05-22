import {
  Bot,
  Check,
  Clock3,
  Globe2,
  MonitorSmartphone,
  Puzzle,
  ShieldAlert,
} from "lucide-react-native";
import { Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { activityItems, type ActivityItem } from "@/data/activity";
import { colors, radii, shadows } from "@/theme/tokens";

function iconForStatus(status: ActivityItem["status"]) {
  if (status === "done") {
    return { background: colors.mint, icon: Check };
  }

  if (status === "review") {
    return { background: colors.amber, icon: ShieldAlert };
  }

  return { background: colors.surfaceStrong, icon: Clock3 };
}

function iconForSurface(surface: ActivityItem["surface"]) {
  if (surface === "mobile") return MonitorSmartphone;
  if (surface === "web") return Globe2;
  if (surface === "extension") return Puzzle;
  return Bot;
}

const statusCopy: Record<ActivityItem["status"], string> = {
  done: "Ready",
  review: "Needs review",
  waiting: "Waiting",
};

export function ActivityWorkspace() {
  const readyCount = activityItems.filter((item) => item.status === "done").length;
  const reviewCount = activityItems.filter((item) => item.status === "review").length;

  return (
    <Screen>
      <View
        style={{
          backgroundColor: colors.ink,
          borderCurve: "continuous",
          borderRadius: 30,
          boxShadow: "0 18px 48px rgba(17,17,19,0.18)",
          gap: 18,
          overflow: "hidden",
          padding: 20,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 31, fontWeight: "900", letterSpacing: 0 }}>
            Activity
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.66)", fontSize: 14, lineHeight: 20 }}>
            Real wallet surfaces, agent decisions, and pending safety gates.
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <MetricPill label="Ready" value={readyCount} />
          <MetricPill label="Review" value={reviewCount} />
          <MetricPill label="Fake data" value={0} />
        </View>
      </View>

      <View
        style={{
          gap: 12,
        }}
      >
        {activityItems.map((item) => {
          const theme = iconForStatus(item.status);
          const Icon = theme.icon;
          const SurfaceIcon = iconForSurface(item.surface);

          return (
            <View
              key={item.id}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderCurve: "continuous",
                borderRadius: radii.lg,
                borderWidth: 1,
                boxShadow: shadows.soft,
                gap: 14,
                padding: 15,
              }}
            >
              <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: theme.background,
                    borderRadius: radii.pill,
                    height: 38,
                    justifyContent: "center",
                    width: 38,
                  }}
                >
                  <Icon color="#FFFFFF" size={19} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                    {item.title}
                  </Text>
                  <View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>
                    <SurfaceIcon color={colors.textMuted} size={13} strokeWidth={2.4} />
                    <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
                      {item.surface.toUpperCase()} / {item.time}
                    </Text>
                  </View>
                </View>
                <View
                  style={{
                    backgroundColor:
                      item.status === "done"
                        ? colors.mintSoft
                        : item.status === "review"
                          ? colors.amberSoft
                          : colors.surfaceMuted,
                    borderRadius: radii.pill,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                  }}
                >
                  <Text
                    style={{
                      color:
                        item.status === "done"
                          ? "#1BA681"
                          : item.status === "review"
                            ? "#B77900"
                            : colors.textMuted,
                      fontSize: 11,
                      fontWeight: "900",
                    }}
                  >
                    {statusCopy[item.status]}
                  </Text>
                </View>
              </View>

              <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
                {item.detail}
              </Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        backgroundColor: "rgba(255,255,255,0.1)",
        borderColor: "rgba(255,255,255,0.12)",
        borderRadius: radii.pill,
        borderWidth: 1,
        flex: 1,
        gap: 2,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>{value}</Text>
      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "900" }}>
        {label}
      </Text>
    </View>
  );
}
