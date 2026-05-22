import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Screen } from "@/components/screen";
import { ActionRail } from "@/components/wallet/action-rail";
import { TokenList } from "@/components/wallet/token-list";
import { WalletActionPanel } from "@/components/wallet/wallet-action-panel";
import { WalletBackupCard } from "@/components/wallet/wallet-backup-card";
import { WalletHeader } from "@/components/wallet/wallet-header";
import { WalletSetupCard } from "@/components/wallet/wallet-setup-card";
import { walletActions } from "@/data/wallet";
import { loadWalletRuntimeSnapshot, type WalletRuntimeSnapshot } from "@/services/wallet/wallet-runtime";
import { colors, radii } from "@/theme/tokens";
import type { WalletAction } from "@/types/wallet";

export function WalletHome() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<WalletRuntimeSnapshot | null>(null);
  const [activeActionId, setActiveActionId] =
    useState<Exclude<WalletAction["id"], "agent-top-up"> | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    loadWalletRuntimeSnapshot().then(setSnapshot);
  }, []);

  if (!snapshot) {
    return null;
  }

  const handleActionPress = (action: WalletAction) => {
    setActionStatus(null);

    if (action.id === "agent-top-up") {
      router.push("/agent");
      return;
    }

    const desktopVerifyMode =
      !snapshot.summary.address && snapshot.summary.integrationMode === "token-core-unavailable";
    if (
      !snapshot.summary.address &&
      desktopVerifyMode &&
      (action.id === "send" || action.id === "swap")
    ) {
      setActiveActionId(action.id);
      return;
    }

    if (!snapshot.summary.address) {
      setActiveActionId(null);
      setActionStatus("Create or unlock the local Token Core wallet before using wallet actions.");
      return;
    }

    if (!snapshot.canTransact && action.id !== "receive") {
      setActiveActionId(null);
      setActionStatus("Token Core native wallet is not ready for local signing yet.");
      return;
    }

    setActiveActionId(action.id);
  };

  const disabledActionIds = snapshot.summary.address
    ? snapshot.canTransact
      ? []
      : walletActions.filter((action) => action.id !== "receive" && action.id !== "agent-top-up").map((action) => action.id)
    : snapshot.summary.integrationMode === "token-core-unavailable"
      ? walletActions.filter((action) => action.id === "receive").map((action) => action.id)
      : walletActions.filter((action) => action.id !== "agent-top-up").map((action) => action.id);

  return (
    <Screen>
      <WalletHeader summary={snapshot.summary} />
      {!snapshot.summary.address ? (
        <WalletSetupCard
          disabled={snapshot.summary.integrationMode === "token-core-unavailable"}
          mode={snapshot.summary.integrationMode}
          onWalletLoaded={setSnapshot}
        />
      ) : null}
      {snapshot.summary.address && snapshot.summary.integrationMode === "token-core-web" ? (
        <WalletBackupCard />
      ) : null}
      <ActionRail
        actions={walletActions}
        disabledActionIds={disabledActionIds}
        onActionPress={handleActionPress}
      />
      {actionStatus ? (
        <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          {actionStatus}
        </Text>
      ) : null}
      {activeActionId ? (
        <WalletActionPanel
          actionId={activeActionId}
          onClose={() => setActiveActionId(null)}
          summary={snapshot.summary}
        />
      ) : null}
      <View
        style={{
          alignSelf: "center",
          backgroundColor: colors.surfaceStrong,
          borderRadius: radii.pill,
          height: 5,
          width: 54,
        }}
      />
      <TokenList tokens={snapshot.tokens} />
    </Screen>
  );
}
