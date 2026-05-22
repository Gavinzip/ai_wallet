import { ExternalLink, Repeat2, Send, WalletCards, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import { IntentReviewCard } from "@/components/agent/intent-review-card";
import { createPreparedPancakeBnbSwapIntent } from "@/services/defi/defi-intents";
import { prepareBscNativeTransferIntent } from "@/services/defi/bsc-native-transfer";
import {
  preparePancakeBnbToTokenSwap,
  type PancakeOutputSymbol,
} from "@/services/defi/pancakeswap-v2";
import { colors, radii, shadows } from "@/theme/tokens";
import type { WalletIntent } from "@/types/intent";
import type { WalletAction, WalletSummary } from "@/types/wallet";

type WalletActionPanelProps = {
  actionId: Exclude<WalletAction["id"], "agent-top-up">;
  onClose: () => void;
  summary: WalletSummary;
};

const outputTokens: PancakeOutputSymbol[] = ["USDC", "USDT", "CAKE"];

export function WalletActionPanel({ actionId, onClose, summary }: WalletActionPanelProps) {
  const [intent, setIntent] = useState<WalletIntent | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const desktopVerifyMode =
    !summary.address && summary.integrationMode === "token-core-unavailable";
  const signingAvailable = Boolean(summary.address);
  const signingMode = summary.integrationMode === "token-core-web" ? "passkey" : "password";

  useEffect(() => {
    setIntent(null);
    setStatus(null);
  }, [actionId]);

  const title =
    actionId === "receive" ? "Receive" : actionId === "send" ? "Send BNB" : "PancakeSwap";
  const Icon = actionId === "receive" ? WalletCards : actionId === "send" ? Send : Repeat2;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 16,
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
          <Icon color={colors.blue} size={20} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
            {title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700" }}>
            {summary.address
              ? "Token Core wallet on BNB Smart Chain"
              : desktopVerifyMode
                ? "Desktop Verify with real BSC RPC"
                : "Unlock wallet first"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close wallet action panel"
          accessibilityRole="button"
          onPress={onClose}
          style={{
            alignItems: "center",
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.pill,
            height: 36,
            justifyContent: "center",
            width: 36,
          }}
        >
          <X color={colors.text} size={18} strokeWidth={2.4} />
        </Pressable>
      </View>

      {!summary.address && !desktopVerifyMode ? (
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          Create or unlock the local Token Core wallet before using this action.
        </Text>
      ) : null}

      {desktopVerifyMode ? (
        <View
          style={{
            backgroundColor: colors.blueSoft,
            borderRadius: radii.md,
            padding: 13,
          }}
        >
          <Text style={{ color: colors.blue, fontSize: 13, fontWeight: "900", lineHeight: 18 }}>
            Desktop Verify uses real BSC RPC to prepare transaction data. It cannot create a Token Core signature on web.
          </Text>
        </View>
      ) : null}

      {summary.address && actionId === "receive" ? (
        <ReceivePanel address={summary.address} />
      ) : null}

      {(summary.address || desktopVerifyMode) && actionId === "send" ? (
        <SendPanel
          fromAddress={summary.address ?? null}
          intent={intent}
          onIntent={setIntent}
          onStatus={setStatus}
          signingAvailable={signingAvailable}
          signingMode={signingMode}
        />
      ) : null}

      {(summary.address || desktopVerifyMode) && actionId === "swap" ? (
        <SwapPanel
          fromAddress={summary.address ?? null}
          intent={intent}
          onIntent={setIntent}
          onStatus={setStatus}
          signingAvailable={signingAvailable}
          signingMode={signingMode}
        />
      ) : null}

      {status ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

function ReceivePanel({ address }: { address: string }) {
  const explorerUrl = `https://bscscan.com/address/${address}`;

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: radii.md,
          gap: 6,
          padding: 14,
        }}
      >
        <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "900" }}>
          BNB SMART CHAIN ADDRESS
        </Text>
        <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>
          {address}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Open address on BscScan"
        accessibilityRole="button"
        onPress={() => {
          void Linking.openURL(explorerUrl);
        }}
        style={primaryButtonStyle(false)}
      >
        <ExternalLink color="#FFFFFF" size={17} strokeWidth={2.4} />
        <Text style={primaryButtonTextStyle}>Open BscScan</Text>
      </Pressable>
    </View>
  );
}

function SendPanel({
  fromAddress,
  intent,
  onIntent,
  onStatus,
  signingAvailable,
  signingMode,
}: {
  fromAddress: string | null;
  intent: WalletIntent | null;
  onIntent: (intent: WalletIntent | null) => void;
  onStatus: (status: string | null) => void;
  signingAvailable: boolean;
  signingMode: "passkey" | "password";
}) {
  const [desktopFromAddress, setDesktopFromAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);

  const effectiveFromAddress = fromAddress ?? desktopFromAddress.trim();
  const canPrepare =
    effectiveFromAddress.length > 0 &&
    recipient.trim().length > 0 &&
    amount.trim().length > 0 &&
    !isPreparing;

  const prepareIntent = async () => {
    setIsPreparing(true);
    onIntent(null);
    onStatus(null);
    try {
      const nextIntent = await prepareBscNativeTransferIntent({
        amountInBnb: amount,
        fromAddress: effectiveFromAddress,
        toAddress: recipient,
      });
      onIntent(nextIntent);
      onStatus(
        signingAvailable
          ? "Review the exact recipient, amount, gas, and nonce before signing."
          : "Desktop Verify prepared real transaction data. Sign on the iPhone dev build.",
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not prepare transfer intent.");
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {!fromAddress ? (
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDesktopFromAddress}
          placeholder="From 0x address for desktop verify"
          placeholderTextColor={colors.textSoft}
          style={inputStyle}
          value={desktopFromAddress}
        />
      ) : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setRecipient}
        placeholder="Recipient 0x address"
        placeholderTextColor={colors.textSoft}
        style={inputStyle}
        value={recipient}
      />
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setAmount}
        placeholder="Amount in BNB"
        placeholderTextColor={colors.textSoft}
        style={inputStyle}
        value={amount}
      />
      <Pressable
        accessibilityLabel="Prepare BSC transfer intent"
        accessibilityRole="button"
        disabled={!canPrepare}
        onPress={() => {
          void prepareIntent();
        }}
        style={primaryButtonStyle(!canPrepare)}
      >
        <Send color="#FFFFFF" size={17} strokeWidth={2.4} />
        <Text style={primaryButtonTextStyle}>
          {isPreparing ? "Preparing..." : "Prepare Real Transfer"}
        </Text>
      </Pressable>
      {intent ? (
        <IntentReviewCard
          intent={intent}
          signingAvailable={signingAvailable}
          signingMode={signingMode}
        />
      ) : null}
    </View>
  );
}

function SwapPanel({
  fromAddress,
  intent,
  onIntent,
  onStatus,
  signingAvailable,
  signingMode,
}: {
  fromAddress: string | null;
  intent: WalletIntent | null;
  onIntent: (intent: WalletIntent | null) => void;
  onStatus: (status: string | null) => void;
  signingAvailable: boolean;
  signingMode: "passkey" | "password";
}) {
  const [desktopFromAddress, setDesktopFromAddress] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [outputSymbol, setOutputSymbol] = useState<PancakeOutputSymbol>("USDC");
  const [isPreparing, setIsPreparing] = useState(false);
  const effectiveFromAddress = fromAddress ?? desktopFromAddress.trim();
  const canPrepare = effectiveFromAddress.length > 0 && amount.trim().length > 0 && !isPreparing;

  const prepareIntent = async () => {
    setIsPreparing(true);
    onStatus(null);
    onIntent(null);
    try {
      const prepared = await preparePancakeBnbToTokenSwap({
        amountInBnb: amount,
        fromAddress: effectiveFromAddress,
        outputSymbol,
        slippageBps: 100,
      });
      onIntent(createPreparedPancakeBnbSwapIntent({ prepared }));
      onStatus(
        signingAvailable
          ? "Review quote, minimum receive, deadline, gas, nonce, and calldata before signing."
          : "Desktop Verify prepared real PancakeSwap quote and transaction data. Sign on the iPhone dev build.",
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not prepare PancakeSwap intent.");
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {!fromAddress ? (
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDesktopFromAddress}
          placeholder="From 0x address for desktop verify"
          placeholderTextColor={colors.textSoft}
          style={inputStyle}
          value={desktopFromAddress}
        />
      ) : null}
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setAmount}
        placeholder="BNB amount to swap"
        placeholderTextColor={colors.textSoft}
        style={inputStyle}
        value={amount}
      />
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "900" }}>
          FROM
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TokenChip label="BNB" selected />
        </View>
        <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "900", marginTop: 4 }}>
          TO
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {outputTokens.map((token) => (
            <TokenChip
              key={token}
              label={token}
              onPress={() => setOutputSymbol(token)}
              selected={outputSymbol === token}
            />
          ))}
        </View>
      </View>
      <Pressable
        accessibilityLabel="Prepare PancakeSwap intent"
        accessibilityRole="button"
        disabled={!canPrepare}
        onPress={() => {
          void prepareIntent();
        }}
        style={primaryButtonStyle(!canPrepare)}
      >
        <Repeat2 color="#FFFFFF" size={17} strokeWidth={2.4} />
        <Text style={primaryButtonTextStyle}>
          {isPreparing ? "Preparing..." : "Prepare PancakeSwap Intent"}
        </Text>
      </Pressable>
      {intent ? (
        <IntentReviewCard
          intent={intent}
          signingAvailable={signingAvailable}
          signingMode={signingMode}
        />
      ) : null}
    </View>
  );
}

function TokenChip({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress?: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={onPress ? `Select ${label}` : `${label} selected`}
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={{
        alignItems: "center",
        backgroundColor: selected ? colors.blueSoft : colors.surfaceMuted,
        borderColor: selected ? colors.blue : colors.border,
        borderRadius: radii.pill,
        borderWidth: 1,
        flex: 1,
        justifyContent: "center",
        minHeight: 42,
      }}
    >
      <Text
        style={{
          color: selected ? colors.blue : colors.textMuted,
          fontSize: 13,
          fontWeight: "900",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const inputStyle = {
  backgroundColor: colors.surfaceMuted,
  borderColor: colors.border,
  borderRadius: radii.md,
  borderWidth: 1,
  color: colors.text,
  fontSize: 15,
  minHeight: 48,
  paddingHorizontal: 14,
} as const;

function primaryButtonStyle(disabled: boolean) {
  return {
    alignItems: "center" as const,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    flexDirection: "row" as const,
    gap: 9,
    justifyContent: "center" as const,
    minHeight: 48,
    opacity: disabled ? 0.55 : 1,
  };
}

const primaryButtonTextStyle = {
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: "900",
} as const;
