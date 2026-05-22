import type { WalletIntent } from "@/types/intent";

export type BitrefillStatus = {
  authMode: "api-key" | "basic" | "none";
  configured: boolean;
};

export type BitrefillPackage = {
  id: string;
  price?: number | null;
  value?: number | string | null;
};

export type BitrefillProduct = {
  countryCode?: string | null;
  countryName?: string | null;
  currency?: string | null;
  id: string;
  image?: string | null;
  inStock?: boolean | null;
  name: string;
  packages: BitrefillPackage[];
  range?: {
    max?: number | null;
    min?: number | null;
    step?: number | null;
  } | null;
};

export type BitrefillSearchResponse = {
  data: BitrefillProduct[];
  meta?: Record<string, unknown>;
};

export type BitrefillInvoicePayment = {
  address?: string | null;
  currency?: string | null;
  method?: string | null;
  price?: number | null;
  status?: string | null;
};

export type BitrefillInvoice = {
  id: string;
  intent?: WalletIntent | null;
  payment?: BitrefillInvoicePayment | null;
  paymentLink?: string | null;
  status?: string | null;
};
