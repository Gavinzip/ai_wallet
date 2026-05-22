import { CloudDownload, CloudUpload, Download, Eye, ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  exportWebTokenCoreRecoveryPhrase,
  exportWebTokenCoreWalletBackup,
  restoreWebTokenCoreCloudBackup,
  uploadWebTokenCoreCloudBackup,
} from "@/services/token-core/token-core-web-wallet-adapter";
import { colors, radii, shadows } from "@/theme/tokens";

export function WalletBackupCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const exportBackup = async () => {
    setIsWorking(true);
    setStatus(null);
    setRecoveryPhrase(null);
    try {
      const backup = await exportWebTokenCoreWalletBackup();
      downloadTextFile(backup.filename, backup.json);
      setStatus(`Encrypted backup exported for ${backup.address}. Keep it with access to the same passkey/domain.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export wallet backup.");
    } finally {
      setIsWorking(false);
    }
  };

  const revealRecoveryPhrase = async () => {
    setIsWorking(true);
    setStatus(null);
    setRecoveryPhrase(null);
    try {
      const exported = await exportWebTokenCoreRecoveryPhrase();
      setRecoveryPhrase(exported.mnemonic);
      setStatus(`Recovery phrase shown for ${exported.address}. Anyone with this phrase can control the wallet.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export recovery phrase.");
    } finally {
      setIsWorking(false);
    }
  };

  const uploadCloudBackup = async () => {
    setIsWorking(true);
    setStatus(null);
    setRecoveryPhrase(null);
    try {
      const backup = await uploadWebTokenCoreCloudBackup();
      setStatus(`Cloud backup saved for ${backup.address} at ${new Date(backup.savedAt).toLocaleString()}. Server stores only the encrypted keystore backup.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save cloud backup.");
    } finally {
      setIsWorking(false);
    }
  };

  const restoreCloudBackup = async () => {
    setIsWorking(true);
    setStatus(null);
    setRecoveryPhrase(null);
    try {
      const wallet = await restoreWebTokenCoreCloudBackup();
      setStatus(`Cloud backup restored for ${wallet.address}. Refresh wallet state if the header has not updated yet.`);
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
            backgroundColor: colors.amberSoft,
            borderRadius: radii.pill,
            height: 38,
            justifyContent: "center",
            width: 38,
          }}
        >
          <ShieldAlert color={colors.amber} size={20} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
            Wallet Backup
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            Clearing browser storage can remove this web wallet. Export a backup before using real funds.
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <BackupButton
          disabled={isWorking}
          icon="download"
          label="Export Backup"
          onPress={() => {
            void exportBackup();
          }}
        />
        <BackupButton
          disabled={isWorking}
          icon="cloud-upload"
          label="Save Cloud"
          onPress={() => {
            void uploadCloudBackup();
          }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <BackupButton
          disabled={isWorking}
          icon="cloud-download"
          label="Restore Cloud"
          onPress={() => {
            void restoreCloudBackup();
          }}
        />
        <BackupButton
          disabled={isWorking}
          icon="eye"
          label="Show Recovery"
          onPress={() => {
            void revealRecoveryPhrase();
          }}
        />
      </View>

      {recoveryPhrase ? (
        <View
          style={{
            backgroundColor: colors.redSoft,
            borderRadius: radii.md,
            gap: 7,
            padding: 13,
          }}
        >
          <Text style={{ color: colors.red, fontSize: 13, fontWeight: "900" }}>
            Private-key level secret
          </Text>
          <Text selectable style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>
            {recoveryPhrase}
          </Text>
        </View>
      ) : null}

      {status ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

function BackupButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  icon: "cloud-download" | "cloud-upload" | "download" | "eye";
  label: string;
  onPress: () => void;
}) {
  const Icon =
    icon === "download"
      ? Download
      : icon === "cloud-upload"
        ? CloudUpload
        : icon === "cloud-download"
          ? CloudDownload
          : Eye;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
        borderRadius: radii.pill,
        borderWidth: 1,
        flex: 1,
        flexDirection: "row",
        gap: 8,
        justifyContent: "center",
        minHeight: 44,
        opacity: disabled ? 0.55 : pressed ? 0.74 : 1,
      })}
    >
      <Icon color={colors.text} size={16} strokeWidth={2.4} />
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function downloadTextFile(filename: string, text: string) {
  if (typeof document === "undefined") {
    throw new Error("Backup download only runs in the browser.");
  }
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
