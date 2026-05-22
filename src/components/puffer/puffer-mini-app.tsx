import { ExternalLink, Fish, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { IntentReviewCard } from "@/components/agent/intent-review-card";
import {
  createPufferTokenDepositReviewIntent,
  getPufferUnifiVaults,
  preparePufferEthDepositIntent,
  PUFFER_APP_URL,
  PUFFER_SDK_DOCS_URL,
  PUFFER_TESTNET_NOTE,
  readPufferRateSnapshot,
} from "@/services/puffer/puffer-intents";
import { getTokenCoreWalletAdapter, getTokenCoreRuntimeStatus } from "@/services/token-core/token-core-wallet-adapter";
import { colors, radii, shadows } from "@/theme/tokens";
import type { WalletIntent } from "@/types/intent";
import type { PufferDepositAsset, PufferNetworkMode, PufferRateSnapshot } from "@/types/puffer";
import { shortenAddress } from "@/utils/format";

const assetOptions: PufferDepositAsset[] = ["ETH", "stETH", "wstETH"];
const networkModes: { label: string; mode: PufferNetworkMode; subtitle: string }[] = [
  { label: "Mainnet", mode: "mainnet", subtitle: "Ethereum" },
  { label: "Testnet", mode: "testnet", subtitle: "Holesky" },
];

export function PufferMiniApp() {
  const tokenCoreStatus = getTokenCoreRuntimeStatus();
  const signingMode = tokenCoreStatus.mode === "web-token-core" ? "passkey" : "password";
  const [asset, setAsset] = useState<PufferDepositAsset>("ETH");
  const [networkMode, setNetworkMode] = useState<PufferNetworkMode>("mainnet");
  const [amount, setAmount] = useState("0.01");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [desktopAddress, setDesktopAddress] = useState("");
  const [snapshot, setSnapshot] = useState<PufferRateSnapshot | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [intent, setIntent] = useState<WalletIntent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const effectiveAddress = walletAddress ?? desktopAddress.trim();
  const isEthPath = asset === "ETH";
  const vaults = useMemo(() => getPufferUnifiVaults(networkMode), [networkMode]);
  const canPrepare = amount.trim().length > 0 && effectiveAddress.length > 0 && !isLoading;
  const canSignIntent = Boolean(intent && intent.actions[0]?.type !== "dapp_request" && tokenCoreStatus.hasTokenCoreRuntime);

  useEffect(() => {
    let cancelled = false;
    getTokenCoreWalletAdapter()
      .loadAgentIdentityWallet()
      .then((wallet) => {
        if (!cancelled) {
          setWalletAddress(wallet?.address ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setWalletAddress(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkMode, walletAddress]);

  const addressLabel = useMemo(() => {
    if (walletAddress) return shortenAddress(walletAddress);
    if (desktopAddress.trim()) return shortenAddress(desktopAddress.trim());
    return "No wallet";
  }, [desktopAddress, walletAddress]);

  const refreshSnapshot = async () => {
    setStatus(null);
    try {
      const nextSnapshot = await readPufferRateSnapshot({
        networkMode,
        walletAddress: effectiveAddress || walletAddress,
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load Puffer rate.");
    }
  };

  const prepareIntent = async () => {
    if (!canPrepare) return;
    setIsLoading(true);
    setIntent(null);
    setStatus(null);
    try {
      if (isEthPath) {
        const prepared = await preparePufferEthDepositIntent({
          amountEth: amount,
          fromAddress: effectiveAddress,
          networkMode,
        });
        setIntent(prepared.intent);
        setStatus(prepared.rateLabel);
      } else {
        setIntent(
          createPufferTokenDepositReviewIntent({
            amount,
            asset,
            networkMode,
            walletAddress: effectiveAddress,
          }),
        );
        setStatus(`${asset} path is review-only until ERC20 permit payload decoding is wired.`);
      }
      await refreshSnapshot();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not prepare Puffer intent.");
    } finally {
      setIsLoading(false);
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
        padding: 16,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.mintSoft,
            borderRadius: radii.pill,
            height: 42,
            justifyContent: "center",
            width: 42,
          }}
        >
          <Fish color="#16886f" size={22} strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
            Puffer pufETH Mini App
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
            {snapshot?.rateLabel ?? (networkMode === "testnet" ? "Ethereum Holesky" : "Ethereum Mainnet")} /{" "}
            {addressLabel}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh Puffer rate"
          accessibilityRole="button"
          onPress={() => {
            void refreshSnapshot();
          }}
          style={iconButtonStyle}
        >
          <RefreshCw color={colors.text} size={18} strokeWidth={2.3} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {networkModes.map((option) => {
          const selected = networkMode === option.mode;
          return (
            <Pressable
              accessibilityLabel={`Use ${option.label} Puffer mode`}
              accessibilityRole="button"
              key={option.mode}
              onPress={() => {
                setNetworkMode(option.mode);
                setIntent(null);
                setStatus(null);
              }}
              style={({ pressed }) => ({
                backgroundColor: selected ? colors.ink : colors.surfaceMuted,
                borderColor: selected ? colors.ink : colors.border,
                borderRadius: radii.md,
                borderWidth: 1,
                flex: 1,
                gap: 2,
                minHeight: 54,
                opacity: pressed ? 0.76 : 1,
                paddingHorizontal: 13,
                paddingVertical: 10,
              })}
            >
              <Text
                style={{
                  color: selected ? "#FFFFFF" : colors.text,
                  fontSize: 14,
                  fontWeight: "900",
                }}
              >
                {option.label}
              </Text>
              <Text
                style={{
                  color: selected ? "rgba(255,255,255,0.72)" : colors.textSoft,
                  fontSize: 11,
                  fontWeight: "800",
                }}
              >
                {option.subtitle}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {networkMode === "testnet" ? (
        <View
          style={{
            backgroundColor: colors.blueSoft,
            borderRadius: radii.md,
            gap: 4,
            padding: 12,
          }}
        >
          <Text style={{ color: colors.blue, fontSize: 12, fontWeight: "900" }}>
            Testnet uses Holesky, not Sepolia
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700", lineHeight: 17 }}>
            {PUFFER_TESTNET_NOTE} Sepolia ETH cannot be used for the real Puffer deposit flow.
          </Text>
        </View>
      ) : null}

      {!walletAddress ? (
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDesktopAddress}
          placeholder="0x wallet address for desktop verify"
          placeholderTextColor={colors.textSoft}
          style={inputStyle}
          value={desktopAddress}
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        {assetOptions.map((option) => (
          <Pressable
            accessibilityLabel={`Select ${option}`}
            accessibilityRole="button"
            key={option}
            onPress={() => setAsset(option)}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: asset === option ? colors.ink : colors.surfaceMuted,
              borderColor: asset === option ? colors.ink : colors.border,
              borderRadius: radii.pill,
              borderWidth: 1,
              flex: 1,
              minHeight: 38,
              justifyContent: "center",
              opacity: pressed ? 0.76 : 1,
            })}
          >
            <Text
              style={{
                color: asset === option ? "#FFFFFF" : colors.text,
                fontSize: 13,
                fontWeight: "900",
              }}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <TextInput
          keyboardType="decimal-pad"
          onChangeText={setAmount}
          placeholder="Amount"
          placeholderTextColor={colors.textSoft}
          style={[inputStyle, { flex: 1 }]}
          value={amount}
        />
        <Pressable
          accessibilityLabel="Prepare Puffer deposit intent"
          accessibilityRole="button"
          disabled={!canPrepare}
          onPress={() => {
            void prepareIntent();
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: canPrepare ? colors.ink : "rgba(17,17,19,0.18)",
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 8,
            justifyContent: "center",
            minHeight: 48,
            opacity: canPrepare ? (pressed ? 0.78 : 1) : 0.64,
            paddingHorizontal: 16,
          })}
        >
          <ShieldCheck color="#FFFFFF" size={17} strokeWidth={2.4} />
          <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>
            Prepare
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <MetricPill icon="rate" label="pufETH" value={snapshot?.walletPufEthBalance ?? "-"} />
        <MetricPill icon="vault" label="UniFi" value={`${vaults.length} vaults`} />
      </View>

      <View style={{ gap: 10 }}>
        {vaults.map((vault) => (
          <View
            key={vault.id}
            style={{
              backgroundColor: colors.surfaceMuted,
              borderRadius: radii.md,
              gap: 8,
              padding: 13,
            }}
          >
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
              <Text style={{ color: colors.text, flex: 1, fontSize: 14, fontWeight: "900" }}>
                {vault.name}
              </Text>
              <Text style={{ color: colors.blue, fontSize: 12, fontWeight: "900" }}>
                {vault.outputToken}
              </Text>
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700", lineHeight: 17 }}>
              {vault.summary}
            </Text>
            <Text selectable style={{ color: colors.textSoft, fontSize: 11, fontWeight: "800" }}>
              {vault.accepts} / {shortenAddress(vault.contractAddress)}
            </Text>
          </View>
        ))}
        {vaults.length === 0 ? (
          <View
            style={{
              backgroundColor: colors.surfaceMuted,
              borderRadius: radii.md,
              gap: 6,
              padding: 13,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
              UniFi Vaults are Mainnet only here
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700", lineHeight: 17 }}>
              The installed Puffer SDK exposes UniFi vault addresses on Mainnet. Switch to Mainnet to review
              those opportunities.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <ExternalLinkButton label="Puffer App" url={PUFFER_APP_URL} />
        <ExternalLinkButton label="SDK Docs" url={PUFFER_SDK_DOCS_URL} />
      </View>

      {status ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          {status}
        </Text>
      ) : null}

      {intent ? (
        <Animated.View entering={FadeInDown.duration(160)}>
          <IntentReviewCard
            intent={intent}
            signingAvailable={canSignIntent}
            signingMode={signingMode}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function MetricPill({ icon, label, value }: { icon: "rate" | "vault"; label: string; value: string }) {
  const Icon = icon === "rate" ? TrendingUp : ShieldCheck;
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        flex: 1,
        flexDirection: "row",
        gap: 9,
        minHeight: 52,
        paddingHorizontal: 12,
      }}
    >
      <Icon color={colors.blue} size={17} strokeWidth={2.4} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.textSoft, fontSize: 10, fontWeight: "900" }}>
          {label.toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function ExternalLinkButton({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      accessibilityLabel={`Open ${label}`}
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(url);
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.blueSoft,
        borderRadius: radii.pill,
        flex: 1,
        flexDirection: "row",
        gap: 7,
        justifyContent: "center",
        minHeight: 40,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <ExternalLink color={colors.blue} size={15} strokeWidth={2.4} />
      <Text style={{ color: colors.blue, fontSize: 13, fontWeight: "900" }}>
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

const iconButtonStyle = {
  alignItems: "center",
  backgroundColor: colors.surfaceMuted,
  borderRadius: radii.pill,
  height: 38,
  justifyContent: "center",
  width: 38,
} as const;
