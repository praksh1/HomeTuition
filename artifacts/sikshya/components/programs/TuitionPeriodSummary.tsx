import React from "react";
import { Text, View } from "react-native";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { batchDateValue, lessonDraft, type TuitionPeriod } from "@/utils/programBatches";
import { toBikramSambat } from "@/utils/nepaliDate";
import { ProgramCardShell } from "./ProgramPieces";

export function TuitionPeriodSummary({ period, provisional = false }: { period: TuitionPeriod; provisional?: boolean }) {
  const colors = useColors();
  const { t, space } = useLayout();
  const dates = useDates();
  const label = (instant: string) => {
    const local = lessonDraft({ startsAt: instant, durationMinutes: 60 });
    const day = batchDateValue(local.date)!;
    const bs = toBikramSambat(day) ? `${dates.format(day, { system: "bs" })} BS` : "BS conversion unavailable";
    return `${bs} (${dates.format(day, { system: "ad" })} AD) · ${local.time} Nepal time`;
  };
  return <ProgramCardShell testID="tuition-period-summary">
    <Text style={[t.title3, { color: colors.foreground }]}>Ongoing tuition · Period {period.index + 1}</Text>
    <View style={{ gap: space.xs }}>
      <Text style={[t.callout, { color: colors.foreground }]}>Starts: {label(period.startsAt)}</Text>
      <Text style={[t.callout, { color: colors.foreground }]}>Ends: {label(period.endsAt)} (not included)</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>The next period begins at this end time, in the same group. Thirty days is not thirty lessons or a calendar month.</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{provisional ? "These dates follow Lesson 1 until first publication. Publishing fixes this group's period dates." : "These group dates are fixed. Each period needs its own published lessons and price."}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Planned payment rule: pay before the period starts. No automatic charge or mid-period joining. Checkout is not open yet.</Text>
    </View>
  </ProgramCardShell>;
}
