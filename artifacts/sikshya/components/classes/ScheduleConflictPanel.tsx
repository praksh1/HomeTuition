import React from "react";
import { Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import type { ScheduleConflict } from "@/utils/programBatches";
import { ProgramButton, ProgramNotice } from "@/components/programs/ProgramPieces";

export function ScheduleConflictPanel({ conflicts, formatDate, onEdit, onOpen, onRefresh, busy }: {
  conflicts: ScheduleConflict[]; formatDate: (instant: string) => string;
  onEdit: (index: number) => void; onOpen: (source: NonNullable<ScheduleConflict["source"]>) => void;
  onRefresh: () => void; busy: boolean;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  return <ProgramNotice title="Fix overlapping times" tone="stopped">
    {conflicts.map((conflict, index) => <View key={index} style={{ gap: space.xs }}>
      <Text style={[t.bodyStrong, { color: colors.destructive }]}>Lesson {conflict.lessonIndex + 1} · {formatDate(conflict.startsAt)}</Text>
      <Text style={[t.callout, { color: colors.foreground }]}>Overlaps {conflict.otherLessonIndex !== null ? `lesson ${conflict.otherLessonIndex + 1} in this class` : `“${conflict.otherTitle}”`} · {formatDate(conflict.otherStartsAt)} · {conflict.otherDurationMinutes} min</Text>
      <ProgramButton label={`Edit lesson ${conflict.lessonIndex + 1} time`} disabled={busy} onPress={() => onEdit(conflict.lessonIndex)} />
      {conflict.otherLessonIndex !== null ? <ProgramButton label={`Edit lesson ${conflict.otherLessonIndex + 1} instead`} disabled={busy} emphasis="quiet" onPress={() => onEdit(conflict.otherLessonIndex!)} />
        : conflict.source?.locked === "paid" ? <Text style={[t.callout, { color: colors.destructive }]}>Students have paid for the other class. Change this lesson.</Text>
        : conflict.source?.locked === null && ["class", "batch"].includes(conflict.source.kind) ? <ProgramButton label="Keep this time · edit other schedule" emphasis="quiet" disabled={busy} onPress={() => onOpen(conflict.source!)} />
        : <Text style={[t.callout, { color: colors.mutedForeground }]}>Keep the other commitment. Change this lesson.</Text>}
    </View>)}
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Save after editing to recheck. Up to 10 overlaps shown.</Text>
    <ProgramButton label="Recheck dates" emphasis="quiet" disabled={busy} onPress={onRefresh} />
  </ProgramNotice>;
}
