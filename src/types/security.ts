export type RiskSeverity = "info" | "warning" | "danger" | "block";

export type PermitReview = {
  id: string;
  title: string;
  severity: RiskSeverity;
  token: string;
  amount: string;
  spender: string;
  witness: string;
  recipient: string;
  chain: string;
  notes: string[];
};
