import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost } from "@/utils/api";
import { batchDateValue, lessonDraft, type ProgramBatchSnapshot } from "@/utils/programBatches";
import { PROGRAM_ALLOCATION_STATE_LABELS } from "@/utils/programCommerceHistory";
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
  receipts: Array<{ reference: string; grossNpr: number; teacherNpr: number; fadkoNpr: number;
    accounting?: { heldGrossNpr: number; teacherPaidOutNpr: number; fadkoEarnedNpr: number; refundedGrossNpr: number; actualMoneyMovedNpr: number };
    allocations: Array<{ position: number; grossNpr: number; teacherNpr: number; fadkoNpr: number; state?: string }> }>;
}

/** This deliberately never imports PaymentSheet: rehearsal must not ask for a wallet/PIN. */
export function BatchTestPanel({ batchId, teacher = false, accountRequired = false, returnPath, onBooked }: { batchId: number; teacher?: boolean; accountRequired?: boolean; returnPath?: string; onBooked?: () => void }) {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const [result, setResult] = useState<TestBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState<string | null>(null);
  const gate = useRef(false);
  async function request(confirm = false, outcome: "success" | "declined" = "success") {
    if (gate.current || (confirm && !result)) return;
    gate.current = true; setBusy(true); setError("");
    try {
      const next = confirm ? await apiPost<TestBooking>(`/batch-tests/${batchId}`, { quoteKey: result!.quoteKey, gateway: "fadko_test", outcome }) : await apiGet<TestBooking>(`/batch-tests/${batchId}`);
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
  if (accountRequired) return <View testID={`batch-account-${batchId}`} style={{ gap: space.sm }}>
    <Text style={[t.bodyStrong, { color: colors.foreground }]}>Ready to join this class?</Text>
    <Text style={[t.callout, { color: colors.mutedForeground }]}>Sign in or create a student account to continue. No booking is made from this public page.</Text>
    <ProgramButton
      label="Sign in to join"
      emphasis="primary"
      onPress={() => router.push({ pathname: "/(auth)/login", params: { role: "student", ...(returnPath ? { next: returnPath } : {}) } })}
    />
    <ProgramButton label="Create a student account" emphasis="secondary" onPress={() => router.push("/(auth)/register?role=student")} />
  </View>;
  return <View testID={`batch-test-${batchId}`} style={{ gap: space.sm }}>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Private testing · no money collected</Text>
    <ProgramButton label={busy ? "Checking…" : result ? "Refresh test access" : teacher ? "Open test lessons" : "Try test checkout"} disabled={busy} emphasis={result ? "quiet" : "primary"} onPress={() => void request()} />
    {error ? <ProgramNotice title="Test booking unavailable" body={error} tone="stopped" /> : null}
    {result?.isTeacher && !result.lessons.length ? <ProgramNotice title="Waiting for a test student" body="A student with test access must book this class first. Its lesson links will then appear here. Refresh after they book." /> : null}
    {result && !result.isTeacher && !result.booked ? <ProgramNotice title="Fadko test checkout">
      <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{result.quote.remainingLessonCount} lessons · NPR {result.quote.amountNpr?.toLocaleString("en-NP") ?? "—"}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Pretend payment only. No wallet, card or PIN needed. No real money moves.</Text>
      {result.offerLessons[0] ? <Text style={[t.callout, numeric, { color: colors.foreground }]}>First included lesson: {dateLabel(result.offerLessons[0].startsAt)}</Text> : null}
      <ProgramButton emphasis="quiet" label={datesOpen ? "Hide included dates" : "Check included dates"} onPress={() => setDatesOpen(!datesOpen)} />
      {datesOpen ? result.offerLessons.map((lesson) => <Text key={lesson.position} style={[t.caption, numeric, { color: colors.foreground }]}>Lesson {lesson.position + 1} · {dateLabel(lesson.startsAt)} · {lesson.durationMinutes} min</Text>) : null}
      <Text style={[t.callout, { color: colors.foreground }]}>Confirming reserves your test place and locks these class details. Past lessons are not included.</Text>
      <ProgramButton emphasis="primary" label="Simulate successful payment" disabled={busy || result.quote.status === "closed" || result.quote.amountNpr === null} onPress={() => void request(true)} />
      <ProgramButton emphasis="quiet" label="Try declined payment" disabled={busy || result.quote.status === "closed" || result.quote.amountNpr === null} onPress={() => void request(true, "declined")} />
      <ProgramButton emphasis="quiet" label="Cancel checkout" disabled={busy} onPress={() => { setResult(null); setDatesOpen(false); }} />
    </ProgramNotice> : null}
    {result?.booked ? <Text accessibilityLiveRegion="polite" style={[t.bodyStrong, { color: colors.foreground }]}>Test place booked — no payment taken.</Text> : null}
    {result?.receipts?.map(receipt => <ProgramNotice key={receipt.reference} title={`TEST receipt · ${receipt.reference}`}>
      <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{result.isTeacher ? "Class test payment" : "Your test payment"}: NPR {receipt.grossNpr.toLocaleString("en-NP")}</Text>
      <Text style={[t.callout, numeric, { color: colors.foreground }]}>Teacher allocation: NPR {receipt.teacherNpr.toLocaleString("en-NP")} · Fadko allocation: NPR {receipt.fadkoNpr.toLocaleString("en-NP")}</Text>
      <Text style={[t.callout, numeric, { color: colors.foreground }]}>Still held: NPR {(receipt.accounting?.heldGrossNpr ?? receipt.grossNpr).toLocaleString("en-NP")} · Teacher test-paid: NPR {(receipt.accounting?.teacherPaidOutNpr ?? 0).toLocaleString("en-NP")}</Text>
      <Text style={[t.callout, numeric, { color: colors.foreground }]}>Fadko test-earned: NPR {(receipt.accounting?.fadkoEarnedNpr ?? 0).toLocaleString("en-NP")} · Student test-refunded: NPR {(receipt.accounting?.refundedGrossNpr ?? 0).toLocaleString("en-NP")}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Actual money moved: NPR {(receipt.accounting?.actualMoneyMovedNpr ?? 0).toLocaleString("en-NP")}. These are rehearsal records only.</Text>
      <ProgramButton emphasis="quiet" label={allocationOpen === receipt.reference ? "Hide lesson breakdown" : "Show lesson breakdown"} onPress={() => setAllocationOpen(allocationOpen === receipt.reference ? null : receipt.reference)} />
      {allocationOpen === receipt.reference ? receipt.allocations.map(a => <View key={a.position} style={{ gap: space.xxs }}>
        <Text style={[t.caption, { color: colors.foreground }]}>Lesson {a.position + 1} · {PROGRAM_ALLOCATION_STATE_LABELS[a.state ?? "future"] ?? "Recorded in the test ledger"}</Text>
        <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>NPR {a.grossNpr.toLocaleString("en-NP")} · teacher {a.teacherNpr.toLocaleString("en-NP")} / Fadko {a.fadkoNpr.toLocaleString("en-NP")}</Text>
      </View>) : null}
    </ProgramNotice>)}
    {result?.lessons.length ? <>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Open a lesson to see its join time. Doors open 10 minutes before the scheduled start.</Text>
      {result.lessons.map((lesson) => <View key={lesson.sessionId} style={{ gap: space.xxs }}>
        <Text style={[t.callout, numeric, { color: colors.foreground }]}>Lesson {lesson.position + 1} · {dateLabel(lesson.startsAt)}</Text>
        <ProgramButton label={`Open lesson ${lesson.position + 1}`} emphasis="secondary" onPress={() => router.push({ pathname: "/session/[id]", params: { id: String(lesson.sessionId) } })} />
      </View>)}
    </> : null}
  </View>;
}
