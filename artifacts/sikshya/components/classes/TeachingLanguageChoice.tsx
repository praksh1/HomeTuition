import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { ProgramButton } from "@/components/programs/ProgramPieces";

export function TeachingLanguageChoice({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [other, setOther] = useState(false);
  const both = ["english and nepali", "nepali and english"].includes(value.toLowerCase());
  const custom = other || (!!value && !both && !["English", "Nepali"].includes(value));
  return <View style={{ gap: space.sm }}>
    <Text style={[t.bodyStrong, { color: colors.foreground }]}>Teaching language</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
      {["English", "Nepali", "Both", "Other"].map((label) => <ProgramButton key={label}
        label={label} disabled={disabled}
        emphasis={(label === "Other" ? custom : label === "Both" ? both && !custom : value === label && !custom) ? "secondary" : "quiet"}
        onPress={() => { setOther(label === "Other"); onChange(label === "Other" ? "" : label === "Both" ? "English and Nepali" : label); }} />)}
    </View>
    {custom && <TextInput accessibilityLabel="Other teaching language" placeholder="For example, Korean" value={value}
      editable={!disabled} onChangeText={onChange} maxLength={100} placeholderTextColor={colors.mutedForeground}
      style={[t.body, { minHeight: HIT_SLOP_MIN, padding: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.foreground, backgroundColor: colors.card }]} />}
  </View>;
}
