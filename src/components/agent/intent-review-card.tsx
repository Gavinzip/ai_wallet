import { KeyRound, ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { RiskBadge } from "@/components/agent/risk-badge";
import { requestLocalTokenCoreSigning } from "@/services/wallet-intent-executor";
import { colors, radii, shadows } from "@/theme/tokens";
import type { WalletIntent, WalletIntentAction } from "@/types/intent";

type IntentReviewCardProps = {
  intent: WalletIntent;
  signingAvailable?: boolean;
  signingMode?: "passkey" | "password";
};

function ActionRows({ action }: { action: WalletIntentAction }) {
  const paramRows = [
    ["Spender", action.params?.spender],
    ["Contract Address", action.params?.contractAddress ?? action.params?.contract],
    ["Router", action.params?.router],
    ["Vault", action.params?.vault],
    ["Protocol", action.params?.protocol],
    ["Function", action.params?.function],
    ["Receiver", action.params?.receiver],
    ["Token Address", action.params?.tokenAddress],
    ["Approval Amount", action.params?.approvalAmount],
  ];
  const rows = [
    ["Type", action.type],
    ["Chain", action.chain],
    ["Recipient", action.to],
    ["Token", action.token],
    ["Amount", action.amount],
    ["Message", action.message],
    ["Tx Chain ID", action.evmTx?.chainId],
    ["Tx Nonce", action.evmTx?.nonce],
    ["Tx Gas Price", action.evmTx?.gasPrice],
    ["Tx Gas Limit", action.evmTx?.gasLimit],
    ["Tx To", action.evmTx?.to],
    ["Tx Value", action.evmTx?.value],
    ["Tx Calldata", action.evmTx?.data],
    ...paramRows,
    ["Params", action.params ? JSON.stringify(action.params, null, 2) : null],
    ["DApp", action.dappUrl],
  ]
    .map(([label, value]) => [label, formatReviewValue(value)] as [string, string | null])
    .filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0);

  return (
    <View style={{ gap: 9 }}>
      {rows.map(([label, value]) => (
        <View key={label} style={{ gap: 3 }}>
          <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "800" }}>
            {label.toUpperCase()}
          </Text>
          <Text selectable style={{ color: colors.text, fontSize: 14, lineHeight: 19 }}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function formatReviewValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function IntentReviewCard({
  intent,
  signingAvailable = true,
  signingMode = "password",
}: IntentReviewCardProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [walletPassword, setWalletPassword] = useState("");
  const [isSigning, setIsSigning] = useState(false);
  const primaryAction = intent.actions[0];
  const primaryActionName =
    typeof primaryAction?.params?.action === "string" ? primaryAction.params.action : null;
  const isBlockedIntent =
    primaryActionName === "renaiss_buy_now_blocked" ||
    primaryActionName === "renaiss_list_order_blocked" ||
    intent.riskLevel === "block";
  const confirmDisabled =
    isSigning || isBlockedIntent || (signingMode === "password" && walletPassword.trim().length === 0);

  const requestSignature = async () => {
    if (isBlockedIntent) {
      setStatus("This intent is blocked by the safety checks above.");
      return;
    }
    const password = walletPassword.trim();
    if (signingMode === "password" && !password) {
      setStatus("Enter the local Token Core wallet password before signing.");
      return;
    }

    setIsSigning(true);
    setStatus(null);
    try {
      const result = await requestLocalTokenCoreSigning(intent, { password });
      if (result.txHash) {
        setStatus(`${result.message} Tx: ${result.txHash}`);
      } else {
        setStatus(result.signature ? `${result.message} ${result.signature}` : result.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Local signing failed.");
    } finally {
      setIsSigning(false);
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
        gap: 16,
        padding: 18,
      }}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.amberSoft,
            borderRadius: radii.pill,
            height: 36,
            justifyContent: "center",
            width: 36,
          }}
        >
          <ShieldAlert color={colors.amber} size={20} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
            <Text style={{ color: colors.text, flex: 1, fontSize: 20, fontWeight: "800" }}>
              {intent.title}
            </Text>
            <RiskBadge severity={intent.riskLevel} />
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
            {intent.summary}
          </Text>
        </View>
      </View>

      {intent.actions.map((action, index) => (
        <View
          key={`${action.type}-${index}`}
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.md,
            gap: 10,
            padding: 13,
          }}
        >
          <ActionRows action={action} />
        </View>
      ))}

      <View style={{ gap: 7 }}>
        {intent.safetyChecks.map((check) => (
          <Text key={check} style={{ color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
            - {check}
          </Text>
        ))}
      </View>

      {signingAvailable ? (
        <>
          {signingMode === "password" ? (
            <TextInput
              onChangeText={setWalletPassword}
              placeholder="Local Token Core wallet password"
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
              value={walletPassword}
            />
          ) : null}

          <Pressable
            accessibilityLabel="Request local Token Core signing"
            accessibilityRole="button"
            disabled={confirmDisabled}
            onPress={() => {
              void requestSignature();
            }}
            style={{
              alignItems: "center",
              backgroundColor: colors.ink,
              borderRadius: radii.pill,
              flexDirection: "row",
              gap: 9,
              justifyContent: "center",
              minHeight: 50,
              opacity: confirmDisabled ? 0.65 : 1,
            }}
          >
            <KeyRound color="#FFFFFF" size={18} strokeWidth={2.4} />
            <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "800" }}>
              {getConfirmLabel(primaryAction?.type ?? null, primaryActionName, signingMode)}
            </Text>
          </Pressable>
        </>
      ) : (
        <View
          style={{
            backgroundColor: colors.blueSoft,
            borderRadius: radii.md,
            padding: 13,
          }}
        >
          <Text style={{ color: colors.blue, fontSize: 13, fontWeight: "900", lineHeight: 18 }}>
            Review only in this runtime. Local signing requires a Token Core signing path for this exact action.
          </Text>
        </View>
      )}

      {status ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

function getConfirmLabel(
  actionType: WalletIntentAction["type"] | null,
  actionName: string | null,
  signingMode: "passkey" | "password",
) {
  if (actionName === "renaiss_session_login") return "Login to RENAISS";
  if (actionName === "renaiss_fund_safe_bnb") return "Fund App Wallet Gas";
  if (actionName === "renaiss_fund_safe_usdt") return "Fund App Wallet USDT";
  if (actionName === "renaiss_usdt_approve_permit2") return "Approve USDT Permit2";
  if (actionName === "renaiss_safe_usdt_approve_permit2") return "Approve Safe Permit2";
  if (actionName === "renaiss_buy_now_sign_and_submit") return "Sign & Submit BuyNow";
  if (actionName === "renaiss_list_order_sign_and_submit") return "Sign & Submit Listing";
  if (actionName === "renaiss_buy_now_blocked") return "Blocked";
  if (actionName === "renaiss_list_order_blocked") return "Blocked";
  if (actionType === "swap") return "Sign & Submit On This Device";
  return signingMode === "passkey" ? "Sign with Google + Passkey" : "Sign On This Device";
}
