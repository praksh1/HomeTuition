import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, Text, View } from "react-native";

import Skeleton from "@/components/Skeleton";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  groupPrograms,
  programStatusChip,
  programTitle,
  programTypeLabel,
  type ProgramSummary,
} from "@/utils/learningProgramUi";
import {
  ProgramBackControl,
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramFailure,
} from "./ProgramPieces";

/**
 * A teacher's Learning Programs, all of them, in one calm list.
 *
 * ## What is deliberately not here
 *
 * No student count, no rating, no earnings, no "popular", no availability, no price. Not because
 * they would be hard, but because **none of them exists**: nobody can enrol on a program yet, and
 * `.agents/backlog/ui-upgrade-progress.md` records eighteen screens that showed a number with
 * nothing behind it. A card with nowhere to put one is a card that cannot.
 *
 * What each card carries is what the server actually knows: the name the teacher gave it, what kind
 * of program it is, and which of the four states it is in.
 *
 * ## Three pictures, never one
 *
 * Loading is skeletons in the shape of the cards that are coming. Failed says so and offers a
 * retry. Empty explains what a program *is*, because a teacher who has never made one does not yet
 * know it is different from a class — and that is the single most likely misunderstanding this
 * screen has to prevent.
 */

export interface ProgramHomeProps {
  programs: ProgramSummary[];
  loading: boolean;
  /** Null when the load succeeded. A message when it did not — never rendered as "no programs". */
  failure: string | null;
  onRetry: () => void;
  onOpen: (id: number) => void;
  onCreate: () => void;
  onBack: () => void;
  onViewStatement?: () => void;
}

export default function ProgramHome({
  programs,
  loading,
  failure,
  onRetry,
  onOpen,
  onCreate,
  onBack,
  onViewStatement,
}: ProgramHomeProps) {
  const colors = useColors();
  const { t, gutter, space } = useLayout();
  const groups = groupPrograms(programs);

  return (
    <ScrollView
      testID="program-home"
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
      <ProgramBackControl
        onPress={onBack}
        testID="program-home-back"
        label="Back to Dashboard"
        accessibilityLabel="Back to teacher dashboard"
      />
      <View style={{ gap: space.xxs }}>
        <Text style={[t.title1, { color: colors.foreground }]}>Programs</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          A program is the learning journey you offer. Classes are how you deliver it.
        </Text>
      </View>
      {onViewStatement ? (
        <ProgramButton
          testID="program-home-statement"
          label="Money rehearsal"
          icon="bar-chart-2"
          emphasis="secondary"
          spoken="Open the test Program money statement"
          onPress={onViewStatement}
          grow
        />
      ) : null}

      {failure ? <ProgramFailure message={failure} onRetry={onRetry} /> : null}

      {loading && !failure ? (
        <View testID="program-home-loading" style={{ gap: space.sm }}>
          {[0, 1, 2].map((row) => (
            <ProgramCardShell key={row}>
              <Skeleton width="60%" height={18} />
              <Skeleton width="35%" height={13} />
            </ProgramCardShell>
          ))}
        </View>
      ) : null}

      {!loading && !failure && programs.length === 0 ? <EmptyPrograms onCreate={onCreate} /> : null}

      {!loading && !failure && programs.length > 0 ? (
        <>
          {groups.map((group) => (
            <View key={group.id} testID={`program-group-${group.id}`} style={{ gap: space.sm }}>
              <Text style={[t.overline, { color: colors.inkFaint, letterSpacing: 0.6 }]}>
                {group.title.toUpperCase()}
              </Text>
              {group.programs.map((program) => (
                <ProgramRow key={program.id} program={program} onOpen={onOpen} />
              ))}
            </View>
          ))}
          {/*
            One primary action on the screen, at the end of the list rather than floating over it.

            A floating button would sit on top of the last card on a 390pt phone, and this list is
            short by nature — a teacher has a handful of programs, not a feed.
          */}
          <ProgramButton
            testID="program-home-create"
            label="New program"
            icon="plus"
            emphasis="primary"
            spoken="Start a new learning program"
            onPress={onCreate}
            grow
          />
        </>
      ) : null}
    </ScrollView>
  );
}

function ProgramRow({
  program,
  onOpen,
}: {
  program: ProgramSummary;
  onOpen: (id: number) => void;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const chip = programStatusChip(program);
  const title = programTitle(program);

  return (
    <ProgramCardShell
      testID={`program-card-${program.id}`}
      onPress={() => onOpen(program.id)}
      accessibilityLabel={`${title}. ${programTypeLabel(program.type)}. ${chip.label}.`}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text style={[t.title3, { color: colors.foreground }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[t.caption, { color: colors.inkFaint }]}>{programTypeLabel(program.type)}</Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.inkFaint} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
        <ProgramChip testID={`program-status-${program.id}`} label={chip.label} tone={chip.tone} />
        {chip.hint ? (
          <Text style={[t.caption, { color: colors.mutedForeground, flexShrink: 1 }]}>{chip.hint}</Text>
        ) : null}
      </View>
    </ProgramCardShell>
  );
}

/**
 * The empty state, which is the most important screen in this feature.
 *
 * A teacher arriving here has never made a program and has every reason to think it is another word
 * for a class. So it says what a program *is*, in one sentence, and what it is not — and then
 * offers the one action. It does not offer a tour, a sample, or a set of illustrations.
 */
function EmptyPrograms({ onCreate }: { onCreate: () => void }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <View
      testID="program-home-empty"
      style={{
        gap: space.md,
        padding: space.xl,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View
        style={{
          width: space.huge,
          height: space.huge,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.actionSoft,
        }}
      >
        <Feather name="map" size={22} color={colors.primary} />
      </View>
      <Text style={[t.title2, { color: colors.foreground }]}>You have no programs yet</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>
        A program is a learning journey you can offer again and again — what students will be able to
        do at the end, who it suits, and the steps to get there.
      </Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>
        It is not a single class. You write it once, and the classes you run deliver it.
      </Text>
      <ProgramButton
        testID="program-home-create-first"
        label="Create your first program"
        icon="plus"
        emphasis="primary"
        spoken="Start writing your first learning program"
        onPress={onCreate}
        grow
      />
    </View>
  );
}
