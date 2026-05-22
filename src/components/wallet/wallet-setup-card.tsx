import { CloudDownload, KeyRound, Wallet2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  restoreWebTokenCoreCloudBackup,
  restoreWebTokenCoreWalletBackup,
} from "@/services/token-core/token-core-web-wallet-adapter";
import { createOrUnlockTokenCoreWallet, type WalletRuntimeSnapshot } from "@/services/wallet/wallet-runtime";
import { colors, radii, shadows } from "@/theme/tokens";

type WalletSetupCardProps = {
  disabled?: boolean;
  mode: WalletRuntimeSnapshot["summary"]["integrationMode"];
  onWalletLoaded: (snapshot: WalletRuntimeSnapshot) => void;
};

export function WalletSetupCard({ disabled, mode, onWalletLoaded }: WalletSetupCardProps) {
  const [password, setPassword] = useState("");
  const [backupJson, setBackupJson] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const webMode = mode === "token-core-web";

  const handleCreateWallet = async () => {
    const trimmedPassword = password.trim();
    if (!webMode && !trimmedPassword) {
      setStatus("Enter a local Token Core wallet password.");
      return;
    }

    setIsWorking(true);
    setStatus(null);
    try {
      const snapshot = await createOrUnlockTokenCoreWallet(trimmedPassword);
      onWalletLoaded(snapshot);
      setPassword("");
      setStatus(`Wallet loaded: ${snapshot.summary.address}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create wallet.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!backupJson.trim()) {
      setStatus("Paste the encrypted backup JSON first.");
      return;
    }

    setIsWorking(true);
    setStatus(null);
    try {
      await restoreWebTokenCoreWalletBackup(backupJson.trim());
      const snapshot = await createOrUnlockTokenCoreWallet("");
      onWalletLoaded(snapshot);
      setBackupJson("");
      setStatus(`Wallet restored: ${snapshot.summary.address}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore wallet backup.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleRestoreCloudBackup = async () => {
    setIsWorking(true);
    setStatus(null);
    try {
      await restoreWebTokenCoreCloudBackup();
      const snapshot = await createOrUnlockTokenCoreWallet("");
      onWalletLoaded(snapshot);
      setStatus(`Cloud backup restored: ${snapshot.summary.address}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore cloud backup.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 14,
        padding: 16,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.blueSoft,
            borderRadius: radii.pill,
            height: 38,
            justifyContent: "center",
            width: 38,
          }}
        >
          <Wallet2 color={colors.blue} size={20} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>
            Create Token Core Wallet
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            {webMode
              ? "Google identifies you; Passkey PRF encrypts the Token Core WASM wallet locally in this browser."
              : "Creates or unlocks the local Agent Identity Wallet on this device."}
          </Text>
        </View>
      </View>

      {!webMode ? (
        <TextInput
          editable={!disabled && !isWorking}
          onChangeText={setPassword}
          placeholder="Local wallet password"
          placeholderTextColor={colors.textSoft}
          secureTextEntry
          style={{
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radii.md,
            borderWidth: 1,
            color: colors.text,
            fontSize: 15,
            minHeight: 48,
            paddingHorizontal: 14,
          }}
          value={password}
        />
      ) : (
        <View style={{ gap: 10 }}>
          <TextInput
            editable={!disabled && !isWorking}
            multiline
            onChangeText={setBackupJson}
            placeholder="Optional: paste encrypted web wallet backup JSON to restore"
            placeholderTextColor={colors.textSoft}
            style={{
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radii.md,
              borderWidth: 1,
              color: colors.text,
              fontSize: 13,
              minHeight: 76,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
            value={backupJson}
          />
          <Pressable
            accessibilityLabel="Restore web wallet backup"
            accessibilityRole="button"
            disabled={disabled || isWorking || backupJson.trim().length === 0}
            onPress={() => {
              void handleRestoreBackup();
            }}
            style={{
              alignItems: "center",
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radii.pill,
              borderWidth: 1,
              flexDirection: "row",
              gap: 9,
              justifyContent: "center",
              minHeight: 44,
              opacity: disabled || isWorking || backupJson.trim().length === 0 ? 0.55 : 1,
            }}
          >
            <KeyRound color={colors.text} size={16} strokeWidth={2.4} />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
              Restore Backup
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Restore web wallet from encrypted cloud backup"
            accessibilityRole="button"
            disabled={disabled || isWorking}
            onPress={() => {
              void handleRestoreCloudBackup();
            }}
            style={{
              alignItems: "center",
              backgroundColor: colors.blueSoft,
              borderColor: colors.blue,
              borderRadius: radii.pill,
              borderWidth: 1,
              flexDirection: "row",
              gap: 9,
              justifyContent: "center",
              minHeight: 44,
              opacity: disabled || isWorking ? 0.55 : 1,
            }}
          >
            <CloudDownload color={colors.blue} size={16} strokeWidth={2.4} />
            <Text style={{ color: colors.blue, fontSize: 14, fontWeight: "900" }}>
              Restore Cloud Backup
            </Text>
          </Pressable>
        </View>
      )}

      <Pressable
        accessibilityLabel="Create or unlock Token Core wallet"
        accessibilityRole="button"
        disabled={disabled || isWorking || (!webMode && password.trim().length === 0)}
        onPress={() => {
          void handleCreateWallet();
        }}
        style={{
          alignItems: "center",
          backgroundColor: colors.ink,
          borderRadius: radii.pill,
          flexDirection: "row",
          gap: 9,
          justifyContent: "center",
          minHeight: 48,
          opacity: disabled || isWorking || (!webMode && password.trim().length === 0) ? 0.55 : 1,
        }}
      >
        <KeyRound color="#FFFFFF" size={17} strokeWidth={2.4} />
        <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>
          {isWorking
            ? "Creating..."
            : webMode
              ? "Continue with Google + Passkey"
              : "Create / Unlock Wallet"}
        </Text>
      </Pressable>

      {status ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}
