import type { WalletIntent } from "@/types/intent";

export type PufferDepositAsset = "ETH" | "stETH" | "wstETH";

export type PufferNetworkMode = "mainnet" | "testnet";

export type PufferRateSnapshot = {
  chain: "Ethereum Mainnet" | "Ethereum Holesky";
  chainId: string;
  isTestnet: boolean;
  networkMode: PufferNetworkMode;
  pufEthAddress: string;
  pufferDepositorAddress: string;
  pufferVaultAddress: string;
  rateLabel: string;
  updatedAt: string;
  walletPufEthBalance?: string | null;
};

export type PufferVaultOpportunity = {
  accepts: string;
  contractAddress: string;
  id: string;
  name: string;
  outputToken: string;
  summary: string;
};

export type PreparedPufferDeposit = {
  intent: WalletIntent;
  expectedPufEth: string;
  rateLabel: string;
};
