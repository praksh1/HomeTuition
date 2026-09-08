import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { type ProgramCardFields } from "@/utils/programDiscovery";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { ProgramChip } from "./ProgramPieces";

/**
 * The card a student sees on Discover and — with a bit more room — on any list of programs.
 *
 * ## What is on it, and what is not
 *
 * A title (outcome-first, from the teacher), the program's kind, the summary sentence, who it is
 * for when the row carries it, the teaching language, the teacher's display name, and a way in.
 * **No price, seats, ratings, popularity, enrolment totals or reviews** — the public API does not
 * carry any of those, and every prior screen in this app that invented one is written down in
 * `.agents/backlog/ui-upgrade-progress.md`.
 *
 * ## Why it is quiet
 *
 * A card is scanned before it is read. Two things earn ink: the title, and one royal-blue action
 * that says what pressing does. Everything else is muted, in the same tokens the studio uses, so a
 * list of programs reads editorially rather than as an admin table full of chips.
 */
export interface ProgramCardProps {
  fields: ProgramCardFields;
  onPress: () => void;
  /** For lists, so each card gets a stable id. */
  testID?: string;
}

export default function ProgramCard({ fields, onPress, testID }: ProgramCardProps) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`${fields.title}, by ${fields.teacherName}. ${fields.typeLabel}. View program.`}
      onPress={onPress}
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: space.lg,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
        <ProgramChip label={fields.typeLabel} tone="neutral" testID={testID ? `${testID}-type` : undefined} />
      </View>

      <Text
        style={[t.title3, { color: colors.foreground }]}
        // Titles wrap to as many lines as they need. Truncation would hide the promise the whole
        // card is built around, and the fallback title "Untitled program" is short by construction.
      >
        {fields.title}
      </Text>

      {fields.outcome ? (
        <Text style={[t.body, { color: colors.foreground }]} testID={testID ? `${testID}-outcome` : undefined}>
          {fields.outcome}
        </Text>
      ) : null}

      {fields.summary ? (
        <Text style={[t.callout, { color: colors.mutedForeground }]} numberOfLines={3}>
          {fields.summary}
        </Text>
      ) : null}

      <View style={{ gap: space.xxs }}>
        {fields.intendedLearnerLine ? (
          <ProgramMeta
            icon="users"
            label="Who it is for"
            value={fields.intendedLearnerLine}
            testID={testID ? `${testID}-learner` : undefined}
          />
        ) : null}
        {fields.teachingLanguage ? (
          <ProgramMeta
            icon="message-square"
            label="Taught in"
            value={fields.teachingLanguage}
            testID={testID ? `${testID}-language` : undefined}
          />
        ) : null}
        <ProgramMeta
          icon="user"
          label="Taught by"
          value={fields.teacherName}
          testID={testID ? `${testID}-teacher` : undefined}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: space.xxs,
          minHeight: HIT_SLOP_MIN,
        }}
      >
        <Text style={[t.bodyStrong, { color: colors.primary }]}>View program</Text>
        <Feather name="chevron-right" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

function ProgramMeta({
  icon,
  label,
  value,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View
      testID={testID}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Feather name={icon} size={14} color={colors.inkFaint} />
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text style={[t.caption, { color: colors.inkFaint }]}>{label}</Text>
        <Text style={[t.callout, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}
