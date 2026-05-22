import { Image } from "expo-image";
import { Gift, LoaderCircle, ReceiptText, Search, ShoppingBag, WalletCards } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { IntentReviewCard } from "@/components/agent/intent-review-card";
import {
  createBitrefillInvoice,
  fetchBitrefillStatus,
  searchBitrefillProducts,
  type BitrefillPaymentMethod,
} from "@/services/bitrefill/bitrefill-api";
import { colors, radii, shadows } from "@/theme/tokens";
import type { BitrefillInvoice, BitrefillPackage, BitrefillProduct, BitrefillStatus } from "@/types/bitrefill";

const paymentMethods: { label: string; value: BitrefillPaymentMethod }[] = [
  { label: "ETH", value: "ethereum" },
  { label: "USDC Base", value: "usdc_base" },
  { label: "ETH Base", value: "eth_base" },
  { label: "Balance", value: "balance" },
];

export function BitrefillCommerceAssistant() {
  const [status, setStatus] = useState<BitrefillStatus | null>(null);
  const [query, setQuery] = useState("Steam");
  const [country, setCountry] = useState("US");
  const [products, setProducts] = useState<BitrefillProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<BitrefillProduct | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<BitrefillPackage | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<BitrefillPaymentMethod>("ethereum");
  const [invoice, setInvoice] = useState<BitrefillInvoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isBuying, setIsBuying] = useState(false);

  const configured = status?.configured === true;
  const hasSelectionValue = Boolean(selectedPackage || customValue.trim());
  const canSearch = configured && query.trim().length > 0 && !isSearching;
  const canCreateInvoice = configured && Boolean(selectedProduct) && hasSelectionValue && !isBuying;
  const packageOptions = selectedProduct?.packages ?? [];

  useEffect(() => {
    let cancelled = false;
    fetchBitrefillStatus()
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
          if (!nextStatus.configured) {
            setMessage("Bitrefill API is not connected on the local agent server.");
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Bitrefill status failed.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedValueLabel = useMemo(() => {
    if (selectedPackage) {
      return `${selectedPackage.value ?? selectedPackage.id}`;
    }
    return customValue.trim() ? customValue.trim() : "-";
  }, [customValue, selectedPackage]);

  const runSearch = async () => {
    if (!canSearch) return;
    setIsSearching(true);
    setMessage(null);
    setInvoice(null);
    try {
      const response = await searchBitrefillProducts({ country, query });
      setProducts(response.data);
      setSelectedProduct(response.data[0] ?? null);
      setSelectedPackage(response.data[0]?.packages[0] ?? null);
      setCustomValue("");
      setMessage(`${response.data.length} products returned from Bitrefill.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bitrefill search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const createInvoice = async () => {
    if (!selectedProduct || !canCreateInvoice) return;
    setIsBuying(true);
    setMessage(null);
    setInvoice(null);
    try {
      const parsedValue = selectedPackage ? null : Number(customValue);
      const nextInvoice = await createBitrefillInvoice({
        packageId: selectedPackage?.id ?? null,
        paymentMethod,
        productId: selectedProduct.id,
        value: Number.isFinite(parsedValue) ? parsedValue : null,
      });
      setInvoice(nextInvoice);
      setMessage("Bitrefill returned an invoice. Payment still requires final wallet review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bitrefill invoice failed.");
    } finally {
      setIsBuying(false);
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
            backgroundColor: colors.violetSoft,
            borderRadius: radii.pill,
            height: 42,
            justifyContent: "center",
            width: 42,
          }}
        >
          <ShoppingBag color={colors.violet} size={22} strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
            Bitrefill Commerce Agent
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
            {configured ? `${status?.authMode} connected` : "API not connected"} / {paymentMethod}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <TextInput
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Product"
          placeholderTextColor={colors.textSoft}
          style={[inputStyle, { flex: 1 }]}
          value={query}
        />
        <TextInput
          autoCapitalize="characters"
          maxLength={2}
          onChangeText={setCountry}
          placeholder="US"
          placeholderTextColor={colors.textSoft}
          style={[inputStyle, { width: 64, textAlign: "center" }]}
          value={country}
        />
        <Pressable
          accessibilityLabel="Search Bitrefill products"
          accessibilityRole="button"
          disabled={!canSearch}
          onPress={() => {
            void runSearch();
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: canSearch ? colors.ink : "rgba(17,17,19,0.18)",
            borderRadius: radii.pill,
            height: 48,
            justifyContent: "center",
            opacity: canSearch ? (pressed ? 0.78 : 1) : 0.64,
            width: 48,
          })}
        >
          {isSearching ? (
            <LoaderCircle color="#FFFFFF" size={18} strokeWidth={2.4} />
          ) : (
            <Search color="#FFFFFF" size={18} strokeWidth={2.4} />
          )}
        </Pressable>
      </View>

      {products.length > 0 ? (
        <View style={{ gap: 10 }}>
          {products.slice(0, 4).map((product) => (
            <ProductRow
              key={product.id}
              onSelect={() => {
                setSelectedProduct(product);
                setSelectedPackage(product.packages[0] ?? null);
                setCustomValue("");
                setInvoice(null);
              }}
              product={product}
              selected={selectedProduct?.id === product.id}
            />
          ))}
        </View>
      ) : null}

      {selectedProduct ? (
        <View style={{ gap: 12 }}>
          {packageOptions.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {packageOptions.slice(0, 6).map((item) => (
                <Pressable
                  accessibilityLabel={`Select package ${item.value ?? item.id}`}
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => {
                    setSelectedPackage(item);
                    setCustomValue("");
                  }}
                  style={({ pressed }) => ({
                    backgroundColor: selectedPackage?.id === item.id ? colors.ink : colors.surfaceMuted,
                    borderRadius: radii.pill,
                    opacity: pressed ? 0.72 : 1,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                  })}
                >
                  <Text
                    style={{
                      color: selectedPackage?.id === item.id ? "#FFFFFF" : colors.text,
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    {String(item.value ?? item.id)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={(value) => {
                setCustomValue(value);
                setSelectedPackage(null);
              }}
              placeholder={`Value ${selectedProduct.currency ?? ""}`}
              placeholderTextColor={colors.textSoft}
              style={inputStyle}
              value={customValue}
            />
          )}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {paymentMethods.map((method) => (
              <Pressable
                accessibilityLabel={`Pay with ${method.label}`}
                accessibilityRole="button"
                key={method.value}
                onPress={() => setPaymentMethod(method.value)}
                style={({ pressed }) => ({
                  backgroundColor: paymentMethod === method.value ? colors.violet : colors.violetSoft,
                  borderRadius: radii.pill,
                  opacity: pressed ? 0.72 : 1,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                })}
              >
                <Text
                  style={{
                    color: paymentMethod === method.value ? "#FFFFFF" : colors.violet,
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {method.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityLabel="Create Bitrefill invoice"
            accessibilityRole="button"
            disabled={!canCreateInvoice}
            onPress={() => {
              void createInvoice();
            }}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: canCreateInvoice ? colors.ink : "rgba(17,17,19,0.18)",
              borderRadius: radii.pill,
              flexDirection: "row",
              gap: 9,
              justifyContent: "center",
              minHeight: 48,
              opacity: canCreateInvoice ? (pressed ? 0.78 : 1) : 0.64,
            })}
          >
            <ReceiptText color="#FFFFFF" size={17} strokeWidth={2.4} />
            <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>
              Create Invoice
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <InfoPill label="Product" value={selectedProduct?.name ?? "-"} />
        <InfoPill label="Value" value={selectedValueLabel} />
      </View>

      {invoice ? <InvoicePanel invoice={invoice} /> : null}
      {invoice?.intent ? (
        <IntentReviewCard intent={invoice.intent} signingAvailable={false} signingMode="password" />
      ) : null}

      {message ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function ProductRow({
  onSelect,
  product,
  selected,
}: {
  onSelect: () => void;
  product: BitrefillProduct;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`Select ${product.name}`}
      accessibilityRole="button"
      onPress={onSelect}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: selected ? colors.violetSoft : colors.surfaceMuted,
        borderColor: selected ? colors.violet : "transparent",
        borderRadius: radii.md,
        borderWidth: 1,
        flexDirection: "row",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
        padding: 10,
      })}
    >
      {product.image ? (
        <Image
          source={{ uri: product.image }}
          style={{ borderRadius: 10, height: 38, width: 38 }}
        />
      ) : (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderRadius: 10,
            height: 38,
            justifyContent: "center",
            width: 38,
          }}
        >
          <Gift color={colors.violet} size={18} strokeWidth={2.4} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
          {product.name}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700" }}>
          {product.countryCode ?? "XI"} / {product.currency ?? "-"} / {product.inStock === false ? "out" : "in"}
        </Text>
      </View>
    </Pressable>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        flex: 1,
        gap: 3,
        minHeight: 52,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: colors.textSoft, fontSize: 10, fontWeight: "900" }}>
        {label.toUpperCase()}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>
        {value}
      </Text>
    </View>
  );
}

function InvoicePanel({ invoice }: { invoice: BitrefillInvoice }) {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        gap: 9,
        padding: 13,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <WalletCards color={colors.violet} size={18} strokeWidth={2.4} />
        <Text style={{ color: colors.text, flex: 1, fontSize: 14, fontWeight: "900" }}>
          Invoice {invoice.id}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800" }}>
          {invoice.status ?? invoice.payment?.status ?? "created"}
        </Text>
      </View>
      {invoice.payment ? (
        <Text selectable style={{ color: colors.textMuted, fontSize: 12, fontWeight: "700", lineHeight: 18 }}>
          {invoice.payment.method ?? "-"} / {invoice.payment.currency ?? "-"} / {invoice.payment.price ?? "-"}
          {invoice.payment.address ? `\n${invoice.payment.address}` : ""}
        </Text>
      ) : null}
    </View>
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
