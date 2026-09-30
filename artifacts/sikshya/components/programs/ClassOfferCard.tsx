import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { batchDateValue, lessonDraft, type ProgramBatchSnapshot } from "@/utils/programBatches";
import { toBikramSambat } from "@/utils/nepaliDate";
import { ProgramButton, ProgramCardShell, ProgramChip } from "./ProgramPieces";
import { BatchTestPanel, type BatchEnrollmentState } from "../classes/BatchTestPanel";

/** Decision first; full timetable and commercial explanations remain one tap away. */
export function ClassOfferCard({ batch, accountRequired = false, returnPath, initiallyEnrolled = false, onEnrollmentStateChange }: { batch: ProgramBatchSnapshot; accountRequired?: boolean; returnPath?: string; initiallyEnrolled?: boolean; onEnrollmentStateChange?: (state: BatchEnrollmentState) => void }) {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [enrollmentState, setEnrollmentState] = useState<BatchEnrollmentState>(initiallyEnrolled ? "enrolled" : "checking");
  // Unknown access is not an invitation to buy again. The embedded panel's existing single GET
  // provides the authoritative answer; no extra enrollment request is made for this chrome.
  const prospect = accountRequired || !batch.testPilotEndsAt || enrollmentState === "not_enrolled";
  const late = batch.joiningPreview?.status === "remaining_lessons";
  const quote = batch.joiningPreview;
  const included = late ? batch.lessons.filter((l) => quote!.lessonPositions.includes(l.position)) : batch.lessons;
  const amount = late ? quote!.amountNpr : batch.totalTuitionNpr;
  const date = (iso: string, both = false) => {
    const local = lessonDraft({ startsAt: iso, durationMinutes: 60 });
    const day = batchDateValue(local.date)!;
    const system = dates.system === "bs" && toBikramSambat(day) ? "bs" : "ad";
    return `${both ? dates.formatBoth(day) : dates.format(day, { system })} ${both ? "BS / AD" : system.toUpperCase()}`;
  };
  const time = (iso: string) => lessonDraft({ startsAt: iso, durationMinutes: 60 }).time;
  const first = included[0];
  const durations = [...new Set(included.map((l) => l.durationMinutes))];
  const average = amount !== null && included.length ? (amount / included.length).toLocaleString("en-NP", { maximumFractionDigits: 2 }) : null;
  if (initiallyEnrolled && !batch.testPilotEndsAt) return <ProgramCardShell testID={`program-view-batch-${batch.batchId}`}>
    <ProgramChip label="Enrolled" tone="live" />
    <Text style={[t.callout, { color: colors.foreground }]}>Open your class for the lesson schedule, materials, homework and messages.</Text>
    <ProgramButton label="Open my class" emphasis="primary" onPress={() => router.push({ pathname: "/class-home", params: { id: String(batch.batchId) } })} />
    <ProgramButton label="View payment history" emphasis="quiet" onPress={() => router.push("/(student)/payments")} />
  </ProgramCardShell>;
  return <ProgramCardShell testID={`program-view-batch-${batch.batchId}`}>
    {prospect ? <><View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space.xs }}>
      <Text style={[t.title2, numeric, { color: colors.primary }]}>{amount === null ? "Price unavailable" : `${late ? "Est. " : ""}NPR ${amount.toLocaleString("en-NP")} / student`}</Text>
      <ProgramChip label={`Up to ${batch.capacity} students`} tone="neutral" />
    </View>
    <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{included.length} {late ? "remaining " : ""}{included.length === 1 ? "lesson" : "lessons"}{durations.length === 1 ? ` · ${durations[0]} min each` : ""}{average ? ` · ≈ NPR ${average} / lesson` : ""}</Text>
    {first ? <Text style={[t.callout, { color: colors.foreground }]}>{late ? "Next lesson" : "Starts"}: {date(first.startsAt)} · {time(first.startsAt)} Nepal time</Text> : null}
    {batch.tuitionPeriod ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Period ends: {date(batch.tuitionPeriod.endsAt)} · {time(batch.tuitionPeriod.endsAt)} Nepal time</Text> : null}
    <Text style={[t.caption, { color: colors.mutedForeground }]}>{batch.testPilotEndsAt ? accountRequired ? "Sign in to continue · no booking is made on this page" : "Review the included lessons before enrolling" : "Enrollment is not open yet. The price shown is for planning, not a payment request."}</Text></> : null}
    {batch.testPilotEndsAt ? <BatchTestPanel batchId={batch.batchId} accountRequired={accountRequired} returnPath={returnPath} onEnrollmentStateChange={(state) => { setEnrollmentState(state); onEnrollmentStateChange?.(state); }} /> : null}
    {prospect ? <><ProgramButton label={scheduleOpen ? "Hide lesson dates" : `View all ${batch.lessons.length} lesson dates`} emphasis="secondary" onPress={() => setScheduleOpen(!scheduleOpen)} />
    {scheduleOpen ? <View style={{ gap: space.sm }} testID={`offer-schedule-${batch.batchId}`}>
      {batch.lessons.map((lesson, index) => <Text key={lesson.position} style={[t.callout, numeric, { color: late && !quote!.lessonPositions.includes(lesson.position) ? colors.mutedForeground : colors.foreground }]}>
        {index + 1}. {date(lesson.startsAt)} · {time(lesson.startsAt)} · {lesson.durationMinutes} min{late ? quote!.lessonPositions.includes(lesson.position) ? " · Included" : " · Not included" : ""}
      </Text>)}
    </View> : null}
    <ProgramButton label={detailsOpen ? "Hide joining details" : "Price & joining details"} emphasis="quiet" onPress={() => setDetailsOpen(!detailsOpen)} />
    {detailsOpen ? <View style={{ gap: space.sm }} testID={`offer-details-${batch.batchId}`}>
      <Text style={[t.callout, { color: colors.foreground }]}>The total buys {late ? "the remaining" : "the listed"} lessons, not 30 assumed lessons. The per-lesson figure is an average, not a separate payment option.</Text>
      {!batch.tuitionPeriod && first ? <Text style={[t.caption, { color: colors.mutedForeground }]}>First lesson: {date(first.startsAt, true)} · {time(first.startsAt)} Nepal time.</Text> : null}
      {batch.tuitionPeriod ? <Text style={[t.caption, { color: colors.mutedForeground }]}>Period: {date(batch.tuitionPeriod.startsAt, true)} · {time(batch.tuitionPeriod.startsAt)} to {date(batch.tuitionPeriod.endsAt, true)} · {time(batch.tuitionPeriod.endsAt)} Nepal time (end not included). The next period is a separate purchase; no automatic charge.</Text> : null}
      <Text style={[t.callout, { color: colors.foreground }]}>{batch.allowLateJoining ? "Late joining: future lessons only, same end date. Past lessons and private catch-up are not included." : "Joining closes when this period or course starts."}</Text>
      {late ? <>
        <Text style={[t.callout, numeric, { color: colors.foreground }]}>Original full-period price: NPR {batch.totalTuitionNpr.toLocaleString("en-NP")} for {batch.lessons.length} lessons. {quote!.startedLessonCount} scheduled lessons have already started; they are not included.</Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Estimate as of {date(quote!.calculatedAt)} · {time(quote!.calculatedAt)} Nepal time. Refresh before the next lesson. This does not reserve a seat or enable payment.</Text>
      </> : null}
    </View> : null}</> : null}
  </ProgramCardShell>;
}
