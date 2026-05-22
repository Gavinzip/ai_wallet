import type {
  RenaissAiReviewResponse,
  RenaissAnalyzeResponse,
  RenaissOpportunity,
} from "@/types/renaiss-monitor";

export type AgentMessage = {
  id: string;
  from: "agent" | "user" | "system";
  model?: string;
  renaissAnalysis?: RenaissAnalysisMessage;
  text: string;
  timestamp: string;
};

export type RenaissAnalysisMessage = {
  analysis?: RenaissAnalyzeResponse | null;
  item: RenaissOpportunity;
  review: RenaissAiReviewResponse;
};

export type AgentStepStatus = "done" | "active" | "waiting" | "blocked";

export type AgentRunStep = {
  id: string;
  label: string;
  detail: string;
  status: AgentStepStatus;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  category: "trading" | "security" | "wallet" | "ui" | "custom";
  enabled: boolean;
  source: "built-in" | "imported" | "user-defined";
  requiredWallet: "token-core-agent-wallet" | "any-wallet";
  riskLevel: "info" | "warning" | "danger" | "block";
  trigger: string;
  policySummary: string;
};
