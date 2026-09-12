import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/context/AuthContext";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useBrowserLeaveGuard } from "@/hooks/useLeaveGuard";
import { HIT_SLOP_MIN, marketplaceColumnMax } from "@/constants/layout";
import NepaliDatePicker from "@/components/NepaliDatePicker";
import {
  ProgramBackControl,
  ProgramButton,
  ProgramCardShell,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { BatchConfirmation } from "@/components/programs/BatchConfirmation";
import { NativeTimePicker } from "./NativeTimePicker";
import { ScheduleConflictPanel } from "./ScheduleConflictPanel";
import { BatchTestPanel } from "./BatchTestPanel";
import { apiGet, apiPost, apiPatch, ApiError } from "@/utils/api";
import { classEarningsEstimate, classPriceBreakdown, classPublishSummary } from "@/utils/classPrice";
import type { ClassEarningsEstimate as EarningsEstimate } from "@/utils/classPrice";
import {
  classDescriptionIssues,
  classIsPublished,
  emptyClassForm,
  formFromClass,
  type ClassForm,
  type TeachingClass,
} from "@/utils/teachingClass";
import {
  batchDateValue,
  draftTuitionPeriod,
  draftPeriodIssues,
  lessonDraft,
  type OwnerProgramBatch,
  type ProgramBatchLessonDraft,
} from "@/utils/programBatches";
import {
  BATCH_WEEKDAYS,
  batchDetailsIssues,
  batchScheduleIssues,
  calendarDay,
  repeatLessons,
  repeatPeriodLessons,
} from "@/utils/batchSchedule";

const titles = [
  "What will you teach?",
  "When will you teach?",
  "Class size and price",
  "Ready for students?",
];

function ClassEarningsEstimateCard({ estimate }: { estimate: EarningsEstimate | null }) {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  if (!estimate) return null;
  const amount = (value: number, fractionDigits = 0) => value.toLocaleString("en-NP", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return <ProgramCardShell>
    <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Your estimated earnings</Text>
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
        <Text style={[t.callout, { color: colors.mutedForeground, flex: 1 }]}>For each enrolled student</Text>
        <Text style={[t.bodyStrong, numeric, { color: colors.foreground, textAlign: "right" }]}>NPR {amount(estimate.totalNpr)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md }}>
        <Text style={[t.callout, { color: colors.mutedForeground, flex: 1 }]}>Approx. per completed lesson</Text>
        <Text style={[t.bodyStrong, numeric, { color: colors.foreground, textAlign: "right" }]}>NPR {amount(estimate.averagePerLessonNpr, 2)}</Text>
      </View>
    </View>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Before applicable taxes. This estimate uses the current teaching terms; approved refunds or adjustments may reduce the final payout.</Text>
  </ProgramCardShell>;
}

export default function ClassSetup() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const navigation = useNavigation();
  const colors = useColors();
  const { t, space, radius, gutter, numeric } = useLayout();
  const dates = useDates();
  const [item, setItem] = useState<TeachingClass | null>(null);
  const [teacherShareBps, setTeacherShareBps] = useState<number | null>(null);
  const [form, setFormState] = useState<ClassForm>(emptyClassForm);
  const formRef = useRef(form);
  const setForm = (next: ClassForm) => {
    formRef.current = next;
    setFormState(next);
  };
  const [accepted, setAccepted] = useState(JSON.stringify(emptyClassForm()));
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const op = useRef(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [timeIndex, setTimeIndex] = useState<number | null>(null);
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [count, setCount] = useState("8");
  const [individual, setIndividual] = useState(false);
  const [focusLesson, setFocusLesson] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<
    "publish" | "leave" | "replace" | "close" | null
  >(null);
  const [replacement, setReplacement] = useState<
    ProgramBatchLessonDraft[] | null
  >(null);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [departure, setDeparture] = useState<(() => void) | null>(null);
  const scroll = useRef<ScrollView>(null);
  const key = useRef("");
  const keyStorage = `fadko-class-create-${user?.id ?? "unknown"}`;
  const dirty = JSON.stringify(form) !== accepted;
  const scheduleFresh = !!item && JSON.stringify(form.lessons) === JSON.stringify(item.batch.lessons.map(lessonDraft));
  const conflicts = scheduleFresh ? item?.batch.scheduleConflicts ?? [] : [];
  const conflictIndices = new Set(conflicts.flatMap((c) => [c.lessonIndex, ...(c.otherLessonIndex === null ? [] : [c.otherLessonIndex])]));
  const locked = busy || !editing || item?.batch.status === "closed" || item?.batch.bookingLocked === true;
  const published = !!item && classIsPublished(item) && !dirty;
  const askLeave = useCallback((go: () => void) => {
    if (!op.current) {
      setLeaveAction(() => go);
      setConfirm("leave");
    }
  }, []);
  useBrowserLeaveGuard({
    dirty: dirty && !departure,
    armHistory: dirty && !departure,
    questionOpen: confirm === "leave",
    departing: !!departure,
    onHistoryBack: askLeave,
  });
  usePreventRemove(dirty && !departure, ({ data }) =>
    askLeave(() => navigation.dispatch(data.action)),
  );
  useEffect(() => {
    if (departure) departure();
  }, [departure]);
  const leave = (go: () => void) => {
    if (op.current) return;
    if (dirty) askLeave(go);
    else go();
  };
  const choose = (value: TeachingClass) => {
    setItem(value);
    const next = formFromClass(value);
    setForm(next);
    setAccepted(JSON.stringify(next));
  };
  const load = useCallback(async () => {
    setLoading(true);
    setIssues([]);
    setDeparture(null);
    setConfirm(null);
    setWeekdays(null);
    setFocusLesson(null);
    setIndividual(false);
    try {
      if (id) {
        const result = await apiGet<{ item: TeachingClass }>(
          `/teaching-classes/${id}`,
        );
        const next = formFromClass(result.item);
        setItem(result.item);
        formRef.current = next;
        setFormState(next);
        setAccepted(JSON.stringify(next));
        setStep(result.item.batch.lessons.length ? 3 : 1);
        setEditing(!classIsPublished(result.item));
      } else {
        key.current =
          (await AsyncStorage.getItem(keyStorage)) ?? Crypto.randomUUID();
        await AsyncStorage.setItem(keyStorage, key.current);
      }
    } catch (error) {
      setIssues([
        error instanceof Error ? error.message : "Could not load this class.",
      ]);
    } finally {
      setLoading(false);
    }
  }, [id, keyStorage]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let alive = true;
    apiGet<{ teacherShareBps?: number }>("/teachers/me/billing")
      .then((policy) => {
        if (!alive) return;
        const share = policy.teacherShareBps;
        setTeacherShareBps(Number.isInteger(share) && (share ?? 0) > 0 && (share ?? 0) <= 10_000 ? share! : null);
      })
      .catch(() => { if (alive) setTeacherShareBps(null); });
    return () => { alive = false; };
  }, []);
  const move = (next: number) => {
    setStep(next);
    setIssues([]);
    setNotice("");
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const editConflict = (index: number) => {
    if (busy || !form.lessons[index]) return;
    setEditing(true);
    setIndividual(true);
    setFocusLesson(index);
    move(1);
  };
  const first = form.lessons[0]!;
  const period = draftTuitionPeriod(
    item?.batch ??
      ({ format: form.format, tuitionGroupId: 1 } as OwnerProgramBatch),
    first,
  );
  const weekday = calendarDay(first.date)?.getUTCDay();
  const days = weekdays ?? (weekday === undefined ? [] : [weekday]);
  const generated =
    form.format === "ongoing"
      ? repeatPeriodLessons(first, days, period)
      : repeatLessons(first, Number(count), days);
  const dateLabel = (date: string) =>
    batchDateValue(date)
      ? dates.formatBoth(batchDateValue(date)!)
      : "Choose a date";
  const instantLabel = (iso: string) => {
    const value = lessonDraft({ startsAt: iso, durationMinutes: 60 });
    return `${dateLabel(value.date)} · ${value.time} Nepal time`;
  };
  const nextStep = () => {
    const errors =
      step === 0
        ? classDescriptionIssues(form)
        : step === 1
          ? [
              ...batchScheduleIssues(form.lessons, Date.now()),
              ...draftPeriodIssues(period, form.lessons),
            ]
          : batchDetailsIssues(form.capacity, form.totalTuitionNpr);
    if (errors.length) {
      setIssues(errors);
      scroll.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    move(step + 1);
  };
  const fail = (error: unknown) => {
    setIssues(
      error instanceof ApiError
        ? ((error as ApiError & { data?: { issues?: string[] } }).data
            ?.issues ?? [error.message])
        : [
            error instanceof Error
              ? error.message
              : "Could not save. Your entries are still here.",
          ],
    );
  };
  const save = async () => {
    if (op.current || (!id && !key.current)) return;
    const sending = formRef.current;
    const sent = JSON.stringify(sending);
    op.current = true;
    setBusy(true);
    setIssues([]);
    try {
      const body = {
        ...sending,
        capacity: Number(sending.capacity),
        totalTuitionNpr: Number(sending.totalTuitionNpr),
        requestKey: key.current,
        expectedUpdatedAt: item?.batch.updatedAt,
        expectedProgramUpdatedAt: item?.programUpdatedAt,
      };
      const result: { item: TeachingClass; created?: boolean } = item
        ? await apiPatch<{ item: TeachingClass }>(
            `/teaching-classes/${item.batch.id}`,
            body,
          )
        : await apiPost<{ item: TeachingClass; created: boolean }>(
            "/teaching-classes",
            body,
          );
      setItem(result.item);
      const next = formFromClass(result.item);
      setAccepted(JSON.stringify(next));
      const recoveredDifferentDraft =
        result.created === false &&
        JSON.stringify(next) !==
          JSON.stringify({
            ...sending,
            title: sending.title.trim(),
            summary: sending.summary.trim(),
            teachingLanguage: sending.teachingLanguage.trim(),
            outline: sending.outline.trim(),
            capacity: String(Number(sending.capacity)),
            totalTuitionNpr: String(Number(sending.totalTuitionNpr)),
          });
      if (!recoveredDifferentDraft && JSON.stringify(formRef.current) === sent)
        setForm(next);
      if (!id) {
        await AsyncStorage.removeItem(keyStorage);
        if (JSON.stringify(formRef.current) === JSON.stringify(next))
          setDeparture(
            () => () =>
              router.replace({
                pathname: "/(teacher)/teaching-class/[id]",
                params: { id: String(result.item.batch.id) },
              }),
          );
      }
      setNotice(
        recoveredDifferentDraft
          ? "Your earlier save was recovered. Your newer entries are still here — save them once more to update that draft."
          : "Draft saved. Students cannot see these changes until you publish.",
      );
    } catch (error) {
      fail(error);
    } finally {
      op.current = false;
      setBusy(false);
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
  };
  const publish = async () => {
    if (!item || op.current || dirty || published) return;
    op.current = true;
    setBusy(true);
    setIssues([]);
    try {
      const result = await apiPost<{ item: TeachingClass }>(
        `/teaching-classes/${item.batch.id}/publish`,
        {
          expectedUpdatedAt: item.batch.updatedAt,
          expectedProgramUpdatedAt: item.programUpdatedAt,
        },
      );
      choose(result.item);
      setEditing(false);
      setNotice(
        "Class listing published. Joining and payment are not open in this preview.",
      );
    } catch (error) {
      fail(error);
    } finally {
      op.current = false;
      setBusy(false);
      setConfirm(null);
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
  };
  const nextPeriod = async () => {
    if (!item || dirty || op.current) return;
    op.current = true;
    setBusy(true);
    setIssues([]);
    try {
      const result = await apiPost<{ batch: OwnerProgramBatch }>(
        `/learning-program-batches/${item.batch.id}/next-period`,
        {},
      );
      const next = await apiGet<{ item: TeachingClass }>(
        `/teaching-classes/${result.batch.id}`,
      );
      setDeparture(
        () => () =>
          router.replace({
            pathname: "/(teacher)/teaching-class/[id]",
            params: { id: String(next.item.batch.id) },
          }),
      );
      setNotice(
        "Same class, next 30 days. Check the lesson dates and price before publishing. Nobody has been charged.",
      );
    } catch (error) {
      fail(error);
    } finally {
      op.current = false;
      setBusy(false);
    }
  };
  const close = async () => {
    if (!item || dirty || op.current) return;
    op.current = true;
    setBusy(true);
    try {
      await apiPost(`/learning-program-batches/${item.batch.id}/close`, {});
      choose(
        (
          await apiGet<{ item: TeachingClass }>(
            `/teaching-classes/${item.batch.id}`,
          )
        ).item,
      );
      setNotice("Listing closed. It is no longer offered to students.");
    } catch (e) {
      fail(e);
    } finally {
      op.current = false;
      setBusy(false);
      setConfirm(null);
    }
  };
  const changeLesson = (
    index: number,
    change: Partial<ProgramBatchLessonDraft>,
  ) =>
    setForm({
      ...formRef.current,
      lessons: formRef.current.lessons.map((l, i) =>
        i === index ? { ...l, ...change } : l,
      ),
    });
  const useSchedule = (lessons: ProgramBatchLessonDraft[]) => {
    setForm({ ...formRef.current, lessons });
    setIndividual(false);
    setConfirm(null);
    setNotice(
      `${lessons.length} lesson dates ready. Check the list below, including holidays.`,
    );
  };
  const name = item?.title || "Create a class";
  const price =
    Number(form.totalTuitionNpr) > 0
      ? `NPR ${Number(form.totalTuitionNpr).toLocaleString()} per student ${form.format === "ongoing" ? "for these 30 days" : "for the whole course"}`
      : "Set the full price before publishing";
  const earningsEstimate = teacherShareBps === null
    ? null
    : classEarningsEstimate(Number(form.totalTuitionNpr), form.lessons.length, teacherShareBps);
  if (loading)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  const confirmTitle =
    confirm === "leave"
      ? "Leave without saving?"
      : confirm === "replace"
        ? "Replace these lesson dates?"
        : confirm === "close"
          ? "Close this listing?"
          : "Publish this class listing?";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingHorizontal: gutter,
          maxWidth: marketplaceColumnMax,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <ProgramBackControl
          testID="class-back"
          label="My classes"
          onPress={() =>
            leave(() => router.replace("/(teacher)/teaching-classes"))
          }
        />
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: gutter,
          gap: space.lg,
          maxWidth: marketplaceColumnMax,
          width: "100%",
          alignSelf: "center",
          paddingBottom: space.huge,
        }}
      >
        <View style={{ gap: space.xs }}>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>
            {step === 3 && published ? "Your class" : `Step ${step + 1} of 4`}
          </Text>
          <Text style={[t.title1, { color: colors.foreground }]}>
            {step === 3 ? name : titles[step]}
          </Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            {step === 0
              ? "Start with what you already teach. No separate course setup needed."
              : published ? "Your listing is published. Edit only when something changes." : item?.batch.status === "closed" ? "This listing is closed." : "Your work stays a draft until you review and publish it."}
          </Text>
        </View>
        {issues.length ? (
          <View accessibilityRole="alert">
            <ProgramNotice title="Please check" tone="stopped">
              {issues.map((issue, i) => (
                <Text key={i} style={[t.callout, { color: colors.foreground }]}>
                  {issue}
                </Text>
              ))}
              {id && !item ? (
                <ProgramButton label="Try again" onPress={() => void load()} />
              ) : null}
            </ProgramNotice>
          </View>
        ) : null}
        {notice ? <ProgramNotice title={notice} /> : null}
        {step === 0 ? (
          <>
            {!item ? (
              <ProgramCardShell>
                <Text style={[t.title3, { color: colors.foreground }]}>
                  How will this class run?
                </Text>
                <ProgramButton
                  label="Regular tuition · every 30 days"
                  emphasis={form.format === "ongoing" ? "secondary" : "quiet"}
                  disabled={locked}
                  onPress={() => setForm({ ...form, format: "ongoing" })}
                />
                <Text style={[t.caption, { color: colors.mutedForeground }]}>
                  For a continuing Maths, Science or language group.
                </Text>
                <ProgramButton
                  label="Short course · a set finish"
                  emphasis={form.format === "fixed" ? "secondary" : "quiet"}
                  disabled={locked}
                  onPress={() => setForm({ ...form, format: "fixed", allowLateJoining: false })}
                />
                <Text style={[t.caption, { color: colors.mutedForeground }]}>
                  For exam preparation, a language course or a set of music
                  lessons.
                </Text>
                <ProgramButton
                  label="Just one lesson"
                  disabled={locked}
                  emphasis="quiet"
                  onPress={() =>
                    leave(() => router.push("/(teacher)/session-create"))
                  }
                />
                <Text style={[t.caption, { color: colors.mutedForeground }]}>
                  Opens the existing single-lesson booking setup.
                </Text>
              </ProgramCardShell>
            ) : null}
            <ClassField
              label="Class name"
              hint="Example: SEE Maths evening tuition"
              value={form.title}
              disabled={locked}
              onChange={(title) => setForm({ ...form, title })}
            />
            <ClassField
              label="Tell students about your class"
              hint="Who is it for, and how will you help? Example: For Class 10 students who want help with algebra and geometry. We solve school exercises together and make time for questions."
              value={form.summary}
              disabled={locked}
              multiline
              onChange={(summary) => setForm({ ...form, summary })}
            />
            <ClassField
              label="Teaching language"
              hint="Example: Nepali and English"
              value={form.teachingLanguage}
              disabled={locked}
              onChange={(teachingLanguage) =>
                setForm({ ...form, teachingLanguage })
              }
            />
            <ProgramButton
              label={
                outlineOpen
                  ? "Hide optional teaching plan"
                  : "Add a teaching plan (optional)"
              }
              emphasis="quiet"
              onPress={() => setOutlineOpen(!outlineOpen)}
            />
            {outlineOpen ? (
              <ClassField
                label="What will you cover? (optional)"
                hint="Example: First we practise fractions, then equations, then exam questions. Leave this empty if your tuition follows students' weekly schoolwork."
                value={form.outline}
                multiline
                disabled={locked}
                onChange={(outline) => setForm({ ...form, outline })}
              />
            ) : null}
          </>
        ) : null}
        {step === 1 ? (
          <>
            {item?.batch.periodAnchorLocked && period ? (
              <ProgramNotice
                title="Your next teaching dates"
                body={`From ${instantLabel(period.startsAt)} until ${instantLabel(period.endsAt)}. All lessons must finish inside these dates.`}
              />
            ) : null}
            {focusLesson !== null ? <ProgramButton label="Show all lesson editors" emphasis="quiet" onPress={() => setFocusLesson(null)} /> : null}
            {(individual ? form.lessons.map((lesson, index) => ({ lesson, index })).filter(({ index }) => focusLesson === null || index === focusLesson) : [{ lesson: first, index: 0 }]).map(({ lesson, index: i }) => (
              <ProgramCardShell key={i}>
                {conflictIndices.has(i) ? <Text style={[t.bodyStrong, { color: colors.destructive }]}>Overlapping time · lesson {i + 1}</Text> : null}
                <Text style={[t.title3, { color: colors.foreground }]}>
                  {individual ? `Lesson ${i + 1}` : "First lesson"}
                </Text>
                <ProgramButton
                  label={`Date: ${dateLabel(lesson.date)}`}
                  icon="calendar"
                  disabled={locked}
                  onPress={() => setDayIndex(i)}
                />
                {Platform.OS === "web" ? (
                  <View style={{ gap: space.xs }}>
                    <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                      Start time · Nepal
                    </Text>
                    {React.createElement("input", {
                      type: "time",
                      value: lesson.time,
                      disabled: locked,
                      "aria-label": `Lesson ${i + 1} start time in Nepal`,
                      "data-testid": `class-time-${i}`,
                      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                        changeLesson(i, { time: event.target.value }),
                      style: {
                        minHeight: HIT_SLOP_MIN,
                        width: "100%",
                        boxSizing: "border-box",
                        color: colors.foreground,
                        background: colors.card,
                        border: `1px solid ${colors.border}`,
                        borderRadius: radius.sm,
                        padding: space.sm,
                        fontSize: t.body.fontSize,
                        fontFamily: t.body.fontFamily,
                      },
                    })}
                  </View>
                ) : (
                  <ProgramButton
                    label={`Time: ${lesson.time || "Choose a time"}`}
                    icon="clock"
                    disabled={locked}
                    onPress={() => setTimeIndex(i)}
                  />
                )}
                <View
                  style={{
                    flexDirection: "row",
                    gap: space.xs,
                    flexWrap: "wrap",
                  }}
                >
                  {[30, 45, 60, 90].map((minutes) => (
                    <ProgramButton
                      key={minutes}
                      label={`${minutes} min`}
                      disabled={locked}
                      emphasis={
                        lesson.durationMinutes === minutes
                          ? "secondary"
                          : "quiet"
                      }
                      onPress={() =>
                        changeLesson(i, { durationMinutes: minutes })
                      }
                    />
                  ))}
                </View>
              </ProgramCardShell>
            ))}
            {!individual ? (
              <ProgramCardShell>
                <Text style={[t.title3, { color: colors.foreground }]}>
                  Teaching days
                </Text>
                <Text style={[t.callout, { color: colors.mutedForeground }]}>
                  Choose the days you normally teach. The first lesson must fall
                  on one of them.
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.xs,
                  }}
                >
                  {BATCH_WEEKDAYS.map((day, i) => (
                    <ProgramButton
                      key={day}
                      label={`${day}${days.includes(i) ? " · selected" : ""}`}
                      disabled={locked}
                      emphasis={days.includes(i) ? "secondary" : "quiet"}
                      onPress={() =>
                        setWeekdays(
                          days.includes(i)
                            ? days.filter((d) => d !== i)
                            : [...days, i],
                        )
                      }
                    />
                  ))}
                </View>
                {form.format === "fixed" ? (
                  <ClassField
                    label="How many lessons?"
                    hint="Example: 8 lessons in total, including the first."
                    value={count}
                    disabled={locked}
                    numeric
                    onChange={setCount}
                  />
                ) : (
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>
                    Fadko lists the matching lessons within 30 days. Thirty days
                    does not mean thirty lessons.
                  </Text>
                )}
                <ProgramButton
                  label="Prepare my timetable"
                  disabled={locked || !generated.ok}
                  onPress={() => {
                    if (generated.ok) {
                      if (form.lessons.length > 1) {
                        setReplacement(generated.lessons);
                        setConfirm("replace");
                      } else useSchedule(generated.lessons);
                    }
                  }}
                />
                {!generated.ok ? (
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>
                    {generated.message}
                  </Text>
                ) : null}
              </ProgramCardShell>
            ) : null}
            <ProgramCardShell>
              <Text style={[t.title3, { color: colors.foreground }]}>
                Your lesson dates
              </Text>
              {form.lessons.map((l, i) => (
                <Text
                  key={i}
                  style={[t.callout, numeric, { color: conflictIndices.has(i) ? colors.destructive : colors.foreground }]}
                >
                  {conflictIndices.has(i) ? "⚠ " : ""}{i + 1}. {dateLabel(l.date)} · {l.time || "Time not chosen"} ·{" "}
                  {l.durationMinutes} min
                </Text>
              ))}
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                Check school holidays and festivals. Dates are not skipped
                automatically.
              </Text>
              <ProgramButton
                label={
                  individual
                    ? "Back to regular days"
                    : "Adjust individual dates"
                }
                disabled={locked}
                emphasis="quiet"
                onPress={() => { setFocusLesson(null); setIndividual(!individual); }}
              />
            </ProgramCardShell>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <ClassField
              label="Maximum students"
              hint="Choose 1 to 10. How many students can you comfortably teach together?"
              value={form.capacity}
              numeric
              disabled={locked}
              onChange={(capacity) => setForm({ ...form, capacity })}
            />
            <ClassField
              label={
                form.format === "ongoing"
                  ? "Price for 30 days (NPR)"
                  : "Price for the whole course (NPR)"
              }
              hint="One full price per student for the listed lessons. Payment is upfront. Example: 3000 (not a suggested price)."
              value={form.totalTuitionNpr}
              numeric
              disabled={locked}
              onChange={(totalTuitionNpr) =>
                setForm({ ...form, totalTuitionNpr })
              }
            />
            <Text style={[t.callout, numeric, { color: colors.foreground }]}>
              {classPriceBreakdown(Number(form.totalTuitionNpr), form.lessons.length)}
            </Text>
            <ClassEarningsEstimateCard estimate={earningsEstimate} />
            {form.format === "ongoing" ? (
              <ProgramCardShell>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>Allow late joining?</Text>
                <Switch testID="class-late-joining" accessibilityLabel="Allow late joining" value={form.allowLateJoining} disabled={locked}
                  onValueChange={(allowLateJoining) => setForm({ ...form, allowLateJoining })}
                  trackColor={{ false: colors.border, true: colors.primary }} />
                <Text style={[t.callout, { color: colors.mutedForeground }]}>When joining opens, new students will pay only for lessons that have not started, if a seat is available. Everyone keeps the same end date. Past lessons and individual catch-up teaching are not included. Off by default; choose again for each new period.</Text>
              </ProgramCardShell>
            ) : null}
            <ProgramNotice
              title="No money moves during this preview"
              body="Students cannot join or pay for these listings yet. This step plans the price; it does not collect it."
            />
          </>
        ) : null}
        {step === 3 ? (
          <>
            <ProgramCardShell>
              <Text style={[t.title2, { color: colors.foreground }]}>
                {form.title}
              </Text>
              <Text style={[t.body, { color: colors.foreground }]}>
                {form.summary}
              </Text>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>
                Taught in {form.teachingLanguage}
              </Text>
              <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>
                {price}
              </Text>
              <Text style={[t.callout, numeric, { color: colors.foreground }]}>{classPriceBreakdown(Number(form.totalTuitionNpr), form.lessons.length)}</Text>
              {form.format === "ongoing" ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{form.allowLateJoining ? "Late joining planned: remaining lessons only, same end date." : "Late joining off: enrollment closes at the period start."}</Text> : null}
              {form.format === "ongoing" && form.lessons.length === 1 ? <ProgramNotice tone="waiting" title="Only 1 lesson in these 30 days" body="The full price buys that single lesson. Check your timetable before publishing." /> : null}
              <Text style={[t.callout, { color: colors.foreground }]}>
                {form.lessons.length} lessons · up to {form.capacity} students ·{" "}
                {form.format === "ongoing" ? "Regular tuition" : "Short course"}
              </Text>
              {period ? (
                <Text style={[t.caption, { color: colors.mutedForeground }]}>
                  These 30 days: {instantLabel(period.startsAt)} until{" "}
                  {instantLabel(period.endsAt)}. Next 30 days start then;
                  payment is never automatic.
                </Text>
              ) : null}
            </ProgramCardShell>
            <ClassEarningsEstimateCard estimate={earningsEstimate} />
            <ProgramCardShell>
              <Text style={[t.title3, { color: colors.foreground }]}>
                Timetable · Nepal time
              </Text>
              {form.lessons.map((l, i) => (
                <Text
                  key={i}
                  style={[t.callout, numeric, { color: conflictIndices.has(i) ? colors.destructive : colors.foreground }]}
                >
                  {conflictIndices.has(i) ? "⚠ " : ""}{i + 1}. {dateLabel(l.date)} · {l.time} · {l.durationMinutes} min
                </Text>
              ))}
            </ProgramCardShell>
            {form.outline ? (
              <ProgramCardShell>
                <Text style={[t.title3, { color: colors.foreground }]}>
                  Your teaching plan
                </Text>
                <Text style={[t.callout, { color: colors.foreground }]}>
                  {form.outline}
                </Text>
              </ProgramCardShell>
            ) : null}
            {conflicts.length ? <ScheduleConflictPanel conflicts={conflicts} formatDate={instantLabel} onEdit={editConflict} busy={busy}
              onRefresh={() => { if (dirty) void save(); else void load(); }}
              onOpen={(source) => leave(() => source.kind === "class" ? router.push({ pathname: "/(teacher)/teaching-class/[id]", params: { id: String(source.id) } }) : router.push({ pathname: "/(teacher)/program-batches/[id]", params: { id: String(source.id) } }))} /> : null}
            {item && !scheduleFresh ? <ProgramNotice title="Dates changed" body="Save draft to check these times for overlaps." /> : null}
            {!dirty && !conflicts.length && item?.batch.scheduleIssues?.length ? (
              <ProgramNotice title="Some dates need attention" tone="stopped">
                {item.batch.scheduleIssues.map((message, i) => (
                  <Text
                    key={i}
                    style={[t.callout, { color: colors.foreground }]}
                  >
                    {message}
                  </Text>
                ))}
              </ProgramNotice>
            ) : null}
            {item?.batch.testPilotEndsAt && item.batch.status === "published" ? <BatchTestPanel batchId={item.batch.id} teacher /> : <ProgramNotice
              title="Listing preview"
              body="Publishing shows the description, dates and price. Student joining, payments and live lessons for this listing are not available yet."
            />}
            {item?.batch.bookingLocked ? <ProgramNotice title="Booked details are locked" body="A student has a test place. Keep these dates and details as promised. Use a copy for another test class." /> : null}
            {item?.batch.status === "published" && form.format === "ongoing" && !item.batch.bookingLocked ? (
              <ProgramButton
                label="Prepare the next 30 days"
                disabled={busy || dirty}
                onPress={() => void nextPeriod()}
              />
            ) : null}
            {item?.batch.status === "published" && !item.batch.bookingLocked ? (
              <ProgramButton
                label="Close this listing"
                emphasis="danger"
                disabled={busy || dirty}
                onPress={() => setConfirm("close")}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {(!id || item) && item?.batch.status !== "closed" ? (
        <View
          style={{
            borderTopWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <View
            style={{
              padding: gutter,
              gap: space.xs,
              width: "100%",
              maxWidth: marketplaceColumnMax,
              alignSelf: "center",
            }}
          >
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              {busy
                ? "Saving your change…"
                : dirty
                  ? "Unsaved changes"
                  : published
                    ? "Published — up to date"
                    : item
                      ? "Draft saved"
                      : "Nothing published yet"}
            </Text>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}
            >
              {step > 0 && editing ? (
                <ProgramButton
                  label="Previous"
                  disabled={busy}
                  onPress={() => move(step - 1)}
                />
              ) : null}
              {step === 3 ? (
                <>
                  <ProgramButton
                    label="Edit details"
                    disabled={busy || item?.batch.bookingLocked === true}
                    onPress={() => {
                      setEditing(true);
                      move(0);
                    }}
                  />
                  {dirty || !item ? (
                    <ProgramButton
                      label="Save draft"
                      emphasis="primary"
                      disabled={busy}
                      busy={busy}
                      onPress={() => void save()}
                      grow
                    />
                  ) : (
                    <ProgramButton
                      label={
                        published ? "Published — up to date" : "Publish class"
                      }
                      emphasis="primary"
                      disabled={busy || published || item?.batch.bookingLocked === true}
                      onPress={() => setConfirm("publish")}
                      grow
                    />
                  )}
                </>
              ) : (
                <ProgramButton
                  label={step === 2 ? "Review my class" : "Continue"}
                  emphasis="primary"
                  disabled={locked}
                  onPress={nextStep}
                  grow
                />
              )}
            </View>
          </View>
        </View>
      ) : null}
      <NepaliDatePicker
        visible={dayIndex !== null}
        value={
          dayIndex === null
            ? null
            : batchDateValue(form.lessons[dayIndex]?.date ?? "")
        }
        minDate={new Date()}
        title="Choose lesson date"
        onCancel={() => setDayIndex(null)}
        onPick={(date) => {
          const pad = (n: number) => String(n).padStart(2, "0");
          if (dayIndex !== null)
            changeLesson(dayIndex, {
              date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
            });
          setDayIndex(null);
        }}
      />
      <NativeTimePicker
        visible={timeIndex !== null}
        value={timeIndex === null ? "" : (form.lessons[timeIndex]?.time ?? "")}
        onCancel={() => setTimeIndex(null)}
        onPick={(time) => {
          if (timeIndex !== null) changeLesson(timeIndex, { time });
          setTimeIndex(null);
        }}
      />
      <BatchConfirmation
        visible={confirm !== null}
        title={confirmTitle}
        consequences={
          confirm === "publish"
            ? classPublishSummary(Number(form.totalTuitionNpr), form.lessons.length, form.format === "ongoing")
            : confirm === "replace"
              ? [
                  "This replaces the lesson dates currently in your draft. Nothing is saved until Save draft succeeds.",
                ]
              : confirm === "close"
                ? [
                    "Students will no longer see this offer. This action cannot be undone.",
                  ]
                : [
                    "Only unsaved changes will be lost. Your saved work stays safe.",
                  ]
        }
        confirmLabel={
          confirm === "publish"
            ? "Confirm and publish"
            : confirm === "replace"
              ? "Replace dates"
              : confirm === "close"
                ? "Close listing"
                : "Leave without saving"
        }
        destructive={confirm !== "publish"}
        busy={busy}
        onCancel={() => {
          if (!op.current) setConfirm(null);
        }}
        onConfirm={() => {
          if (op.current) return;
          if (confirm === "publish") void publish();
          else if (confirm === "close") void close();
          else if (confirm === "replace" && replacement)
            useSchedule(replacement);
          else if (confirm === "leave" && leaveAction) {
            setDeparture(() => leaveAction);
            setConfirm(null);
          }
        }}
      />
    </SafeAreaView>
  );
}
export function ClassField({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  numeric = false,
  disabled = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
  disabled?: boolean;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{hint}</Text>
      <TextInput
        accessibilityLabel={label}
        aria-disabled={disabled}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={numeric ? "number-pad" : "default"}
        style={[
          t.body,
          {
            minHeight: multiline ? HIT_SLOP_MIN * 2 : HIT_SLOP_MIN,
            textAlignVertical: "top",
            color: colors.foreground,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.sm,
            padding: space.sm,
          },
        ]}
      />
    </View>
  );
}
