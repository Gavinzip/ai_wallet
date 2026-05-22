import { useCallback } from "react";
import { useFocusEffect } from "expo-router";

import { AgentChatPanel } from "@/components/agent/agent-chat-panel";
import { Screen } from "@/components/screen";
import { getTokenCoreRuntimeStatus } from "@/services/token-core/token-core-wallet-adapter";
import { useRenaissRecommendations } from "@/state/renaiss-recommendations-context";
import { useSkillRegistry } from "@/state/skill-registry-context";

export function AgentWorkspace() {
  const { skills } = useSkillRegistry();
  const { refresh } = useRenaissRecommendations();
  const enabledAgentSkills = skills.filter((skill) => skill.enabled && skill.category !== "ui");
  const visibleSkills = skills.filter((skill) => skill.enabled);
  const tokenCoreStatus = getTokenCoreRuntimeStatus();
  const signingMode = tokenCoreStatus.mode === "web-token-core" ? "passkey" : "password";

  useFocusEffect(
    useCallback(() => {
      void refresh({ force: true, reason: "agent-focus" }).catch(() => {
        // The recommendation panel keeps the last cache visible while background refresh retries.
      });
    }, [refresh]),
  );

  return (
    <Screen contentContainerStyle={{ gap: 16, paddingTop: 18 }}>
      <AgentChatPanel
        enabledSkills={enabledAgentSkills}
        signingMode={signingMode}
        tokenCoreReady={tokenCoreStatus.hasTokenCoreRuntime}
        visibleSkills={visibleSkills}
      />
    </Screen>
  );
}
