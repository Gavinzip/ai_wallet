import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react-native";

export type IconComponent = ComponentType<LucideProps>;

export type WalletAction = {
  id: "agent-top-up" | "receive" | "send" | "swap";
  label: string;
  icon: IconComponent;
  tone: "default" | "agent" | "receive";
};

export type WalletToken = {
  id: string;
  name: string;
  symbol: string;
  balanceLabel: string;
  fiatValue: string;
  change: number | null;
  accent: string;
  chain?: string;
  chainId?: string;
  explorerAddressUrl?: string;
  iconLabel: string;
  isNative?: boolean;
  isTestnet?: boolean;
  rawBalance?: string;
  sparkline: number[];
  tokenAddress?: string | null;
};

export type WalletSummary = {
  name: string;
  address: string | null;
  totalValue: string | null;
  dailyPnl: string | null;
  dailyPnlTone: "positive" | "negative" | "neutral";
  integrationMode: "token-core-native" | "token-core-unavailable" | "token-core-web";
  statusMessage: string;
};
