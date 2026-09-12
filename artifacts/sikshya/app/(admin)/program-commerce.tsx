import { Feather } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ApiError, apiGet, apiPost } from "@/utils/api";
import { BatchTestLedger } from "@/components/classes/BatchTestLedger";
import {
  orderedProgramCommerceHistory,
  programCommerceEventLabel,
  programCommerceNepalTime,
  type ProgramCommerceHistoryEntry,
} from "@/utils/programCommerceHistory";

interface SetupProgram { id: number; title: string; lessonCount: number }
interface SetupStudent { id: number; name: string; validUntil: string }
interface Setup { programs: SetupProgram[]; students: SetupStudent[]; testAccessEnabled: boolean }
interface Allocation { id: number; lessonNumber: number; grossAmountNpr: number; teacherAmountNpr: number; platformAmountNpr: number; state: string }
interface ReconciliationEnrollment {
  id: number;
  title: string | null;
  totalTuitionNpr: number;
  paymentStatus: string;
  allocations: Allocation[];
  history: ProgramCommerceHistoryEntry[];
}
interface Reconciliation { notice: string; enrollments: ReconciliationEnrollment[] }

const NEXT: Record<string, Array<{ event: string; label: string; reason?: boolean }>> = {
  future: [{ event: "lesson_delivered", label: "Mark delivered" }, { event: "lesson_cancelled", label: "Teacher cancelled" }],
  replacement_pending: [{ event: "replacement_scheduled", label: "Replacement agreed" }, { event: "refund_approved", label: "Approve lesson refund", reason: true }],
  delivered_pending: [{ event: "complaint_opened", label: "Open complaint" }, { event: "complaint_window_closed", label: "Close 48-hour window" }],
  disputed: [{ event: "complaint_upheld", label: "Uphold complaint", reason: true }, { event: "complaint_denied", label: "Decline complaint", reason: true }],
  eligible: [{ event: "complaint_opened", label: "Open late complaint" }, { event: "payout_confirmed", label: "Rehearse payout" }],
  refund_owed: [{ event: "refund_confirmed", label: "Rehearse refund" }],
};

export default function ProgramCommerceDesk() {
  const colors = useColors();
  const { t, space, radius, gutter, numeric } = useLayout();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [ledger, setLedger] = useState<Reconciliation | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [total, setTotal] = useState("");
  const [lessons, setLessons] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const [nextSetup, nextLedger] = await Promise.all([
        apiGet<Setup>("/admin/program-commerce/setup"),
        apiGet<Reconciliation>("/admin/program-commerce/reconciliation"),
      ]);
      setSetup(nextSetup);
      setLedger(nextLedger);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "The Program rehearsal desk could not be loaded.");
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async () => {
    if (!programId || !studentId) {
      setFailure("Choose one published Program and one approved test student.");
      return;
    }
    setBusy(true); setFailure(null);
    try {
      await apiPost(`/admin/program-commerce/programs/${programId}/test-enrolments`, {
        studentId,
        totalTuitionNpr: Number(total),
        paidLessonCount: Number(lessons),
      });
      setTotal(""); setLessons("");
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "The test enrolment could not be created. Nothing was charged.");
    } finally { setBusy(false); }
  };

  const apply = async (allocationId: number, event: string, needsReason: boolean) => {
    if (needsReason && !note.trim()) {
      setFailure("Write the decision reason before applying that action.");
      return;
    }
    setBusy(true); setFailure(null);
    try {
      await apiPost(`/admin/program-commerce/allocations/${allocationId}/events`, { event, note });
      setNote("");
      await load();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "The shadow ledger could not be updated. No payment moved.");
    } finally { setBusy(false); }
  };

  const optionStyle = (active: boolean) => ({
    minHeight: space.huge,
    padding: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: active ? colors.actionSoft : colors.card,
    justifyContent: "center" as const,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", padding: gutter, paddingBottom: space.huge * 2, gap: space.xl }}>
        <BatchTestLedger />
        <View style={{ gap: space.xxs }}>
          <Text style={[t.title1, { color: colors.foreground }]}>Program rehearsal</Text>
          <Text style={[t.body, { color: colors.mutedForeground }]}>Practise enrolment, lesson holds and settlement before a payment provider is connected.</Text>
        </View>
        <View style={{ padding: space.md, gap: space.xxs, borderRadius: radius.md, backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warn }}>
          <Text style={[t.bodyStrong, { color: colors.warn }]}>No real money</Text>
          <Text style={[t.body, { color: colors.foreground }]}>Every amount below is simulated. No student was charged and no teacher can be paid from it.</Text>
        </View>
        {failure ? <Text style={[t.body, { color: colors.destructive }]}>{failure}</Text> : null}
        {!setup || !ledger ? <ActivityIndicator color={colors.primary} /> : null}
        {setup ? (
          <View style={{ padding: space.lg, gap: space.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Text style={[t.title2, { color: colors.foreground }]}>Create a test enrolment</Text>
            {!setup.testAccessEnabled ? <Text style={[t.body, { color: colors.destructive }]}>Student test access is switched off on this server.</Text> : null}
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>1. Published Program</Text>
            {setup.programs.length === 0 ? <Text style={[t.body, { color: colors.mutedForeground }]}>No published Programs are available.</Text> : setup.programs.map((program) => (
              <TouchableOpacity key={program.id} onPress={() => setProgramId(program.id)} style={optionStyle(programId === program.id)}>
                <Text style={[t.bodyStrong, { color: programId === program.id ? colors.primary : colors.foreground }]}>{program.title}</Text>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>{program.lessonCount} published steps</Text>
              </TouchableOpacity>
            ))}
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>2. Approved test student</Text>
            {setup.students.length === 0 ? <Text style={[t.body, { color: colors.mutedForeground }]}>No student currently has test access. Grant it from People first.</Text> : setup.students.map((student) => (
              <TouchableOpacity key={student.id} onPress={() => setStudentId(student.id)} style={optionStyle(studentId === student.id)}>
                <Text style={[t.bodyStrong, { color: studentId === student.id ? colors.primary : colors.foreground }]}>{student.name}</Text>
              </TouchableOpacity>
            ))}
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>3. Rehearsal terms</Text>
            <TextInput value={total} onChangeText={setTotal} keyboardType="number-pad" placeholder="Total tuition in NPR" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: space.huge, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]} />
            <TextInput value={lessons} onChangeText={setLessons} keyboardType="number-pad" placeholder="Number of paid lessons" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: space.huge, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]} />
            <TouchableOpacity disabled={busy || !setup.testAccessEnabled} onPress={() => void create()} style={{ minHeight: space.huge, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, opacity: busy || !setup.testAccessEnabled ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Create test enrolment</Text>}
            </TouchableOpacity>
          </View>
        ) : null}
        {ledger ? (
          <View style={{ gap: space.md }}>
            <Text style={[t.title2, { color: colors.foreground }]}>Reconciliation rehearsal</Text>
            <TextInput value={note} onChangeText={setNote} multiline placeholder="Decision reason (required for complaint and refund decisions)" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: space.huge * 2, padding: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card, textAlignVertical: "top" }]} />
            {ledger.enrollments.length === 0 ? (
              <Text style={[t.body, { color: colors.mutedForeground }]}>No rehearsal enrolments yet.</Text>
            ) : ledger.enrollments.map((enrollment) => (
              <View key={enrollment.id} style={{ padding: space.lg, gap: space.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                <Text style={[t.title3, { color: colors.foreground }]}>{enrollment.title ?? "Program title unavailable"}</Text>
                <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>TEST total · NPR {enrollment.totalTuitionNpr.toLocaleString()}</Text>
                {enrollment.allocations.map((allocation) => (
                  <View key={allocation.id} style={{ gap: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                      <Text style={[t.bodyStrong, { color: colors.foreground }]}>Lesson {allocation.lessonNumber}</Text>
                      <Text style={[t.body, numeric, { color: colors.mutedForeground }]}>NPR {allocation.grossAmountNpr.toLocaleString()} · {allocation.state.replaceAll("_", " ")}</Text>
                    </View>
                    <Text style={[t.caption, { color: colors.mutedForeground }]}>Teacher NPR {allocation.teacherAmountNpr.toLocaleString()} · Fadko NPR {allocation.platformAmountNpr.toLocaleString()}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                      {(NEXT[allocation.state] ?? []).map((action) => (
                        <TouchableOpacity key={action.event} disabled={busy} onPress={() => void apply(allocation.id, action.event, Boolean(action.reason))} style={{ minHeight: space.huge, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, justifyContent: "center", opacity: busy ? 0.5 : 1 }}>
                          <Text style={[t.bodyStrong, { color: colors.primary }]}>{action.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
                {enrollment.history.length > 0 ? (
                  <View style={{ gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={[t.title3, { color: colors.foreground }]}>Rehearsal history</Text>
                    <Text style={[t.caption, { color: colors.mutedForeground }]}>Oldest first · all times shown in Nepal time</Text>
                    {orderedProgramCommerceHistory(enrollment.history).map((entry) => {
                      const allocation = enrollment.allocations.find((row) => row.id === entry.allocationId);
                      const note = entry.detail?.note?.trim();
                      return (
                        <View key={entry.id} style={{ gap: space.xxs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }}>
                          <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                            {allocation ? `Lesson ${allocation.lessonNumber}` : "Enrolment"} · {programCommerceEventLabel(entry.event)}
                          </Text>
                          <Text style={[t.caption, { color: colors.mutedForeground }]}>{programCommerceNepalTime(entry.createdAt)}</Text>
                          {note ? <Text style={[t.callout, { color: colors.foreground }]}>Reason: {note}</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
