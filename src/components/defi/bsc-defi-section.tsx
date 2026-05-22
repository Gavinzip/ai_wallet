import { ArrowUpRight, ExternalLink } from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import { IntentReviewCard } from "@/components/agent/intent-review-card";
import { RiskBadge } from "@/components/agent/risk-badge";
import { bscDefiProtocols } from "@/data/defi";
import { createBscDefiDappIntent, createPancakeBnbSwapIntent } from "@/services/defi/defi-intents";
import type { PancakeOutputSymbol } from "@/services/defi/pancakeswap-v2";
import { colors, radii, shadows } from "@/theme/tokens";
import type { BscDefiProtocol } from "@/types/defi";
import type { WalletIntent } from "@/types/intent";

export function BscDefiSection() {
  const [selectedIntent, setSelectedIntent] = useState<WalletIntent | null>(null);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 7 }}>
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800" }}>
          BSC DeFi
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 15, lineHeight: 21 }}>
          Real BNB Smart Chain protocol entries. The wallet creates reviewable DApp intents; it does not execute until Token Core signs locally.
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {bscDefiProtocols.map((protocol) => (
          <DefiProtocolCard
            key={protocol.id}
            protocol={protocol}
            onSelectIntent={setSelectedIntent}
          />
        ))}
      </View>

      {selectedIntent ? <IntentReviewCard intent={selectedIntent} /> : null}
    </View>
  );
}

function DefiProtocolCard({
  onSelectIntent,
  protocol,
}: {
  onSelectIntent: (intent: WalletIntent) => void;
  protocol: BscDefiProtocol;
}) {
  const [amountInBnb, setAmountInBnb] = useState("");
  const [outputSymbol, setOutputSymbol] = useState<PancakeOutputSymbol>("USDC");

  const isLivePancakeSwap = protocol.id === "pancakeswap-swap";

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
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>
              {protocol.name}
            </Text>
            <RiskBadge severity={protocol.riskLevel} />
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "800" }}>
            {protocol.chain} / {protocol.category}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
            {protocol.description}
          </Text>
        </View>
      </View>

      <View style={{ gap: 7 }}>
        {protocol.capabilities.map((item) => (
          <Text key={item} style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>
            - {item}
          </Text>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Pressable
          accessibilityLabel={`Create ${protocol.name} intent`}
          accessibilityRole="button"
          onPress={() => onSelectIntent(createBscDefiDappIntent(protocol))}
          style={{
            alignItems: "center",
            backgroundColor: colors.ink,
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 8,
            minHeight: 44,
            paddingHorizontal: 14,
          }}
        >
          <ArrowUpRight color="#FFFFFF" size={17} strokeWidth={2.4} />
          <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>
            Create Intent
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel={`Open ${protocol.name} docs`}
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(protocol.docsUrl);
          }}
          style={{
            alignItems: "center",
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.pill,
            flexDirection: "row",
            gap: 8,
            minHeight: 44,
            paddingHorizontal: 14,
          }}
        >
          <ExternalLink color={colors.text} size={16} strokeWidth={2.4} />
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>
            {protocol.sourceLabel}
          </Text>
        </Pressable>
      </View>

      {isLivePancakeSwap ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 9 }}>
            {(["USDC", "USDT", "CAKE"] as PancakeOutputSymbol[]).map((symbol) => {
              const selected = symbol === outputSymbol;
              return (
                <Pressable
                  accessibilityLabel={`Select ${symbol} output token`}
                  accessibilityRole="button"
                  key={symbol}
                  onPress={() => setOutputSymbol(symbol)}
                  style={{
                    backgroundColor: selected ? colors.ink : colors.surfaceMuted,
                    borderRadius: radii.pill,
                    paddingHorizontal: 13,
                    paddingVertical: 9,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? "#FFFFFF" : colors.text,
                      fontSize: 13,
                      fontWeight: "800",
                    }}
                  >
                    {symbol}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", gap: 9 }}>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={setAmountInBnb}
              placeholder="BNB amount"
              placeholderTextColor={colors.textSoft}
              style={{
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radii.md,
                borderWidth: 1,
                color: colors.text,
                flex: 1,
                fontSize: 15,
                minHeight: 44,
                paddingHorizontal: 13,
              }}
              value={amountInBnb}
            />
            <Pressable
              accessibilityLabel="Create live PancakeSwap swap intent"
              accessibilityRole="button"
              disabled={amountInBnb.trim().length === 0}
              onPress={() =>
                onSelectIntent(
                  createPancakeBnbSwapIntent({
                    amountInBnb: amountInBnb.trim(),
                    outputSymbol,
                    slippageBps: 100,
                  }),
                )
              }
              style={{
                alignItems: "center",
                backgroundColor: colors.mint,
                borderRadius: radii.pill,
                justifyContent: "center",
                minHeight: 44,
                opacity: amountInBnb.trim().length === 0 ? 0.55 : 1,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "900" }}>
                Live Swap
              </Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>
            Uses real BSC RPC at signing time: quote, gas, nonce, Token Core signature, then raw transaction broadcast. Slippage is 1%.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
