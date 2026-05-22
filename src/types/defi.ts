import type { RiskSeverity } from "@/types/security";

export type BscDefiProtocol = {
  id: string;
  name: string;
  category: "Swap" | "Lending" | "Liquid staking";
  chain: "BNB Smart Chain";
  description: string;
  dappUrl: string;
  docsUrl: string;
  sourceLabel: string;
  riskLevel: RiskSeverity;
  capabilities: string[];
  safetyChecks: string[];
};
