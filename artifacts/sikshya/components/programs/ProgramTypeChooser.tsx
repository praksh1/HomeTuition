import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { PROGRAM_TYPE_CHOICES, type ProgramType } from "@/utils/learningProgramUi";
import { ProgramCardShell, ProgramFailure } from "./ProgramPieces";

/**
 * The first decision, and the only one on the screen.
 *
 * Five choices, each with one sentence saying what it is for. The sentence is the whole point: a
 * teacher choosing "Practical skill" over "Custom program" is choosing which questions they will be
 * asked, and the blueprint is explicit that a guitar teacher must not be pushed through a school
 * form. Getting that right here is what makes the studio feel like it was built for them.
 *
 * ## Why the copy is not generated from the server's templates
 *
 * The templates carry the prompts used *inside* the studio, and the server owns those. This screen
 * is a menu, and a menu whose wording changes because a template gained a field is a menu that
 * drifts. The types themselves are the shared contract — five, and the server refuses a sixth.
 *
 * The templates are still fetched, because the studio needs them; a failure here is shown honestly
 * rather than falling through to a screen that asks the wrong questions.
 */

export interface ProgramTypeChooserProps {
  /** True while the server's templates are still on their way. */
  loading: boolean;
  failure: string | null;
  onRetry: () => void;
  /** The type the teacher chose. The screen creates the draft and opens the studio. */
  onChoose: (type: ProgramType) => void;
  /** Set while a draft is being created, so a second tap cannot make a second program. */
  creating: ProgramType | null;
  onCancel: () => void;
}

export default function ProgramTypeChooser({
  loading,
  failure,
  onRetry,
  onChoose,
  creating,
  onCancel,
}: ProgramTypeChooserProps) {
  const colors = useColors();
  const { t, gutter, space } = useLayout();

  return (
    <ScrollView
      testID="program-type-chooser"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: gutter,
        gap: space.lg,
        paddingBottom: space.huge,
        /*
          A readable column on a laptop, and nothing at all on a phone.

          The same cap the teacher dashboard uses. Without it the cards ran the full 1440 points and
          the page read as an admin table stretched across a metre of screen — which is the one look
          this studio is meant not to be.
        */
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
      }}
    >
      <View style={{ gap: space.xxs }}>
        <Text style={[t.title1, { color: colors.foreground }]}>What kind of program?</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          This decides what you will be asked next. You can change it while it is still a draft.
        </Text>
      </View>

      {failure ? <ProgramFailure message={failure} onRetry={onRetry} testID="program-type-failure" /> : null}

      <View style={{ gap: space.sm }}>
        {PROGRAM_TYPE_CHOICES.map((choice) => {
          const busy = creating === choice.type;
          const blocked = creating !== null && !busy;
          return (
            <ProgramCardShell
              key={choice.type}
              testID={`program-type-${choice.type}`}
              onPress={blocked || loading ? undefined : () => onChoose(choice.type)}
              accessibilityLabel={`${choice.name}. ${choice.blurb}`}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, opacity: blocked ? 0.5 : 1 }}>
                <View
                  style={{
                    width: space.xxl,
                    height: space.xxl,
                    borderRadius: space.xs,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.actionSoft,
                  }}
                >
                  <Feather
                    name={choice.icon as React.ComponentProps<typeof Feather>["name"]}
                    size={18}
                    color={colors.primary}
                  />
                </View>
                <View style={{ flex: 1, gap: space.xxs }}>
                  <Text style={[t.title3, { color: colors.foreground }]}>{choice.name}</Text>
                  <Text style={[t.callout, { color: colors.mutedForeground }]}>{choice.blurb}</Text>
                </View>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="chevron-right" size={20} color={colors.inkFaint} />
                )}
              </View>
            </ProgramCardShell>
          );
        })}
      </View>

      {/*
        Leaving is always available, and leaving loses nothing.

        Nothing has been created until a type is chosen, so this is a plain way back rather than a
        confirmation. The brief's rule — a teacher must be able to leave with an incomplete draft and
        continue later — starts here, with not being trapped before there is even a draft.
      */}
      <Text
        testID="program-type-cancel"
        accessibilityRole="link"
        onPress={onCancel}
        style={[t.bodyStrong, { color: colors.primary, textAlign: "center", paddingVertical: space.sm }]}
      >
        Not now
      </Text>
    </ScrollView>
  );
}
