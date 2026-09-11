import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import NepaliDatePicker from "@/components/NepaliDatePicker";
import {
  ProgramBackControl,
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramFailure,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import WarningModal from "@/components/WarningModal";
import { HIT_SLOP_MIN, marketplaceColumnMax, space as staticSpace } from "@/constants/layout";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import {
  batchDateValue,
  batchTimeDraft,
  batchTimeValue,
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
  const dates = useDates();
  const { t, gutter, space, radius, numeric } = useLayout();
  const [batches, setBatches] = useState<OwnerProgramBatch[]>([]);
  const [selected, setSelected] = useState<OwnerProgramBatch | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [accepted, setAccepted] = useState(JSON.stringify(emptyForm()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "save" | "publish" | "close" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<"leave" | "publish" | "close" | null>(null);
  const [pickingDateFor, setPickingDateFor] = useState<number | null>(null);
  const [pickingTimeFor, setPickingTimeFor] = useState<number | null>(null);
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
    } finally { setBusy(null); setConfirming(null); }
  };

  const back = () => {
    if (dirty) { setConfirming("leave"); return; }
    router.replace(`/(teacher)/programs/${programId}`);
  };

  const formSummary = useMemo(() => {
    const amount = Number(form.totalTuitionNpr);
    return Number.isSafeInteger(amount) && amount > 0 ? fullBatchPrice(amount) : "Enter one all-inclusive price in NPR.";
  }, [form.totalTuitionNpr]);

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  if (failure && batches.length === 0) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><View style={{ flex: 1, justifyContent: "center", padding: gutter }}><ProgramFailure message={failure} onRetry={() => void load()} /></View></SafeAreaView>;

  const chosenDate = pickingDateFor === null ? null : form.lessons[pickingDateFor]?.date ?? "";
  const chosenTime = pickingTimeFor === null ? "" : form.lessons[pickingTimeFor]?.time ?? "";
  const confirmation = confirming === "leave"
    ? {
        title: "Leave without saving?",
        consequences: ["Your last saved batch stays safe.", "Only the changes still on this screen will be lost."],
        confirmLabel: "Leave without saving",
        destructive: true,
      }
    : confirming === "close"
      ? {
          title: "Close this batch?",
          consequences: ["Students will no longer see this batch.", "The batch cannot be edited after it is closed."],
          confirmLabel: "Close this batch",
          destructive: true,
        }
      : {
          title: selected?.status === "published" ? "Publish these updated details?" : "Publish this batch preview?",
          consequences: ["Students will see the full price and every lesson.", "Joining and payment will remain unavailable during this preview."],
          confirmLabel: selected?.status === "published" ? "Publish updates" : "Publish preview",
          destructive: false,
        };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <NepaliDatePicker
        visible={pickingDateFor !== null}
        value={chosenDate ? batchDateValue(chosenDate) : null}
        minDate={new Date()}
        title={pickingDateFor === null ? "Choose a lesson date" : `Choose Lesson ${pickingDateFor + 1} date`}
        onCancel={() => setPickingDateFor(null)}
        onPick={(picked) => {
          if (pickingDateFor === null) return;
          const pad = (part: number) => String(part).padStart(2, "0");
          const date = `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`;
          setForm((current) => ({ ...current, lessons: current.lessons.map((lesson, index) => index === pickingDateFor ? { ...lesson, date } : lesson) }));
          setPickingDateFor(null);
        }}
      />
      <NativeTimePicker
        visible={pickingTimeFor !== null && Platform.OS !== "web"}
        value={chosenTime}
        title={pickingTimeFor === null ? "Choose a start time" : `Choose Lesson ${pickingTimeFor + 1} time`}
        onCancel={() => setPickingTimeFor(null)}
        onPick={(time) => {
          if (pickingTimeFor === null) return;
          setForm((current) => ({ ...current, lessons: current.lessons.map((lesson, index) => index === pickingTimeFor ? { ...lesson, time } : lesson) }));
          setPickingTimeFor(null);
        }}
      />
      <WarningModal
        testID="batch-confirmation"
        visible={confirming !== null}
        title={confirmation.title}
        consequences={confirmation.consequences}
        confirmLabel={confirmation.confirmLabel}
        destructive={confirmation.destructive}
        busy={busy !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming === "leave") router.replace(`/(teacher)/programs/${programId}`);
          else if (confirming) void act(confirming);
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: gutter, gap: space.lg, paddingBottom: staticSpace.huge, width: "100%", maxWidth: marketplaceColumnMax, alignSelf: "center" }}>
        <ProgramBackControl onPress={back} testID="batch-planner-back" label="Back to Program" />
        <View style={{ gap: space.xxs }}>
          <Text style={[t.title1, { color: colors.foreground }]}>Dates and price</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>A batch is one scheduled run of this Program. Students see the full price and every lesson before deciding.</Text>
        </View>
        <ProgramNotice title="Planning preview only" body="Students cannot join or pay yet. No payment gateway or real money is connected to these batches." tone="waiting" icon="shield" />
        {failure ? <ProgramNotice title="Something did not work" body={failure} tone="stopped" icon="alert-circle" /> : null}
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
            <ProgramCardShell>
              <Field label="Maximum students" example="Example: 6 (choose 1 to 10)" value={form.capacity} onChangeText={(capacity) => setForm({ ...form, capacity })} keyboardType="number-pad" />
              <Field label="Full batch price" example="Example: 3000 means NPR 3,000 for every lesson together" value={form.totalTuitionNpr} onChangeText={(totalTuitionNpr) => setForm({ ...form, totalTuitionNpr })} keyboardType="number-pad" />
              <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>{formSummary}</Text>
            </ProgramCardShell>
            <View style={{ gap: space.sm }}>
              <Text style={[t.title2, { color: colors.foreground }]}>Lesson schedule</Text>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Choose each date from the Nepali calendar and each start time from the clock. Enrollment will close when Lesson 1 starts.</Text>
              {form.lessons.map((lesson, index) => (
                <ProgramCardShell key={index}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Lesson {index + 1}</Text>{form.lessons.length > 1 ? <ProgramButton label="Remove" emphasis="quiet" icon="trash-2" onPress={() => setForm({ ...form, lessons: form.lessons.filter((_, at) => at !== index) })} /> : null}</View>
                  <ScheduleChoice
                    label="Date"
                    value={batchDateValue(lesson.date) ? dates.formatBoth(batchDateValue(lesson.date)!) : "Choose from the Nepali calendar"}
                    icon="calendar"
                    onPress={() => setPickingDateFor(index)}
                  />
                  {Platform.OS === "web" ? (
                    <View style={{ gap: space.xxs }}>
                      <Text style={[t.bodyStrong, { color: colors.foreground }]}>Start time</Text>
                      <Text style={[t.caption, { color: colors.mutedForeground }]}>Nepal time · choose from the clock</Text>
                      {React.createElement("input", {
                        type: "time",
                        value: lesson.time,
                        "aria-label": `Lesson ${index + 1} start time in Nepal`,
                        "data-testid": `batch-time-${index}`,
                        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, lessons: form.lessons.map((item, at) => at === index ? { ...item, time: event.target.value } : item) }),
                        style: {
                          minHeight: HIT_SLOP_MIN,
                          border: `1px solid ${colors.border}`,
                          borderRadius: radius.sm,
                          padding: space.sm,
                          background: colors.background,
                          color: colors.foreground,
                          fontFamily: t.body.fontFamily,
                          fontSize: t.body.fontSize,
                        },
                      })}
                    </View>
                  ) : (
                    <ScheduleChoice label="Start time" value={lesson.time ? `${lesson.time} Nepal time` : "Choose from the clock"} icon="clock" onPress={() => setPickingTimeFor(index)} />
                  )}
                  <Text style={[t.caption, { color: colors.inkFaint }]}>Duration</Text>
                  <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>{durations.map((duration) => <ProgramButton key={duration} label={`${duration} min`} emphasis={lesson.durationMinutes === duration ? "primary" : "quiet"} onPress={() => setForm({ ...form, lessons: form.lessons.map((item, at) => at === index ? { ...item, durationMinutes: duration } : item) })} />)}</View>
                </ProgramCardShell>
              ))}
              <ProgramButton label="Add another lesson" icon="plus" onPress={() => setForm({ ...form, lessons: [...form.lessons, { date: "", time: "", durationMinutes: 60 }] })} grow />
            </View>
            {issues.length > 0 ? <ProgramNotice title="Check these details" tone="stopped" icon="alert-circle">{issues.map((issue) => <Text key={issue} style={[t.callout, { color: colors.mutedForeground }]}>• {issue}</Text>)}</ProgramNotice> : null}
            <ProgramButton label={dirty ? "Save batch" : "Saved"} icon="save" emphasis="primary" disabled={!dirty || selected.status === "closed"} busy={busy === "save"} onPress={() => void save()} grow />
            {dirty ? <ProgramNotice title="Save before publishing" body="Students only see the last version the server accepted." tone="waiting" icon="save" /> : null}
            {selected.status !== "closed" ? <View style={{ gap: space.xs }}><ProgramButton label={selected.status === "published" ? "Publish updated details" : "Publish batch preview"} icon="eye" emphasis="secondary" disabled={dirty} busy={busy === "publish"} onPress={() => setConfirming("publish")} grow />{selected.status === "published" ? <ProgramButton label="Close this batch" icon="x-circle" emphasis="danger" busy={busy === "close"} onPress={() => setConfirming("close")} grow /> : null}</View> : <ProgramNotice title="This batch is closed" body="It is no longer visible to students and cannot be edited." tone="stopped" icon="lock" />}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScheduleChoice({ label, value, icon, onPress }: { label: string; value: string; icon: React.ComponentProps<typeof Feather>["name"]; onPress: () => void }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return <View style={{ gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderWidth: 1, borderRadius: radius.sm, borderColor: colors.border, backgroundColor: colors.background }}><Feather name={icon} size={space.md} color={colors.primary} /><Text style={[t.body, { color: value.startsWith("Choose") ? colors.mutedForeground : colors.foreground, flex: 1 }]}>{value}</Text><Feather name="chevron-down" size={space.md} color={colors.mutedForeground} /></Pressable></View>;
}

function NativeTimePicker({ visible, value, title, onCancel, onPick }: { visible: boolean; value: string; title: string; onCancel: () => void; onPick: (value: string) => void }) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const [draft, setDraft] = useState(batchTimeValue(value));

  useEffect(() => { if (visible) setDraft(batchTimeValue(value)); }, [value, visible]);
  if (!visible) return null;

  const changed = (_event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === "android") {
      if (next) onPick(batchTimeDraft(next)); else onCancel();
      return;
    }
    if (next) setDraft(next);
  };

  if (Platform.OS === "android") return <DateTimePicker value={draft} mode="time" is24Hour={false} display="default" onChange={changed} />;

  return <Modal visible transparent animationType="fade" onRequestClose={onCancel}><View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg, backgroundColor: colors.scrim }}><View style={[elevation.modal, { width: "100%", maxWidth: marketplaceColumnMax, gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[t.title2, { color: colors.foreground }]}>{title}</Text><DateTimePicker value={draft} mode="time" is24Hour={false} display="spinner" onChange={changed} /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}><ProgramButton label="Cancel" emphasis="quiet" onPress={onCancel} grow /><ProgramButton label="Use this time" emphasis="primary" onPress={() => onPick(batchTimeDraft(draft))} grow /></View></View></View></Modal>;
}

function Field({ label, example, value, onChangeText, keyboardType }: { label: string; example: string; value: string; onChangeText: (value: string) => void; keyboardType?: "number-pad" }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return <View style={{ gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>{example}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={[t.body, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }]} placeholderTextColor={colors.inkFaint} /></View>;
}
