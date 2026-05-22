import {
  ArrowLeftRight,
  Check,
  Clock3,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Wallet2,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import {
  loadWalletActivityRecords,
  subscribeWalletActivityRecords,
  type WalletActivityRecord,
} from "@/services/activity/wallet-activity-log";
import { colors, radii, shadows } from "@/theme/tokens";

const statusCopy: Record<WalletActivityRecord["status"], string> = {
  created: "Created",
  restored: "Restored",
  saved: "Saved",
  signed: "Signed",
  submitted: "Submitted",
};

export function ActivityWorkspace() {
  const [records, setRecords] = useState<WalletActivityRecord[]>(() => loadWalletActivityRecords());

  useEffect(() => {
    const refresh = () => setRecords(loadWalletActivityRecords());
    refresh();
    return subscribeWalletActivityRecords(refresh);
  }, []);

  const metrics = useMemo(
    () => ({
      signatures: records.filter((record) => record.kind === "message_signature").length,
      transactions: records.filter((record) => record.kind === "transaction").length,
      walletEvents: records.filter((record) => record.kind !== "transaction" && record.kind !== "message_signature").length,
    }),
    [records],
  );

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
            Real local wallet history only. No placeholder transactions are shown.
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <MetricPill label="Tx" value={metrics.transactions} />
          <MetricPill label="Signed" value={metrics.signatures} />
          <MetricPill label="Wallet" value={metrics.walletEvents} />
        </View>
      </View>

      {records.length === 0 ? <EmptyActivityState /> : null}

      <View style={{ gap: 12 }}>
        {records.map((record) => (
          <ActivityRecordCard key={record.id} record={record} />
        ))}
      </View>
    </Screen>
  );
}

function ActivityRecordCard({ record }: { record: WalletActivityRecord }) {
  const theme = themeForRecord(record);
  const Icon = theme.icon;

  return (
    <View
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
          <Icon color={theme.iconColor} size={19} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
            {record.title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
            {formatActivityTime(record.timestamp)}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: theme.statusBackground,
            borderRadius: radii.pill,
            paddingHorizontal: 10,
            paddingVertical: 7,
          }}
        >
          <Text style={{ color: theme.statusText, fontSize: 11, fontWeight: "900" }}>
            {statusCopy[record.status]}
          </Text>
        </View>
      </View>

      <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
        {record.detail}
      </Text>

      <View style={{ gap: 7 }}>
        {record.chain ? <DetailRow label="CHAIN" value={record.chain} /> : null}
        {record.token ? <DetailRow label="TOKEN" value={record.token} /> : null}
        {record.amount ? <DetailRow label="AMOUNT" value={record.amount} /> : null}
        {record.to ? <DetailRow label="TO" value={record.to} /> : null}
        {record.txHash ? <DetailRow label="TX HASH" value={record.txHash} /> : null}
      </View>

      {record.explorerUrl ? (
        <Pressable
          accessibilityLabel="Open transaction in block explorer"
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(record.explorerUrl ?? "");
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            alignSelf: "flex-start",
            backgroundColor: colors.blueSoft,
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 8,
            opacity: pressed ? 0.72 : 1,
            paddingHorizontal: 12,
            paddingVertical: 9,
          })}
        >
          <ExternalLink color={colors.blue} size={14} strokeWidth={2.4} />
          <Text style={{ color: colors.blue, fontSize: 12, fontWeight: "900" }}>
            Open explorer
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyActivityState() {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 12,
        padding: 20,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.surfaceMuted,
          borderRadius: radii.pill,
          height: 48,
          justifyContent: "center",
          width: 48,
        }}
      >
        <Clock3 color={colors.textMuted} size={21} strokeWidth={2.4} />
      </View>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
          No wallet activity yet
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
          Transactions appear here only after Token Core signs and submits a real on-chain transaction.
        </Text>
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "900", width: 72 }}>
        {label}
      </Text>
      <Text
        selectable
        style={{ color: colors.text, flex: 1, fontSize: 12, fontWeight: "800", lineHeight: 17 }}
      >
        {value}
      </Text>
    </View>
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

function themeForRecord(record: WalletActivityRecord) {
  if (record.kind === "transaction") {
    return {
      background: colors.mintSoft,
      icon: ArrowLeftRight,
      iconColor: "#1BA681",
      statusBackground: colors.mintSoft,
      statusText: "#1BA681",
    };
  }
  if (record.kind === "message_signature") {
    return {
      background: colors.violetSoft,
      icon: KeyRound,
      iconColor: colors.violet,
      statusBackground: colors.violetSoft,
      statusText: colors.violet,
    };
  }
  if (record.kind === "wallet_backup") {
    return {
      background: colors.blueSoft,
      icon: ShieldCheck,
      iconColor: colors.blue,
      statusBackground: colors.blueSoft,
      statusText: colors.blue,
    };
  }
  if (record.kind === "wallet_created") {
    return {
      background: colors.ink,
      icon: Wallet2,
      iconColor: "#FFFFFF",
      statusBackground: colors.surfaceMuted,
      statusText: colors.text,
    };
  }
  return {
    background: colors.blueSoft,
    icon: Check,
    iconColor: colors.blue,
    statusBackground: colors.blueSoft,
    statusText: colors.blue,
  };
}

function formatActivityTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
