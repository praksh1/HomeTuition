import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ProgramBackControl,
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramFailure,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { marketplaceColumnMax, space as staticSpace } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import {
  fullBatchPrice,
  lessonDraft,
  nepalDate,
  type OwnerProgramBatch,
  type ProgramBatchLessonDraft,
} from "@/utils/programBatches";

const durations = [30, 45, 60, 90] as const;
type Form = { capacity: string; totalTuitionNpr: string; lessons: ProgramBatchLessonDraft[] };

const emptyForm = (): Form => ({ capacity: "", totalTuitionNpr: "", lessons: [{ date: "", time: "", durationMinutes: 60 }] });

function formOf(batch: OwnerProgramBatch): Form {
  return {
    capacity: batch.capacity === null ? "" : String(batch.capacity),
    totalTuitionNpr: batch.totalTuitionNpr === null ? "" : String(batch.totalTuitionNpr),
    lessons: batch.lessons.length > 0 ? batch.lessons.map(lessonDraft) : emptyForm().lessons,
  };
}

export default function ProgramBatchPlannerScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const programId = typeof params.id === "string" ? params.id : "";
  const colors = useColors();
  const { t, gutter, space, radius, numeric } = useLayout();
  const [batches, setBatches] = useState<OwnerProgramBatch[]>([]);
  const [selected, setSelected] = useState<OwnerProgramBatch | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [accepted, setAccepted] = useState(JSON.stringify(emptyForm()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "save" | "publish" | "close" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const dirty = selected !== null && JSON.stringify(form) !== accepted;

  const load = useCallback(async () => {
    if (!/^\d+$/.test(programId)) {
      setFailure("That Program address is not valid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(null);
    try {
      const answer = await apiGet<{ batches: OwnerProgramBatch[] }>(`/learning-programs/${programId}/batches`);
      setBatches(answer.batches);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Fadko could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => { void load(); }, [load]);

  const choose = (batch: OwnerProgramBatch) => {
    const next = formOf(batch);
    setSelected(batch);
    setForm(next);
    setAccepted(JSON.stringify(next));
    setIssues([]);
  };

  const create = async () => {
    if (busy) return;
    setBusy("create");
    setFailure(null);
    try {
      const answer = await apiPost<{ batch: OwnerProgramBatch }>(`/learning-programs/${programId}/batches`, {});
      setBatches((current) => [answer.batch, ...current]);
      choose(answer.batch);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Fadko could not start the batch.");
    } finally { setBusy(null); }
  };

  const replaceSelected = (batch: OwnerProgramBatch) => {
    setBatches((current) => current.map((item) => item.id === batch.id ? batch : item));
    choose(batch);
  };

  const save = async () => {
    if (!selected || busy) return;
    setBusy("save");
    setIssues([]);
    try {
      const answer = await apiPatch<{ batch: OwnerProgramBatch }>(`/learning-program-batches/${selected.id}`, {
        capacity: Number(form.capacity), totalTuitionNpr: Number(form.totalTuitionNpr), lessons: form.lessons,
      });
      replaceSelected(answer.batch);
    } catch (err) {
      if (err instanceof ApiError) {
        const details = (err as ApiError & { data?: { issues?: string[] } }).data?.issues;
        setIssues(details ?? [err.message]);
      } else setIssues(["Fadko could not save this batch. Your entries are still on screen."]);
    } finally { setBusy(null); }
  };

  const act = async (action: "publish" | "close") => {
    if (!selected || busy || dirty) return;
    setBusy(action);
    setIssues([]);
    try {
      const answer = await apiPost<{ batch: OwnerProgramBatch }>(`/learning-program-batches/${selected.id}/${action}`, {});
      replaceSelected(answer.batch);
    } catch (err) {
      if (err instanceof ApiError) {
        const details = (err as ApiError & { data?: { issues?: string[] } }).data?.issues;
        setIssues(details ?? [err.message]);
      } else setIssues([`Fadko could not ${action} this batch.`]);
    } finally { setBusy(null); }
  };

  const back = () => {
    if (dirty) { setLeaveAsk(true); return; }
    router.replace(`/(teacher)/programs/${programId}`);
  };

  const formSummary = useMemo(() => {
    const amount = Number(form.totalTuitionNpr);
    return Number.isSafeInteger(amount) && amount > 0 ? fullBatchPrice(amount) : "Enter one all-inclusive price in NPR.";
  }, [form.totalTuitionNpr]);

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  if (failure && batches.length === 0) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><View style={{ flex: 1, justifyContent: "center", padding: gutter }}><ProgramFailure message={failure} onRetry={() => void load()} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: gutter, gap: space.lg, paddingBottom: staticSpace.huge, width: "100%", maxWidth: marketplaceColumnMax, alignSelf: "center" }}>
        <ProgramBackControl onPress={back} testID="batch-planner-back" label="Back to Program" />
        <View style={{ gap: space.xxs }}>
          <Text style={[t.title1, { color: colors.foreground }]}>Dates and price</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>A batch is one scheduled run of this Program. Students see the full price and every lesson before deciding.</Text>
        </View>
        <ProgramNotice title="Planning preview only" body="Students cannot join or pay yet. No payment gateway or real money is connected to these batches." tone="waiting" icon="shield" />
        {failure ? <ProgramNotice title="Something did not work" body={failure} tone="stopped" icon="alert-circle" /> : null}
        {leaveAsk ? <ProgramNotice title="Your latest changes are not saved" body="Save them, or leave and lose only the changes still on this screen." tone="stopped" icon="alert-triangle"><View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}><ProgramButton label="Keep editing" onPress={() => setLeaveAsk(false)} grow /><ProgramButton label="Leave without saving" emphasis="danger" onPress={() => router.replace(`/(teacher)/programs/${programId}`)} grow /></View></ProgramNotice> : null}

        <View style={{ gap: space.sm }}>
          <Text style={[t.title2, { color: colors.foreground }]}>Your batches</Text>
          {batches.length === 0 ? <Text style={[t.callout, { color: colors.mutedForeground }]}>No batch has been planned for this Program.</Text> : batches.map((batch) => (
            <ProgramCardShell key={batch.id} onPress={() => choose(batch)} testID={`batch-card-${batch.id}`} accessibilityLabel={`Open batch ${batch.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Batch {batch.id}</Text><ProgramChip label={batch.status === "published" ? "Published" : batch.status === "closed" ? "Closed" : "Draft"} tone={batch.status === "published" ? "live" : batch.status === "closed" ? "stopped" : "waiting"} /></View>
              {batch.published ? <><Text style={[t.body, numeric, { color: colors.foreground }]}>{fullBatchPrice(batch.published.totalTuitionNpr)}</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>{batch.published.lessons.length} lessons · starts {nepalDate(batch.published.lessons[0]!.startsAt)}</Text></> : <Text style={[t.caption, { color: colors.mutedForeground }]}>Not visible to students yet.</Text>}
            </ProgramCardShell>
          ))}
          <ProgramButton label="New batch" icon="plus" emphasis="primary" busy={busy === "create"} onPress={() => void create()} grow />
        </View>

        {selected ? (
          <View style={{ gap: space.lg }}>
            <View style={{ gap: space.xxs }}><Text style={[t.title2, { color: colors.foreground }]}>Edit Batch {selected.id}</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>Examples are guidance only. Enter the real promise students will see.</Text></View>
            {issues.length > 0 ? <ProgramNotice title="Check these details" tone="stopped" icon="alert-circle">{issues.map((issue) => <Text key={issue} style={[t.callout, { color: colors.mutedForeground }]}>• {issue}</Text>)}</ProgramNotice> : null}
            <ProgramCardShell>
              <Field label="Maximum students" example="Example: 6 (choose 1 to 10)" value={form.capacity} onChangeText={(capacity) => setForm({ ...form, capacity })} keyboardType="number-pad" />
              <Field label="Full batch price" example="Example: 3000 means NPR 3,000 for every lesson together" value={form.totalTuitionNpr} onChangeText={(totalTuitionNpr) => setForm({ ...form, totalTuitionNpr })} keyboardType="number-pad" />
              <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>{formSummary}</Text>
            </ProgramCardShell>
            <View style={{ gap: space.sm }}>
              <Text style={[t.title2, { color: colors.foreground }]}>Lesson schedule</Text>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Use Nepal date (YYYY-MM-DD) and Nepal time (24-hour HH:MM). Enrollment will close when Lesson 1 starts.</Text>
              {form.lessons.map((lesson, index) => (
                <ProgramCardShell key={index}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Lesson {index + 1}</Text>{form.lessons.length > 1 ? <ProgramButton label="Remove" emphasis="quiet" icon="trash-2" onPress={() => setForm({ ...form, lessons: form.lessons.filter((_, at) => at !== index) })} /> : null}</View>
                  <Field label="Date" example="Example: 2026-10-15" value={lesson.date} onChangeText={(date) => setForm({ ...form, lessons: form.lessons.map((item, at) => at === index ? { ...item, date } : item) })} />
                  <Field label="Start time" example="Example: 16:30 means 4:30 PM Nepal time" value={lesson.time} onChangeText={(time) => setForm({ ...form, lessons: form.lessons.map((item, at) => at === index ? { ...item, time } : item) })} />
                  <Text style={[t.caption, { color: colors.inkFaint }]}>Duration</Text>
                  <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>{durations.map((duration) => <ProgramButton key={duration} label={`${duration} min`} emphasis={lesson.durationMinutes === duration ? "primary" : "quiet"} onPress={() => setForm({ ...form, lessons: form.lessons.map((item, at) => at === index ? { ...item, durationMinutes: duration } : item) })} />)}</View>
                </ProgramCardShell>
              ))}
              <ProgramButton label="Add another lesson" icon="plus" onPress={() => setForm({ ...form, lessons: [...form.lessons, { date: "", time: "", durationMinutes: 60 }] })} grow />
            </View>
            <ProgramButton label={dirty ? "Save batch" : "Saved"} icon="save" emphasis="primary" disabled={!dirty || selected.status === "closed"} busy={busy === "save"} onPress={() => void save()} grow />
            {dirty ? <ProgramNotice title="Save before publishing" body="Students only see the last version the server accepted." tone="waiting" icon="save" /> : null}
            {selected.status !== "closed" ? <View style={{ gap: space.xs }}><ProgramButton label={selected.status === "published" ? "Publish updated details" : "Publish batch preview"} icon="eye" emphasis="secondary" disabled={dirty} busy={busy === "publish"} onPress={() => void act("publish")} grow />{selected.status === "published" ? <ProgramButton label="Close this batch" icon="x-circle" emphasis="danger" busy={busy === "close"} onPress={() => void act("close")} grow /> : null}</View> : <ProgramNotice title="This batch is closed" body="It is no longer visible to students and cannot be edited." tone="stopped" icon="lock" />}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, example, value, onChangeText, keyboardType }: { label: string; example: string; value: string; onChangeText: (value: string) => void; keyboardType?: "number-pad" }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return <View style={{ gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>{example}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={[t.body, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }]} placeholderTextColor={colors.inkFaint} /></View>;
}
