import type { PermitReview, RiskSeverity } from "@/types/security";

export type RiskDecision = {
  severity: RiskSeverity;
  canProceed: boolean;
  reasons: string[];
};

const severityRank: Record<RiskSeverity, number> = {
  info: 0,
  warning: 1,
  danger: 2,
  block: 3,
};

export function evaluatePermitReview(review: PermitReview): RiskDecision {
  const reasons: string[] = [];
  let severity = review.severity;

  if (!review.amount.toLowerCase().includes("exact")) {
    severity = "danger";
    reasons.push("Token approval amount is not exact.");
  }

  if (review.amount.toLowerCase().includes("unlimited")) {
    severity = "block";
    reasons.push("Unlimited approvals are blocked.");
  }

  if (!review.spender.startsWith("0x") || review.spender.length < 42) {
    severity = severityRank[severity] >= severityRank.danger ? severity : "danger";
    reasons.push("Spender contract address is incomplete.");
  }

  if (!review.recipient.startsWith("0x") || review.recipient.length < 42) {
    severity = severityRank[severity] >= severityRank.danger ? severity : "danger";
    reasons.push("Recipient wallet address is incomplete.");
  }

  if (reasons.length === 0) {
    reasons.push("Permit2 review includes token, exact amount, spender, recipient, and witness.");
  }

  return {
    canProceed: severity !== "block",
    reasons,
    severity,
  };
}
