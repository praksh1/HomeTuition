import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost } from "@/utils/api";
import { batchDateValue, lessonDraft, type ProgramBatchSnapshot } from "@/utils/programBatches";
import { ProgramButton, ProgramNotice } from "../programs/ProgramPieces";

interface TestBooking {
  testOnly: true;
  paymentCollectedNpr: 0;
  isTeacher: boolean;
  booked: boolean;
  quote: NonNullable<ProgramBatchSnapshot["joiningPreview"]>;
  quoteKey: string;
  offerLessons: Array<{ position: number; startsAt: string; durationMinutes: number }>;
  lessons: Array<{ position: number; sessionId: number; startsAt: string; durationMinutes: number }>;
}

/** This deliberately never imports PaymentSheet: rehearsal must not ask for a wallet/PIN. */
export function BatchTestPanel({ batchId, teacher = false, onBooked }: { batchId: number; teacher?: boolean; onBooked?: () => void }) {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const [result, setResult] = useState<TestBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  const gate = useRef(false);
  async function request(confirm = false) {
    if (gate.current || (confirm && !result)) return;
    gate.current = true; setBusy(true); setError("");
    try {
      const next = confirm ? await apiPost<TestBooking>(`/batch-tests/${batchId}`, { quoteKey: result!.quoteKey }) : await apiGet<TestBooking>(`/batch-tests/${batchId}`);
      setResult(next);
      if (confirm && next.booked) onBooked?.();
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Could not check test booking. Please try again.");
    } finally { gate.current = false; setBusy(false); }
  }
  const dateLabel = (iso: string) => {
    const local = lessonDraft({ startsAt: iso, durationMinutes: 60 });
    const date = batchDateValue(local.date)!;
    return `${dates.format(date)} · ${local.time} Nepal time`;
  };
  return <View testID={`batch-test-${batchId}`} style={{ gap: space.sm }}>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Private testing · no money collected</Text>
    <ProgramButton label={busy ? "Checking…" : result ? "Refresh test access" : teacher ? "Open test lessons" : "Book for testing"} disabled={busy} emphasis={result ? "quiet" : "primary"} onPress={() => void request()} />
    {error ? <ProgramNotice title="Test booking unavailable" body={error} tone="stopped" /> : null}
    {result?.isTeacher && !result.lessons.length ? <ProgramNotice title="Waiting for a test student" body="A student with test access must book this class first. Its lesson links will then appear here. Refresh after they book." /> : null}
    {result && !result.isTeacher && !result.booked ? <ProgramNotice title="Confirm your test place">
      <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{result.quote.remainingLessonCount} lessons · No charge</Text>
      {result.quote.amountNpr !== null ? <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Listed value: NPR {result.quote.amountNpr.toLocaleString("en-NP")}. This is not a payment or receipt.</Text> : null}
      {result.offerLessons[0] ? <Text style={[t.callout, numeric, { color: colors.foreground }]}>First included lesson: {dateLabel(result.offerLessons[0].startsAt)}</Text> : null}
      <ProgramButton emphasis="quiet" label={datesOpen ? "Hide included dates" : "Check included dates"} onPress={() => setDatesOpen(!datesOpen)} />
      {datesOpen ? result.offerLessons.map((lesson) => <Text key={lesson.position} style={[t.caption, numeric, { color: colors.foreground }]}>Lesson {lesson.position + 1} · {dateLabel(lesson.startsAt)} · {lesson.durationMinutes} min</Text>) : null}
      <Text style={[t.callout, { color: colors.foreground }]}>Confirming reserves your test place and locks these class details. Past lessons are not included.</Text>
      <ProgramButton emphasis="primary" label="Confirm test booking — no charge" disabled={busy || result.quote.status === "closed" || result.quote.amountNpr === null} onPress={() => void request(true)} />
    </ProgramNotice> : null}
    {result?.booked ? <Text accessibilityLiveRegion="polite" style={[t.bodyStrong, { color: colors.foreground }]}>Test place booked — no payment taken.</Text> : null}
    {result?.lessons.length ? <>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Open a lesson to see its join time. Doors open 10 minutes before the scheduled start.</Text>
      {result.lessons.map((lesson) => <View key={lesson.sessionId} style={{ gap: space.xxs }}>
        <Text style={[t.callout, numeric, { color: colors.foreground }]}>Lesson {lesson.position + 1} · {dateLabel(lesson.startsAt)}</Text>
        <ProgramButton label={`Open lesson ${lesson.position + 1}`} emphasis="secondary" onPress={() => router.push({ pathname: "/session/[id]", params: { id: String(lesson.sessionId) } })} />
      </View>)}
    </> : null}
  </View>;
}
