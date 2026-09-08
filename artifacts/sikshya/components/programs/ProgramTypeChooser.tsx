import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { type ProgramTypeChoice, type ProgramType } from "@/utils/learningProgramUi";
import { ProgramBackControl, ProgramCardShell, ProgramFailure } from "./ProgramPieces";

/**
 * The first decision, and the only one on the screen.
 *
 * Five choices, each with one sentence saying what it is for. The sentence is the whole point: a
 * teacher choosing "Practical skill" over "Custom program" is choosing which questions they will be
 * asked, and the blueprint is explicit that a guitar teacher must not be pushed through a school
 * form. Getting that right here is what makes the studio feel like it was built for them.
 *
 * ## The server decides what is here; this file decides how it reads
 *
 * `choices` is `offerableTypes(templates)` — the kinds of program the API actually returned a
 * template for, intersected with the ones this build knows how to describe. The wording, icon and
 * order are local, so a template gaining a field cannot silently change what the menu says; the
 * availability is the server's, so the menu cannot offer a kind of program the API would refuse to
 * create. An earlier version drew all five whatever came back, which meant a teacher could tap a
 * card and be handed an error for a choice the screen had invited.
 *
 * A response the app can make nothing of is a blank menu with an explanation, not five cards.
 */

export interface ProgramTypeChooserProps {
  /** What the server said it can make, already narrowed to what this build can describe. */
  choices: readonly ProgramTypeChoice[];
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
  choices,
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
      <ProgramBackControl onPress={onCancel} testID="program-type-back" />

      <View style={{ gap: space.xxs }}>
        <Text style={[t.title1, { color: colors.foreground }]}>What kind of program?</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          This decides what you will be asked next. You can change it while it is still a draft.
        </Text>
      </View>

      {failure ? <ProgramFailure message={failure} onRetry={onRetry} testID="program-type-failure" /> : null}

      <View style={{ gap: space.sm }}>
        {choices.map((choice) => {
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

      {!loading && !failure && choices.length === 0 ? (
        /*
          The server offered nothing this app can draw.

          Not an error and not an empty page: the honest reading is that the two halves are out of
          step — an app older than the API, or an API that has stopped offering the kinds this build
          knows. Saying so beats five cards that would each fail on tap.
        */
        <Text testID="program-type-none" style={[t.callout, { color: colors.mutedForeground }]}>
          Fadko is not offering any kind of program this version of the app can set up. Update the
          app, or try again shortly.
        </Text>
      ) : null}

    </ScrollView>
  );
}
