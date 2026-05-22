import { Text, View } from "react-native";

import { BscDefiSection } from "@/components/defi/bsc-defi-section";
import { PartnerShowcase } from "@/components/partners/partner-showcase";
import { RenaissAlertFeed } from "@/components/renaiss/renaiss-alert-feed";
import { Screen } from "@/components/screen";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillImportForm } from "@/components/skills/skill-import-form";
import { useSkillRegistry } from "@/state/skill-registry-context";
import { colors } from "@/theme/tokens";

export function SkillsWorkspace() {
  const { addSkill, skills, toggleSkill } = useSkillRegistry();

  return (
    <Screen>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "800" }}>
          Agent Skills
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 15, lineHeight: 21 }}>
          Import RENAISS buying, security review, or your own skill. Every skill declares the wallet it can use and the policy it must obey.
        </Text>
      </View>

      <SkillImportForm onAddSkill={addSkill} />

      <RenaissAlertFeed />

      <BscDefiSection />

      <PartnerShowcase />

      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>
          Registry
        </Text>
        {skills.map((skill) => (
          <SkillCard key={skill.id} onToggle={toggleSkill} skill={skill} />
        ))}
      </View>
    </Screen>
  );
}
