import { getAgentApiBaseUrl, readJsonResponse } from "@/services/api-base-url";
import type {
  BitrefillInvoice,
  BitrefillSearchResponse,
  BitrefillStatus,
} from "@/types/bitrefill";

export type BitrefillPaymentMethod =
  | "balance"
  | "ethereum"
  | "eth_base"
  | "usdc_base"
  | "usdc_erc20"
  | "usdt_erc20"
  | "lightning"
  | "bitcoin";

export async function fetchBitrefillStatus(): Promise<BitrefillStatus> {
  const response = await fetch(`${getAgentApiBaseUrl("Bitrefill API")}/api/bitrefill/status`);
  return readJsonResponse<BitrefillStatus>(response, "Bitrefill status request failed.");
}

export async function searchBitrefillProducts(input: {
  country?: string;
  query: string;
}): Promise<BitrefillSearchResponse> {
  const params = new URLSearchParams({
    limit: "12",
    q: input.query,
  });
  if (input.country?.trim()) {
    params.set("country", input.country.trim().toUpperCase());
  }
  const response = await fetch(
    `${getAgentApiBaseUrl("Bitrefill API")}/api/bitrefill/products/search?${params.toString()}`,
  );
  return readJsonResponse<BitrefillSearchResponse>(response, "Bitrefill product search failed.");
}

export async function createBitrefillInvoice(input: {
  email?: string;
  packageId?: string | null;
  paymentMethod: BitrefillPaymentMethod;
  productId: string;
  value?: number | null;
}): Promise<BitrefillInvoice> {
  const response = await fetch(`${getAgentApiBaseUrl("Bitrefill API")}/api/bitrefill/invoices`, {
    body: JSON.stringify({
      email: input.email?.trim() || null,
      package_id: input.packageId ?? null,
      payment_method: input.paymentMethod,
      product_id: input.productId,
      value: input.value ?? null,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return readJsonResponse<BitrefillInvoice>(response, "Bitrefill invoice request failed.");
}
