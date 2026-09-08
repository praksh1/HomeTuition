import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, Text, View } from "react-native";

import { HIT_SLOP_MIN, space as staticSpace } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  missingOptional,
  programTypeLabel,
  referenceBlock,
  type PublicProgramDetail,
} from "@/utils/programDiscovery";
import { ProgramBackControl, ProgramCardShell, ProgramChip } from "./ProgramPieces";

/**
 * What a student reads before deciding whether a program is for them.
 *
 * ## What is drawn
 *
 * Everything the server sends and nothing it does not. The promise/outcome; who it is for; the
 * starting level; the language; anything needed beforehand; the equipment; a reference the teacher
 * cited; the full learning path with its module order preserved; the teacher's name.
 *
 * ## What is *not* drawn
 *
 * A price, a schedule, seats, ratings, enrolment counts, popularity, reviews or a "verified" mark.
 * The public API deliberately carries none of these; adding any of them here would be the
 * fabrication `.agents/backlog/ui-upgrade-progress.md` tracks. Enrolment is announced as not yet
 * open — a plain sentence rather than a disabled button, because a disabled button is a promise the
 * screen cannot keep.
 *
 * ## The reference disclosure
 *
 * When a teacher cites a curriculum or exam board, the page shows it verbatim and says in plain
 * words that Fadko does not check or endorse it. Endorsement would be the app claiming a review
 * process that does not exist.
 */
export interface ProgramViewProps {
  program: PublicProgramDetail;
  onBack: () => void;
  onOpenTeacher: (teacherId: number) => void;
}

export default function ProgramView({ program, onBack, onOpenTeacher }: ProgramViewProps) {
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const reference = referenceBlock(program);
  const missing = missingOptional(program);

  return (
    <ScrollView
      testID="program-view"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: gutter,
        gap: space.xl,
        paddingBottom: staticSpace.huge,
        /*
          A readable column on a laptop, and nothing at all on a phone.
          The same cap the studio and the teacher dashboard use — see ProgramStudio for the reason.
        */
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
      }}
    >
      <View style={{ gap: space.sm }}>
        <ProgramBackControl
          onPress={onBack}
          testID="program-view-back"
          label="Back to Discover"
          accessibilityLabel="Back to Discover"
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
          <ProgramChip label={programTypeLabel(program.type)} tone="neutral" testID="program-view-type" />
        </View>
        <Text style={[t.title1, { color: colors.foreground }]} testID="program-view-title">
          {program.title || "Untitled program"}
        </Text>
        {program.outcome ? (
          <Text style={[t.body, { color: colors.foreground }]} testID="program-view-outcome">
            {program.outcome}
          </Text>
        ) : null}
      </View>

      {/* --------------------------------------------------------------- summary */}
      {program.summary ? (
        <ProgramCardShell testID="program-view-summary">
          <Text style={[t.callout, { color: colors.foreground }]}>{program.summary}</Text>
        </ProgramCardShell>
      ) : null}

      {/* --------------------------------------------------------------- who it is for */}
      <Section title="Who it is for" testID="program-view-who">
        <Line label="Right for" value={program.intendedLearner} testID="program-view-intended-learner" />
        <Line label="Starting level" value={program.startingLevel} testID="program-view-starting-level" />
        <Line label="Taught in" value={program.teachingLanguage} testID="program-view-language" />
      </Section>

      {/* --------------------------------------------------------------- requirements */}
      {(program.prerequisites || program.equipment) ? (
        <Section title="Before you start" testID="program-view-requirements">
          {program.prerequisites ? (
            <Line label="What to know first" value={program.prerequisites} testID="program-view-prerequisites" />
          ) : null}
          {program.equipment ? (
            <Line label="What to bring" value={program.equipment} testID="program-view-equipment" />
          ) : null}
        </Section>
      ) : null}

      {/* --------------------------------------------------------------- reference */}
      {reference ? (
        <Section title="Curriculum or reference" testID="program-view-reference">
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>{reference.name}</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]} testID="program-view-reference-disclosure">
            {reference.disclosure}
          </Text>
        </Section>
      ) : null}

      {/* --------------------------------------------------------------- learning path */}
      <Section title="Learning path" testID="program-view-path">
        {program.modules.length === 0 ? (
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            The teacher has not yet published any steps.
          </Text>
        ) : (
          <View style={{ gap: space.sm }}>
            {program.modules.map((module, index) => (
              <ProgramCardShell key={index} testID={`program-view-module-${index}`}>
                <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                  <View
                    style={{
                      minWidth: HIT_SLOP_MIN, height: HIT_SLOP_MIN,
                      borderRadius: radius.pill, backgroundColor: colors.actionSoft,
                      alignItems: "center", justifyContent: "center",
                      paddingHorizontal: space.xs,
                    }}
                  >
                    <Text style={[t.overline, { color: colors.primary }]}>STEP {index + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: space.xxs }}>
                    <Text style={[t.title3, { color: colors.foreground }]}>{module.title}</Text>
                    {module.outcome ? (
                      <Text style={[t.callout, { color: colors.foreground }]}>{module.outcome}</Text>
                    ) : null}
                    {module.description ? (
                      <Text style={[t.callout, { color: colors.mutedForeground }]}>{module.description}</Text>
                    ) : null}
                  </View>
                </View>
              </ProgramCardShell>
            ))}
          </View>
        )}
      </Section>

      {/* --------------------------------------------------------------- teacher */}
      <Section title="Taught by" testID="program-view-teacher-section">
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{program.teacher.name}</Text>
        <TeacherLink onPress={() => onOpenTeacher(program.teacher.id)} testID="program-view-teacher-link" />
      </Section>

      {/* --------------------------------------------------------------- missing */}
      {missing.length > 0 ? (
        <Text
          style={[t.caption, { color: colors.mutedForeground }]}
          testID="program-view-missing"
        >
          The teacher has not filled in {joinMissing(missing)} for this program yet.
        </Text>
      ) : null}

      {/*
        Enrolment. A plain sentence rather than a disabled Join button.

        No commercial contract exists yet — no price, no schedule, no seat, no refund policy — so
        putting an inert button here would be a promise the screen cannot keep. Students who reach
        this page are told what is true: they can read the program, they can see the teacher, and
        joining is not open.
      */}
      <View
        testID="program-view-not-open"
        style={{
          padding: space.md, backgroundColor: colors.surfaceSunk, borderRadius: radius.md,
          gap: space.xxs,
        }}
      >
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>
          Joining a program is not open yet
        </Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          Fadko is still setting up how a student joins a Learning Program. You can read the whole
          program, look at the teacher, and come back later.
        </Text>
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <Text style={[t.title2, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function Line({ label, value, testID }: { label: string; value: string | null | undefined; testID: string }) {
  const colors = useColors();
  const { t, space } = useLayout();
  const written = (value ?? "").trim();
  if (written.length === 0) return null;
  return (
    <View testID={testID} style={{ gap: space.xxs }}>
      <Text style={[t.caption, { color: colors.inkFaint }]}>{label}</Text>
      <Text style={[t.body, { color: colors.foreground }]}>{written}</Text>
    </View>
  );
}

function TeacherLink({ onPress, testID }: { onPress: () => void; testID: string }) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <Text
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel="View this teacher's page"
      onPress={onPress}
      /*
        The row wrapper is not enough. React Native Web maps `accessibilityRole="link"` on a Text
        to an `<a>`, and the touch-target check sizes that element — a wrapping View with a tall
        `minHeight` does not lift it. `lineHeight` on the Text itself is what gives the anchor a
        real 44-point box; `alignSelf: flex-start` keeps the tap area off the rest of the row.
      */
      style={[
        t.bodyStrong,
        {
          color: colors.primary,
          minHeight: HIT_SLOP_MIN,
          lineHeight: HIT_SLOP_MIN,
          alignSelf: "flex-start",
          paddingHorizontal: space.xxs,
        },
      ]}
    >
      View teacher’s page ›
    </Text>
  );
}

/**
 * Written as English rather than mechanically joined with commas, so a page that has *one* thing
 * missing does not say "who it is for," on its own with a trailing comma.
 */
function joinMissing(list: string[]): string {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  const head = list.slice(0, -1).join(", ");
  const tail = list[list.length - 1];
  return `${head} and ${tail}`;
}
