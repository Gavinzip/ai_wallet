import { Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { colors, radii, shadows } from "@/theme/tokens";

type SkillImportFormProps = {
  onAddSkill: (skill: {
    name: string;
    description: string;
    trigger: string;
    policySummary: string;
  }) => void;
};

export function SkillImportForm({ onAddSkill }: SkillImportFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState("");
  const [policySummary, setPolicySummary] = useState("");

  const canAdd = name.trim() && description.trim() && trigger.trim() && policySummary.trim();

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: radii.lg,
        borderWidth: 1,
        boxShadow: shadows.soft,
        gap: 14,
        padding: 16,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: "800" }}>
          Import or Define Skill
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          A skill is an agent capability plus a trigger and wallet safety policy.
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <Input label="Name" onChangeText={setName} placeholder="Skill name" value={name} />
        <Input
          label="Description"
          multiline
          onChangeText={setDescription}
          placeholder="What this skill can actually do"
          value={description}
        />
        <Input
          label="Trigger"
          onChangeText={setTrigger}
          placeholder="When the agent may run this skill"
          value={trigger}
        />
        <Input
          label="Policy"
          multiline
          onChangeText={setPolicySummary}
          placeholder="Limits, approvals, and safety boundaries"
          value={policySummary}
        />
      </View>

      <Pressable
        accessibilityLabel="Add custom skill"
        accessibilityRole="button"
        disabled={!canAdd}
        onPress={() => {
          if (!canAdd) return;
          onAddSkill({
            description: description.trim(),
            name: name.trim(),
            policySummary: policySummary.trim(),
            trigger: trigger.trim(),
          });
          setName("");
          setDescription("");
          setTrigger("");
          setPolicySummary("");
        }}
        style={{
          alignItems: "center",
          backgroundColor: canAdd ? colors.ink : colors.surfaceStrong,
          borderRadius: radii.pill,
          flexDirection: "row",
          gap: 8,
          justifyContent: "center",
          minHeight: 50,
        }}
      >
        <Plus color={canAdd ? "#FFFFFF" : colors.textMuted} size={18} strokeWidth={2.4} />
        <Text
          style={{
            color: canAdd ? "#FFFFFF" : colors.textMuted,
            fontSize: 16,
            fontWeight: "800",
          }}
        >
          Add Skill
        </Text>
      </Pressable>
    </View>
  );
}

function Input({
  label,
  multiline,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.textSoft, fontSize: 11, fontWeight: "800" }}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSoft}
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: radii.md,
          color: colors.text,
          fontSize: 15,
          minHeight: multiline ? 82 : 46,
          paddingHorizontal: 12,
          paddingVertical: 11,
          textAlignVertical: multiline ? "top" : "center",
        }}
        value={value}
      />
    </View>
  );
}
