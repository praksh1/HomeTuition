import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { usePreventRemove } from "@react-navigation/native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { BatchConfirmation } from "@/components/programs/BatchConfirmation";
import { HIT_SLOP_MIN, marketplaceColumnMax, space as staticSpace } from "@/constants/layout";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useBrowserLeaveGuard } from "@/hooks/useLeaveGuard";
import { apiGet, apiPatch, apiPost, ApiError } from "@/utils/api";
import { BATCH_MAX_LESSONS, BATCH_WEEKDAYS, batchDetailsIssues, batchScheduleIssues, calendarDay, repeatLessons } from "@/utils/batchSchedule";
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
  const navigation = useNavigation();
  const programId = typeof params.id === "string" ? params.id : "";
  const colors = useColors();
  const dates = useDates();
  const { t, gutter, space, radius, numeric } = useLayout();
  const [batches, setBatches] = useState<OwnerProgramBatch[]>([]);
  const [selected, setSelected] = useState<OwnerProgramBatch | null>(null);
  const [form, setFormState] = useState<Form>(emptyForm);
  const formRef = useRef(form);
  const setForm = useCallback((value: React.SetStateAction<Form>) => {
    const next = typeof value === "function" ? value(formRef.current) : value;
    formRef.current = next;
    setFormState(next);
  }, []);
  const [accepted, setAccepted] = useState(JSON.stringify(emptyForm()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "save" | "publish" | "close" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<"leave" | "publish" | "close" | "replace" | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [repeatCount, setRepeatCount] = useState("8");
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [replacement, setReplacement] = useState<ProgramBatchLessonDraft[] | null>(null);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(0);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const locked = busy !== null || selected?.status === "closed";
  const moveTo = (next: 0 | 1 | 2) => { setStep(next); setIssues([]); setNotice(null); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const [pickingDateFor, setPickingDateFor] = useState<number | null>(null);
  const [pickingTimeFor, setPickingTimeFor] = useState<number | null>(null);
  const dirty = selected !== null && JSON.stringify(form) !== accepted;
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [departure, setDeparture] = useState<(() => void) | null>(null);
  useEffect(() => { if (departure) departure(); }, [departure]);
  const askLeave = useCallback((go: () => void) => {
    setLeaveAction(() => go);
    setConfirming("leave");
  }, []);
  const guarded = (dirty || busy !== null) && departure === null;
  useBrowserLeaveGuard({ dirty: guarded, armHistory: guarded, questionOpen: confirming === "leave", departing: departure !== null, onHistoryBack: askLeave });
  usePreventRemove(guarded, ({ data }) => askLeave(() => navigation.dispatch(data.action)));

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
    setNotice(null);
  };

  const create = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy("create");
    setFailure(null);
    try {
      const answer = await apiPost<{ batch: OwnerProgramBatch }>(`/learning-programs/${programId}/batches`, {});
      setBatches((current) => [answer.batch, ...current]);
      choose(answer.batch);
      setWeekdays(null);
      setExpandedLesson(0);
      moveTo(0);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Fadko could not start the batch.");
    } finally { operation.current = false; setBusy(null); }
  };

  const replaceSelected = (batch: OwnerProgramBatch, sent: string) => {
    setBatches((current) => current.map((item) => item.id === batch.id ? batch : item));
    setSelected(batch);
    const next = formOf(batch);
    setAccepted(JSON.stringify(next));
    // A keystroke may arrive before the render locks the inputs. Never erase it with the reply.
    if (JSON.stringify(formRef.current) === sent) setForm(next);
  };

  const save = async () => {
    if (!selected || operation.current || selected.status === "closed") return;
    operation.current = true;
    const sending = formRef.current;
    setBusy("save");
    setIssues([]);
    try {
      const answer = await apiPatch<{ batch: OwnerProgramBatch }>(`/learning-program-batches/${selected.id}`, {
        capacity: Number(sending.capacity), totalTuitionNpr: Number(sending.totalTuitionNpr), lessons: sending.lessons,
      });
      replaceSelected(answer.batch, JSON.stringify(sending));
      setNotice(JSON.stringify(formRef.current) === JSON.stringify(formOf(answer.batch)) ? "Draft saved. Review the details below, then publish when you are ready." : "Earlier changes saved. Your newer edits are still here and need saving.");
    } catch (err) {
      if (err instanceof ApiError) {
        const details = (err as ApiError & { data?: { issues?: string[] } }).data?.issues;
        setIssues(details ?? [err.message]);
      } else setIssues(["Fadko could not save this batch. Your entries are still on screen."]);
    } finally { operation.current = false; setBusy(null); scroll.current?.scrollTo({ y: 0, animated: false }); }
  };

  const act = async (action: "publish" | "close") => {
    if (!selected || operation.current || JSON.stringify(formRef.current) !== accepted) return;
    operation.current = true;
    const sending = JSON.stringify(formRef.current);
    setBusy(action);
    setIssues([]);
    try {
      const answer = await apiPost<{ batch: OwnerProgramBatch }>(`/learning-program-batches/${selected.id}/${action}`, {});
      replaceSelected(answer.batch, sending);
      setNotice(action === "close" ? "Batch closed. Students can no longer see it." : "Batch preview published. Joining and payment are not open yet.");
    } catch (err) {
      if (err instanceof ApiError) {
        const details = (err as ApiError & { data?: { issues?: string[] } }).data?.issues;
        setIssues(details ?? [err.message]);
      } else setIssues([`Fadko could not ${action} this batch.`]);
    } finally { operation.current = false; setBusy(null); setConfirming(null); scroll.current?.scrollTo({ y: 0, animated: false }); }
  };

  const back = () => {
    if (operation.current) return;
    if (dirty) { setLeaveAction(null); setConfirming("leave"); return; }
    if (selected) { setSelected(null); moveTo(0); }
    else router.replace(`/(teacher)/programs/${programId}`);
  };

  const nextStep = () => {
    const problems = step === 0 ? batchDetailsIssues(form.capacity, form.totalTuitionNpr) : batchScheduleIssues(form.lessons, Date.now());
    if (problems.length) { setIssues(problems); scroll.current?.scrollTo({ y: 0, animated: false }); return; }
    moveTo(step === 0 ? 1 : 2);
  };

  const first = form.lessons[0]!;
  const firstWeekday = calendarDay(first.date)?.getUTCDay();
  const selectedWeekdays = weekdays ?? (firstWeekday === undefined ? [] : [firstWeekday]);
  const repeated = repeatLessons(first, Number(repeatCount), selectedWeekdays);
  const applyRepeat = (lessons: ProgramBatchLessonDraft[]) => {
    setForm((current) => ({ ...current, lessons }));
    setExpandedLesson(null);
    setReplacement(null);
    setConfirming(null);
    setNotice(`${lessons.length} lesson dates prepared. Check holidays and adjust any lesson below. Not saved yet.`);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const formSummary = useMemo(() => {
    const amount = Number(form.totalTuitionNpr);
    return Number.isSafeInteger(amount) && amount > 0 ? fullBatchPrice(amount) : "Enter one all-inclusive price in NPR.";
  }, [form.totalTuitionNpr]);

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  if (failure && batches.length === 0 && !selected) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><View style={{ flex: 1, justifyContent: "center", padding: gutter }}><ProgramBackControl onPress={back} testID="batch-error-back" label="Back to Program" /><ProgramFailure title="Your batches could not be loaded" message={failure} onRetry={() => void load()} /></View></SafeAreaView>;

  const chosenDate = pickingDateFor === null ? null : form.lessons[pickingDateFor]?.date ?? "";
  const chosenTime = pickingTimeFor === null ? "" : form.lessons[pickingTimeFor]?.time ?? "";
  const confirmation = confirming === "leave"
    ? {
        title: "Leave without saving?",
        consequences: ["Your last saved batch stays safe.", "Only the changes still on this screen will be lost."],
        confirmLabel: "Leave without saving",
        destructive: true,
      }
    : confirming === "replace"
      ? { title: "Replace the lesson schedule?", consequences: ["This replaces every date, time and duration currently in this draft.", "Your saved batch will not change until you press Save draft."], confirmLabel: "Replace schedule", destructive: true }
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

  const repeatPanel = <ProgramCardShell>
    <Text style={[t.title2, { color: colors.foreground }]}>Repeat Lesson 1</Text>
    <Text style={[t.callout, { color: colors.mutedForeground }]}>Use the same time and duration on the days below. Holidays are not skipped automatically.</Text>
    <Field disabled={locked} label="Total lessons" example="Example: 8 weekly lessons. Include Lesson 1 in this count (1–60)." value={repeatCount} onChangeText={setRepeatCount} keyboardType="number-pad" />
    <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
      <ProgramButton label="Weekly" disabled={locked || firstWeekday === undefined} onPress={() => setWeekdays(firstWeekday === undefined ? [] : [firstWeekday])} />
      <ProgramButton label="Sun–Fri" disabled={locked} onPress={() => setWeekdays([0, 1, 2, 3, 4, 5])} />
      <ProgramButton label="Every day" disabled={locked} onPress={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])} />
    </View>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Or choose your own days. Selected days are labelled “on”.</Text>
    <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>{BATCH_WEEKDAYS.map((day, index) => <ProgramButton key={day} disabled={locked} label={`${day}${selectedWeekdays.includes(index) ? " · on" : ""}`} emphasis={selectedWeekdays.includes(index) ? "secondary" : "quiet"} onPress={() => setWeekdays(selectedWeekdays.includes(index) ? selectedWeekdays.filter((value) => value !== index) : [...selectedWeekdays, index])} />)}</View>
    <Text style={[t.callout, { color: colors.mutedForeground }]}>{repeated.ok ? `${repeated.lessons.length} lessons · last date ${dates.formatBoth(batchDateValue(repeated.lessons[repeated.lessons.length - 1]!.date)!)} · ${first.time} Nepal time` : repeated.message}</Text>
    <ProgramButton label="Use these lesson dates" testID="batch-use-repeat" icon="repeat" disabled={locked || !repeated.ok} onPress={() => { if (!repeated.ok) return; if (form.lessons.length > 1) { setReplacement(repeated.lessons); setConfirming("replace"); } else applyRepeat(repeated.lessons); }} />
  </ProgramCardShell>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
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
      <BatchConfirmation
        visible={confirming !== null}
        title={confirmation.title}
        consequences={confirmation.consequences}
        confirmLabel={confirmation.confirmLabel}
        destructive={confirmation.destructive}
        busy={busy !== null}
        onCancel={() => { if (!operation.current) { setConfirming(null); setLeaveAction(null); } }}
        onConfirm={() => {
          if (operation.current) return;
          if (confirming === "leave") {
            if (leaveAction) { setDeparture(() => leaveAction); setConfirming(null); }
            else { setSelected(null); setConfirming(null); moveTo(0); }
          }
          else if (confirming === "replace") { if (replacement) applyRepeat(replacement); }
          else if (confirming) void act(confirming);
        }}
      />
      <View style={{ paddingHorizontal: gutter, width: "100%", maxWidth: marketplaceColumnMax, alignSelf: "center" }}><ProgramBackControl onPress={back} testID="batch-planner-back" label={selected ? "All batches" : "Back to Program"} /></View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: gutter, gap: space.lg, paddingBottom: staticSpace.huge, width: "100%", maxWidth: marketplaceColumnMax, alignSelf: "center" }}>
        <View style={{ gap: space.xxs }}>
          <Text style={[t.title1, { color: colors.foreground }]}>{selected ? ["Class size & price", "Plan your lessons", "Review your batch"][step] : "Teach this Program"}</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>{selected ? `Step ${step + 1} of 3 · Batch ${selected.id}` : "Your Program describes what you teach. Each batch adds when you teach it, the class size and one full price."}</Text>
        </View>
        {!selected || step === 2 ? <ProgramNotice title="Planning preview only" body="Students cannot join or pay yet. No payment gateway or real money is connected to these batches." tone="waiting" icon="shield" /> : null}
        {failure ? <ProgramNotice title="Something did not work" body={failure} tone="stopped" icon="alert-circle" /> : null}
        {issues.length > 0 ? <View accessibilityRole="alert"><ProgramNotice title="Check these details" tone="stopped" icon="alert-circle">{issues.map((issue) => <Text key={issue} style={[t.callout, { color: colors.mutedForeground }]}>{issue}</Text>)}</ProgramNotice></View> : null}
        {notice ? <View accessibilityLiveRegion="polite"><ProgramNotice title={notice} tone="neutral" /></View> : null}
        {!selected ? <View style={{ gap: space.sm }}>
          <Text style={[t.title2, { color: colors.foreground }]}>Your batches</Text>
          {batches.length === 0 ? <Text style={[t.callout, { color: colors.mutedForeground }]}>No batch has been planned for this Program.</Text> : batches.map((batch) => (
            <ProgramCardShell key={batch.id} onPress={() => { if (!operation.current) { choose(batch); setWeekdays(null); setExpandedLesson(0); moveTo(batch.status === "closed" ? 2 : 0); } }} testID={`batch-card-${batch.id}`} accessibilityLabel={`Open batch ${batch.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Batch {batch.id}</Text><ProgramChip label={batch.status === "published" ? "Published" : batch.status === "closed" ? "Closed" : "Draft"} tone={batch.status === "published" ? "live" : batch.status === "closed" ? "stopped" : "waiting"} /></View>
              {batch.published ? <><Text style={[t.body, numeric, { color: colors.foreground }]}>{fullBatchPrice(batch.published.totalTuitionNpr)}</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>{batch.published.lessons.length} lessons · starts {nepalDate(batch.published.lessons[0]!.startsAt)}</Text></> : <Text style={[t.caption, { color: colors.mutedForeground }]}>Not visible to students yet.</Text>}
            </ProgramCardShell>
          ))}
          <ProgramButton label="New batch" icon="plus" emphasis="primary" busy={busy === "create"} onPress={() => void create()} grow />
        </View> : null}

        {selected ? (
          <View style={{ gap: space.lg }}>
            {step === 0 ? <ProgramCardShell>
              <Field disabled={locked} label="Maximum students" example="How many students can you teach well together? Example: 6. Choose 1 to 10." value={form.capacity} onChangeText={(capacity) => setForm({ ...form, capacity })} keyboardType="number-pad" />
              <Field disabled={locked} label="Full batch price (NPR)" example="One price per student for every lesson together, not per lesson. Example: 3000 for an eight-lesson guitar course. This is only an example, not a suggested price." value={form.totalTuitionNpr} onChangeText={(totalTuitionNpr) => setForm({ ...form, totalTuitionNpr })} keyboardType="number-pad" />
              <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>{formSummary}</Text>
            </ProgramCardShell> : null}
            {step === 1 ? <View style={{ gap: space.sm }}>
              <Text style={[t.title2, { color: colors.foreground }]}>Lesson schedule</Text>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Set Lesson 1 first. Repeat it on your teaching days, or add lessons individually. All times are Nepal time.</Text>
              {form.lessons.map((lesson, index) => (
                <React.Fragment key={index}><ProgramCardShell>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Lesson {index + 1}</Text><ProgramButton label={expandedLesson === index ? "Done editing" : "Edit lesson"} disabled={locked} emphasis="quiet" onPress={() => setExpandedLesson(expandedLesson === index ? null : index)} />{form.lessons.length > 1 && expandedLesson === index ? <ProgramButton label="Remove" disabled={locked} emphasis="quiet" icon="trash-2" onPress={() => { setForm({ ...form, lessons: form.lessons.filter((_, at) => at !== index) }); setExpandedLesson(null); }} /> : null}</View>
                  {expandedLesson !== index ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{batchDateValue(lesson.date) ? dates.formatBoth(batchDateValue(lesson.date)!) : "Date not chosen"} · {lesson.time || "Time not chosen"} · {lesson.durationMinutes} min</Text> : <>
                  <ScheduleChoice
                    disabled={locked}
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
                        disabled: locked,
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
                    <ScheduleChoice disabled={locked} label="Start time" value={lesson.time ? `${lesson.time} Nepal time` : "Choose from the clock"} icon="clock" onPress={() => setPickingTimeFor(index)} />
                  )}
                  <Text style={[t.caption, { color: colors.inkFaint }]}>Duration</Text>
                  <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>{durations.map((duration) => <ProgramButton key={duration} disabled={locked} label={`${duration} min`} emphasis={lesson.durationMinutes === duration ? "secondary" : "quiet"} onPress={() => setForm({ ...form, lessons: form.lessons.map((item, at) => at === index ? { ...item, durationMinutes: duration } : item) })} />)}</View>
                  </>}
                </ProgramCardShell>{index === 0 ? repeatPanel : null}</React.Fragment>
              ))}
              <ProgramButton label="Add a different lesson" disabled={locked || form.lessons.length >= BATCH_MAX_LESSONS} icon="plus" onPress={() => { setExpandedLesson(form.lessons.length); setForm({ ...form, lessons: [...form.lessons, { date: "", time: first.time, durationMinutes: first.durationMinutes }] }); }} grow />
            </View> : null}
            {step === 2 ? <>
              <ProgramCardShell>
                <Text style={[t.title2, { color: colors.foreground }]}>What this batch includes</Text>
                <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>{formSummary}</Text>
                <Text style={[t.body, { color: colors.foreground }]}>{form.lessons.length} lessons · up to {form.capacity || "—"} students</Text>
                <Text style={[t.callout, { color: colors.mutedForeground }]}>One full-batch price per student. Enrollment is planned to close at the start of Lesson 1.</Text>
              </ProgramCardShell>
              <ProgramCardShell><Text style={[t.title2, { color: colors.foreground }]}>Every lesson · Nepal time</Text>{form.lessons.map((lesson, index) => <Text key={index} style={[t.callout, { color: colors.foreground }]}>{index + 1}. {batchDateValue(lesson.date) ? dates.formatBoth(batchDateValue(lesson.date)!) : "Date not chosen"} · {lesson.time || "Time not chosen"} · {lesson.durationMinutes} min</Text>)}</ProgramCardShell>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>{dirty ? "These changes are not saved yet. Save the draft first; publishing is a separate confirmation." : "This is your saved draft. Students only see the version you explicitly publish."}</Text>
              {selected.status === "published" ? <ProgramButton label="Close this batch" icon="x-circle" emphasis="danger" disabled={dirty || locked} onPress={() => setConfirming("close")} /> : null}
              {selected.status === "closed" ? <ProgramNotice title="This batch is closed" body="It is no longer visible to students and cannot be edited." tone="stopped" icon="lock" /> : null}
            </> : null}
          </View>
        ) : null}
      </ScrollView>
      {selected && selected.status !== "closed" ? <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}><View style={{ width: "100%", maxWidth: marketplaceColumnMax, alignSelf: "center", paddingHorizontal: gutter, paddingVertical: space.sm, gap: space.xs }}>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>{busy ? "Please wait — saving your change…" : dirty ? "Unsaved changes · Next does not save" : "Draft saved"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {step > 0 ? <ProgramButton label="Previous" disabled={locked} onPress={() => moveTo(step === 2 ? 1 : 0)} /> : null}
          {step < 2 ? <ProgramButton label={step === 0 ? "Next: schedule" : "Next: review"} disabled={locked} emphasis="primary" onPress={nextStep} grow /> : dirty ? <ProgramButton label="Save draft" icon="save" emphasis="primary" busy={busy === "save"} disabled={locked} onPress={() => void save()} grow /> : <ProgramButton label={selected.status === "published" ? "Publish updated details" : "Publish batch preview"} icon="eye" emphasis="primary" busy={busy === "publish"} disabled={locked} onPress={() => setConfirming("publish")} grow />}
        </View>
      </View></View> : null}
    </SafeAreaView>
  );
}

function ScheduleChoice({ label, value, icon, onPress, disabled = false }: { label: string; value: string; icon: React.ComponentProps<typeof Feather>["name"]; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return <View style={{ gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><Pressable disabled={disabled} aria-disabled={disabled} accessibilityState={{ disabled }} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderWidth: 1, borderRadius: radius.sm, borderColor: colors.border, backgroundColor: colors.background }}><Feather name={icon} size={space.md} color={colors.primary} /><Text style={[t.body, { color: value.startsWith("Choose") ? colors.mutedForeground : colors.foreground, flex: 1 }]}>{value}</Text><Feather name="chevron-down" size={space.md} color={colors.mutedForeground} /></Pressable></View>;
}

function NativeTimePicker({ visible, value, title, onCancel, onPick }: { visible: boolean; value: string; title: string; onCancel: () => void; onPick: (value: string) => void }) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const [draft, setDraft] = useState(batchTimeValue(value));

  useEffect(() => { if (visible) setDraft(batchTimeValue(value)); }, [value, visible]);
  if (!visible) return null;

  const changed = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "set" && next) onPick(batchTimeDraft(next)); else onCancel();
      return;
    }
    if (next) setDraft(next);
  };

  if (Platform.OS === "android") return <DateTimePicker value={draft} mode="time" is24Hour={false} display="default" onChange={changed} />;

  return <Modal visible transparent animationType="fade" onRequestClose={onCancel}><View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg, backgroundColor: colors.scrim }}><View style={[elevation.modal, { width: "100%", maxWidth: marketplaceColumnMax, gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[t.title2, { color: colors.foreground }]}>{title}</Text><DateTimePicker value={draft} mode="time" is24Hour={false} display="spinner" onChange={changed} /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}><ProgramButton label="Cancel" emphasis="quiet" onPress={onCancel} grow /><ProgramButton label="Use this time" emphasis="primary" onPress={() => onPick(batchTimeDraft(draft))} grow /></View></View></View></Modal>;
}

function Field({ label, example, value, onChangeText, keyboardType, disabled = false }: { label: string; example: string; value: string; onChangeText: (value: string) => void; keyboardType?: "number-pad"; disabled?: boolean }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return <View style={{ gap: space.xxs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>{example}</Text><TextInput accessibilityLabel={label} editable={!disabled} aria-disabled={disabled} value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={[t.body, { minHeight: HIT_SLOP_MIN, color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }]} placeholderTextColor={colors.inkFaint} /></View>;
}
