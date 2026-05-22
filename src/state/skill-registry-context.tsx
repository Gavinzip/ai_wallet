import React, { createContext, useCallback, useMemo, useState, type PropsWithChildren } from "react";

import { builtInSkills } from "@/data/agent";
import type { AgentSkill } from "@/types/agent";

type SkillRegistryContextValue = {
  skills: AgentSkill[];
  addSkill: (skill: Pick<AgentSkill, "name" | "description" | "trigger" | "policySummary">) => void;
  toggleSkill: (id: string) => void;
};

const SkillRegistryContext = createContext<SkillRegistryContextValue | null>(null);

export function SkillRegistryProvider({ children }: PropsWithChildren) {
  const [skills, setSkills] = useState<AgentSkill[]>(builtInSkills);

  const addSkill = useCallback<SkillRegistryContextValue["addSkill"]>((skill) => {
    setSkills((current) => [
      {
        ...skill,
        id: `custom-${Date.now()}`,
        category: "custom",
        enabled: true,
        requiredWallet: "token-core-agent-wallet",
        riskLevel: "warning",
        source: "user-defined",
      },
      ...current,
    ]);
  }, []);

  const toggleSkill = useCallback((id: string) => {
    setSkills((current) =>
      current.map((skill) =>
        skill.id === id ? { ...skill, enabled: !skill.enabled } : skill,
      ),
    );
  }, []);

  const value = useMemo(
    () => ({
      addSkill,
      skills,
      toggleSkill,
    }),
    [addSkill, skills, toggleSkill],
  );

  return (
    <SkillRegistryContext.Provider value={value}>
      {children}
    </SkillRegistryContext.Provider>
  );
}

export function useSkillRegistry() {
  const value = React.use(SkillRegistryContext);

  if (!value) {
    throw new Error("useSkillRegistry must be used inside SkillRegistryProvider");
  }

  return value;
}
