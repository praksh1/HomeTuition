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
import { type ProgramBatchSnapshot } from "@/utils/programBatches";
import { ClassOfferCard } from "./ClassOfferCard";

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
 * When a program cites a curriculum or exam board, the page shows the name verbatim and says in
 * plain words that Fadko has not independently verified or endorsed it — the same sentence for
 * every value of `referenceSource`, because no endorsement process exists. Calling an official
 * reference "teacher supplied" (the older wording did) would be a false provenance claim.
 */
export interface ProgramViewProps {
  program: PublicProgramDetail;
  onBack: () => void;
  onOpenTeacher: (teacherId: number) => void;
  testEnrollment?: {
    totalTuitionNpr: number;
    paidLessonCount: number;
    allocations: Array<{ lessonNumber: number; state: string }>;
  } | null;
  testEnrollmentUnavailable?: boolean;
  /** Published, immutable offers. Empty means the teacher has not opened a scheduled batch. */
  batches?: ProgramBatchSnapshot[];
  batchesUnavailable?: boolean;
}

export default function ProgramView({ program, onBack, onOpenTeacher, testEnrollment, testEnrollmentUnavailable = false, batches = [], batchesUnavailable = false }: ProgramViewProps) {
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
          <ProgramChip label={program.presentation === "class" ? "Class" : programTypeLabel(program.type)} tone="neutral" testID="program-view-type" />
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
      {program.presentation !== "class" ? <Section title="Who it is for" testID="program-view-who">
        <Line label="Right for" value={program.intendedLearner} testID="program-view-intended-learner" />
        <Line label="Starting level" value={program.startingLevel} testID="program-view-starting-level" />
        <Line label="Taught in" value={program.teachingLanguage} testID="program-view-language" />
      </Section> : <Section title="Teaching language" testID="class-language"><Text style={[t.body, { color: colors.foreground }]}>{program.teachingLanguage}</Text></Section>}

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
      {program.presentation !== "class" ? <Section title="Learning path" testID="program-view-path">
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
      </Section> : program.outline ? <Section title="What we will cover" testID="class-outline"><Text style={[t.body, { color: colors.foreground }]}>{program.outline}</Text></Section> : null}

      {/* --------------------------------------------------------------- teacher */}
      <Section title="Taught by" testID="program-view-teacher-section">
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{program.teacher.name}</Text>
        <TeacherLink onPress={() => onOpenTeacher(program.teacher.id)} testID="program-view-teacher-link" />
      </Section>

      {/* --------------------------------------------------------------- scheduled batches */}
      <Section title={program.presentation === "class" ? "Dates and price" : "Upcoming batches"} testID="program-view-batches">
        {batchesUnavailable ? (
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Fadko could not check this Program’s upcoming dates and price. Try this page again.
          </Text>
        ) : batches.length === 0 ? (
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            This teacher has not published dates and a price for an upcoming batch yet.
          </Text>
        ) : (
          <View style={{ gap: space.sm }}>
            {batches.map((batch) => <ClassOfferCard key={batch.batchId} batch={batch} />)}
          </View>
        )}
      </Section>

      {/* --------------------------------------------------------------- missing */}
      {program.presentation !== "class" && missing.length > 0 ? (
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
        testID={testEnrollment ? "program-view-test-enrolled" : testEnrollmentUnavailable ? "program-view-test-unknown" : "program-view-not-open"}
        style={{
          padding: space.md, backgroundColor: colors.surfaceSunk, borderRadius: radius.md,
          gap: space.xxs,
        }}
      >
        {testEnrollment ? (
          <>
            <Text style={[t.bodyStrong, { color: colors.warn }]}>TEST enrolment — no payment was processed</Text>
            <Text style={[t.callout, { color: colors.foreground }]}>This is a rehearsal place created by an operator so you can test the Program journey.</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Rehearsal terms: NPR {testEnrollment.totalTuitionNpr.toLocaleString()} across {testEnrollment.paidLessonCount} paid lessons. These figures are not a receipt and cannot be paid out.</Text>
          </>
        ) : testEnrollmentUnavailable ? (
          <>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Your test place could not be checked</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>The Program is available to read, but Fadko could not confirm whether an operator created a rehearsal enrolment for you. Try this page again.</Text>
          </>
        ) : (
          <>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>{program.presentation === "class" ? "Preview only" : "Joining a program is not open yet"}</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Joining and payment are not open yet.</Text>
          </>
        )}
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
