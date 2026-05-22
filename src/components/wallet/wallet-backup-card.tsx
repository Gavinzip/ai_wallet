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

  const exportMnemonic = async () => {
    setIsWorking(true);
    setStatus(null);
    setRecoveryPhrase(null);
    try {
      const exported = await exportWebTokenCoreRecoveryPhrase();
      const addressSuffix = exported.address.slice(2, 10).toLowerCase();
      downloadTextFile(
        `token-core-recovery-${addressSuffix}.txt`,
        [
          "Token Core Wallet Recovery Phrase",
          "",
          "Anyone with this phrase can control the wallet. Keep it offline and never paste it into a website you do not trust.",
          "",
          exported.mnemonic,
          "",
          `Address: ${exported.address}`,
        ].join("\n"),
        "text/plain;charset=utf-8",
      );
      setStatus(`Recovery phrase exported for ${exported.address}. This is the wallet-level secret.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export recovery phrase.");
    } finally {
      setIsWorking(false);
    }
  };

  const exportEncryptedBackup = async () => {
    setIsWorking(true);
    setStatus(null);
    setRecoveryPhrase(null);
    try {
      const backup = await exportWebTokenCoreWalletBackup();
      downloadTextFile(backup.filename, backup.json, "application/json;charset=utf-8");
      setStatus(`Encrypted JSON backup exported for ${backup.address}. It still needs the same Google account, passkey, and domain to restore.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export encrypted wallet backup.");
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
      setStatus(`Google wallet backup saved for ${backup.address} at ${new Date(backup.savedAt).toLocaleString()}. Server stores only the encrypted keystore backup.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save Google wallet backup.");
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
      setStatus(`Google wallet backup restored for ${wallet.address}. Refresh wallet state if the header has not updated yet.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore Google wallet backup.");
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
            Google stores no private key. Your server stores only the encrypted wallet backup for this Google account.
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <BackupButton
          disabled={isWorking}
          icon="download"
          label="Export Mnemonic"
          onPress={() => {
            void exportMnemonic();
          }}
        />
        <BackupButton
          disabled={isWorking}
          icon="eye"
          label="Show Mnemonic"
          onPress={() => {
            void revealRecoveryPhrase();
          }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <BackupButton
          disabled={isWorking}
          icon="cloud-upload"
          label="Save Google Backup"
          onPress={() => {
            void uploadCloudBackup();
          }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <BackupButton
          disabled={isWorking}
          icon="download"
          label="Export Encrypted JSON"
          onPress={() => {
            void exportEncryptedBackup();
          }}
        />
        <BackupButton
          disabled={isWorking}
          icon="cloud-download"
          label="Restore Google Backup"
          onPress={() => {
            void restoreCloudBackup();
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

function downloadTextFile(filename: string, text: string, type: string) {
  if (typeof document === "undefined") {
    throw new Error("Backup download only runs in the browser.");
  }
  const blob = new Blob([text], { type });
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
