import { getAgentApiBaseUrl } from "@/services/api-base-url";
import type { AgentMessage, AgentSkill, RenaissAnalysisMessage } from "@/types/agent";
import type { WalletIntent } from "@/types/intent";

export type AgentChatResponse = {
  intent: WalletIntent | null;
  message: string;
  model: string;
  renaissAnalysis?: RenaissAnalysisMessage;
};

export async function sendAgentChat(
  messages: AgentMessage[],
  enabledSkills: AgentSkill[],
  options: { walletAddress?: string | null } = {},
): Promise<AgentChatResponse> {
  const response = await fetch(`${getAgentApiBaseUrl("agent chat API")}/api/agent/chat`, {
    body: JSON.stringify({
      enabledSkills: enabledSkills.map((skill) => ({
        name: skill.name,
        policySummary: skill.policySummary,
        trigger: skill.trigger,
      })),
      messages: messages
        .filter((message) => message.from === "agent" || message.from === "user")
        .map((message) => ({
          content: serializeAgentMessage(message),
          role: message.from === "agent" ? "assistant" : "user",
        })),
      walletAddress: options.walletAddress ?? null,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Agent chat request failed.");
  }

  return payload as AgentChatResponse;
}

function serializeAgentMessage(message: AgentMessage) {
  if (!message.renaissAnalysis) return message.text;

  const { item, review } = message.renaissAnalysis;
  return [
    message.text,
    `RENAISS_CONTEXT_JSON:${JSON.stringify({
      action: item.action,
      ask_price_usd: item.ask_price_usd,
      best_market: item.best_market,
      confidence: review.confidence,
      estimated_diff_pct: item.estimated_diff_pct,
      estimated_profit_usd: item.estimated_profit_usd,
      image_url: item.image_url ?? null,
      item_id: item.item_id,
      name: item.name,
      renaiss_url: item.renaiss_url ?? null,
      verdict: review.verdict,
    })}`,
  ].join("\n");
}
