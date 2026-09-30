import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NepaliDatePicker from "@/components/NepaliDatePicker";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { NativeTimePicker } from "@/components/classes/NativeTimePicker";
import {
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramFailure,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { useDates } from "@/context/DatePreferenceContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { readingWidth } from "@/constants/layout";
import { apiGet, apiPost } from "@/utils/api";
import { confirm } from "@/utils/alerts";
import { batchDateValue, lessonDraft } from "@/utils/programBatches";
import {
  remedyOfferInstant,
  remedyQuotaLabel,
  remedyStatusLabel,
  remedyVisibleLessons,
  type RemedyFilter,
  type RemedyLesson,
  type RemedyList,
} from "@/utils/lessonRemedyView";

type Form = {
  lesson: RemedyLesson;
  mode: "request" | "offer" | "reject" | "resolve";
  reason: "student_missed" | "teacher_missed";
};
const filters: Array<{ id: RemedyFilter; label: string }> = [
  { id: "attention", label: "To arrange" },
  { id: "scheduled", label: "Scheduled" },
  { id: "history", label: "History" },
  { id: "all", label: "All" },
];
const outcomes = [
  { value: "replacement_delivered", label: "Confirm replacement delivered" },
  { value: "student_missed_replacement", label: "Student missed replacement" },
  { value: "teacher_missed_replacement", label: "Teacher missed replacement" },
  { value: "refund_review", label: "Continue refund review" },
  { value: "refund_approved", label: "Approve original lesson refund" },
  { value: "refund_denied", label: "Resume review after Support denial" },
  { value: "no_adjustment", label: "Close with no adjustment" },
] as const;

/** The same original-lesson record accompanies every action; never a new checkout. */
export default function MakeupsWorkspace({
  operator = false,
}: {
  operator?: boolean;
}) {
  const { id, sessionId } = useLocalSearchParams<{
    id?: string;
    sessionId?: string;
  }>();
  const batchId = Number(id) > 0 ? Number(id) : undefined;
  const originalId = Number(sessionId) > 0 ? Number(sessionId) : undefined;
  const colors = useColors();
  const { t, space, radius, numeric, isExpanded } = useLayout();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const { lastEvent } = useNotifications();
  const [data, setData] = useState<RemedyList | null>(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<RemedyFilter>("all");
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  // Retrying an ambiguous network result reuses the operation's durable key.
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [datePicker, setDatePicker] = useState(false);
  const [timePicker, setTimePicker] = useState(false);
  const [confirmedTeacherMissed, setConfirmedTeacherMissed] = useState(false);
  const [outcome, setOutcome] =
    useState<(typeof outcomes)[number]["value"]>("refund_review");
  const [deliveryChecked, setDeliveryChecked] = useState(false);
  const [formError, setFormError] = useState("");
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await apiGet<RemedyList>(
        operator
          ? "/admin/lesson-remedies"
          : batchId
            ? `/class-groups/${batchId}/remedies`
            : "/lesson-remedies",
      );
      if (alive.current && request === sequence.current) {
        setData(next);
        setProblem("");
      }
    } catch (error) {
      if (alive.current && request === sequence.current)
        setProblem(
          error instanceof Error
            ? error.message
            : "Make-ups could not be loaded.",
        );
    }
  }, [batchId, operator]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (lastEvent?.kind === "makeup_update") void load();
  }, [lastEvent, load]);

  const mutate = async (
    path: string,
    body: Record<string, unknown>,
    success: string,
  ) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFormError("");
    setNotice("");
    const fingerprint = JSON.stringify([path, body]);
    if (pendingKey.current?.fingerprint !== fingerprint)
      pendingKey.current = { fingerprint, key: Crypto.randomUUID() };
    try {
      await apiPost(path, { ...body, requestKey: pendingKey.current.key });
      pendingKey.current = null;
      if (alive.current) {
        setModalOpen(false);
        setNotice(success);
        await load();
      }
    } catch (error) {
      if (alive.current) {
        const message =
          error instanceof Error
            ? error.message
            : "The change was not confirmed. Try again.";
        setFormError(message);
        setProblem(message);
        await load();
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const openForm = (
    lesson: RemedyLesson,
    mode: Form["mode"],
    reason: Form["reason"] = "student_missed",
  ) => {
    const proposed = lessonDraft({
      startsAt: new Date(
        Date.parse(data?.serverNow ?? "") + 24 * 60 * 60 * 1000,
      ).toISOString(),
      durationMinutes: 60,
    });
    setDate(proposed.date);
    setTime(proposed.time);
    setNote("");
    setFormError("");
    setConfirmedTeacherMissed(false);
    setOutcome("refund_review");
    setDeliveryChecked(false);
    setForm({ lesson, mode, reason });
    setModalOpen(true);
  };
  const submit = () => {
    if (!form) return;
    const { lesson, mode, reason } = form;
    const remedy = lesson.case;
    const trimmed = note.trim();
    if (
      (mode === "request" || mode === "reject" || mode === "resolve") &&
      trimmed.length < 10
    ) {
      setFormError(
        "Add a little detail (at least 10 characters) so the next person can help.",
      );
      return;
    }
    if (mode === "request")
      void mutate(
        `/sessions/${lesson.originalSessionId}/makeup-request`,
        { reason, note: trimmed },
        "Your request is with the teacher. You can follow it here.",
      );
    else if (mode === "offer" && remedy) {
      const startsAt = remedyOfferInstant(date, time);
      if (!startsAt) {
        setFormError("Choose a valid date and Nepal start time.");
        return;
      }
      if (
        remedy.reason === "teacher_missed" &&
        !remedy.teacherNonDeliveryConfirmed &&
        !confirmedTeacherMissed
      ) {
        setFormError(
          "Confirm the missed teaching below before offering a teacher non-delivery replacement.",
        );
        return;
      }
      void mutate(
        `/lesson-remedies/${remedy.id}/offer`,
        { startsAt, confirmTeacherNonDelivery: confirmedTeacherMissed },
        "Replacement date offered. The student must accept it before it is assigned.",
      );
    } else if (mode === "reject" && remedy)
      void mutate(
        `/lesson-remedies/${remedy.id}/decision`,
        { decision: "reject", reason: trimmed },
        "The decision has been recorded. This does not issue a refund or decide delivery.",
      );
    else if (mode === "resolve" && remedy) {
      if (!deliveryChecked) {
        setFormError(
          "Review the evidence and confirm the check below before recording this decision.",
        );
        return;
      }
      void mutate(
        `/admin/lesson-remedies/${remedy.id}/resolve`,
        { outcome, note: trimmed, confirmed: deliveryChecked },
        "Review recorded against the original lesson. No new charge or automatic refund was created.",
      );
    }
  };
  const act = async (
    lesson: RemedyLesson,
    action: "accept" | "decline" | "withdraw",
  ) => {
    const value = lesson.case;
    if (!value) return;
    const sure = await confirm(
      action === "accept"
        ? "Accept this make-up date?"
        : action === "withdraw"
          ? "Withdraw your request?"
          : "Decline this offered date?",
      action === "accept"
        ? "This uses the original lesson payment, not a second charge. Only one replacement can be accepted for this lesson."
        : "No refund is issued by this action. You can still ask Support to review the original lesson.",
      action === "accept"
        ? "Accept date"
        : action === "withdraw"
          ? "Withdraw"
          : "Decline date",
    );
    if (sure)
      await mutate(
        `/lesson-remedies/${value.id}/${action}`,
        action === "accept" ? { offerId: value.offer?.id } : {},
        action === "accept"
          ? "Your make-up is assigned. Open it here or from your schedule."
          : "Your decision was recorded. Refund review remains a separate Support decision.",
      );
  };
  const format = (value: string) => {
    const local = lessonDraft({ startsAt: value, durationMinutes: 60 });
    const carrier = batchDateValue(local.date);
    return carrier
      ? `${dates.format(carrier)} · ${local.time} Nepal time`
      : "Date unavailable";
  };
  const candidates = data?.lessons ?? [];
  const visible = remedyVisibleLessons(candidates, filter, originalId);
  const teacher = data?.role === "teacher";
  const operatorMode = operator && data?.role === "admin";
  const label =
    form?.mode === "offer"
      ? "Offer a replacement date"
      : form?.mode === "reject"
        ? "Review this request"
        : form?.mode === "resolve"
          ? "Record an operator decision"
          : form?.reason === "teacher_missed"
            ? "Report a lesson not delivered"
            : "Request a courtesy make-up";
  return (
    <ClassGroupShell
      title={
        batchId && data?.quotas[0]?.classTitle
          ? data.quotas[0].classTitle
          : "Make-up lessons"
      }
      eyebrow={
        operator
          ? "Support review"
          : teacher
            ? "Teaching · Make-ups"
            : "My learning · Make-ups"
      }
    >
      {!data && !problem ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading make-up lessons"
        />
      ) : null}
      {problem ? (
        <ProgramFailure
          title="Please check before continuing"
          message={problem}
          onRetry={() => void load()}
        />
      ) : null}
      {notice ? (
        <ProgramNotice title={notice} tone="live" testID="makeup-success" />
      ) : null}
      {data?.truncated ? (
        <ProgramNotice
          title="Showing a limited set of records"
          body={
            data.truncationReason ??
            "Active requests appear first. Open a specific class to narrow this list; these counts are for the displayed records."
          }
        />
      ) : null}
      {formError && !modalOpen ? (
        <ProgramNotice
          title="That action was not confirmed"
          body={formError}
          tone="stopped"
        />
      ) : null}
      {data && !data.enabled ? (
        <ProgramNotice
          title={
            data.lessons.some((lesson) => lesson.case)
              ? "New make-up actions are paused"
              : "Make-ups are not available on this server yet"
          }
          body={
            data.unavailableReason ??
            "Your original lesson and refund-review options are unchanged. Contact Support if you need help."
          }
        />
      ) : null}
      {data && (data.enabled || data.lessons.some((lesson) => lesson.case)) ? (
        <>
          <ProgramNotice
            title="A replacement, not another purchase"
            tone="neutral"
            icon="repeat"
            body="Each make-up stays linked to the original lesson payment. That lesson's allocation stays on hold while a replacement or review is pending. Confirmed delivery starts a fresh 48-hour review window; it does not promise an immediate payout."
          />
          {!teacher && !operatorMode && data.quotas.length ? (
            <View style={{ gap: space.sm }}>
              {data.quotas.map((quota) => (
                <ProgramCardShell
                  key={quota.bookingId}
                  testID={`makeup-quota-${quota.bookingId}`}
                >
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>
                    {quota.classTitle} · This purchase
                  </Text>
                  <Text style={[t.title3, numeric, { color: colors.primary }]}>
                    {remedyQuotaLabel(quota)}
                  </Text>
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>
                    Pending requests reserve a place. Unaccepted requests
                    release it when closed. Accepted replacements keep their
                    place. No rollover; confirmed teacher non-delivery does not
                    use this allowance.
                  </Text>
                </ProgramCardShell>
              ))}
            </View>
          ) : null}
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}
          >
            {filters.map((item) => (
              <ProgramButton
                key={item.id}
                label={`${item.label} (${remedyVisibleLessons(candidates, item.id, originalId).length})`}
                emphasis={filter === item.id ? "primary" : "quiet"}
                onPress={() => {
                  setFilter(item.id);
                  setLimit(20);
                }}
              />
            ))}
            <ProgramButton
              label="Refresh"
              icon="refresh-cw"
              onPress={() => void load()}
              disabled={busy}
            />
          </View>
          {originalId ? (
            <ProgramButton
              label="Show all lessons in this class"
              onPress={() =>
                router.replace({
                  pathname: operator ? "/(admin)/operator-makeups" : "/makeups",
                  params: batchId ? { id: String(batchId) } : {},
                } as never)
              }
            />
          ) : null}
          {!visible.length ? (
            <ProgramNotice
              title="Nothing here right now"
              body={
                teacher || operatorMode
                  ? "Requests and assigned replacements appear here with the original lesson and student."
                  : "Eligible lessons and your requests will appear here. A used allowance does not remove the option to ask Support for a refund review."
              }
              tone="neutral"
            />
          ) : null}
          <View style={{ gap: space.md }}>
            {visible.slice(0, limit).map((lesson) => {
              const value = lesson.case;
              const offer = value?.offer;
              return (
                <ProgramCardShell
                  key={`${lesson.bookingId}-${lesson.originalPosition}`}
                  testID={`makeup-lesson-${lesson.originalSessionId}-${lesson.bookingId}`}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: space.sm,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
                      <Text
                        style={[t.bodyStrong, { color: colors.foreground }]}
                      >
                        {lesson.classTitle}
                      </Text>
                      <Text style={[t.title3, { color: colors.foreground }]}>
                        Lesson {lesson.originalPosition + 1}
                      </Text>
                      {(teacher || operatorMode) && lesson.studentName ? (
                        <Text
                          style={[t.callout, { color: colors.mutedForeground }]}
                        >
                          {lesson.studentName}
                        </Text>
                      ) : null}
                    </View>
                    {value ? (
                      <View style={{ maxWidth: "46%" }}>
                        <ProgramChip
                          label={remedyStatusLabel(value)}
                          tone={
                            value.status === "review_required"
                              ? "waiting"
                              : value.status === "resolved"
                                ? "neutral"
                                : "live"
                          }
                        />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      t.caption,
                      numeric,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Original · {format(lesson.startsAt)}
                  </Text>
                  {value ? (
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      {value.reason === "teacher_missed"
                        ? value.teacherNonDeliveryConfirmed
                          ? "Teacher non-delivery confirmed · outside courtesy allowance"
                          : "Teacher non-delivery reported · awaiting review"
                        : "Student courtesy request"}
                    </Text>
                  ) : null}
                  {value?.requestNote ? (
                    <ProgramNotice
                      title="Request details"
                      body={value.requestNote}
                      tone="neutral"
                    />
                  ) : null}
                  {value?.teacherDecisionReason ? (
                    <ProgramNotice
                      title="Teacher's reply"
                      body={value.teacherDecisionReason}
                      tone="neutral"
                    />
                  ) : null}
                  {offer ? (
                    <View
                      style={{
                        gap: space.xs,
                        padding: space.md,
                        backgroundColor: colors.actionSoft,
                        borderRadius: radius.sm,
                      }}
                    >
                      <Text style={[t.bodyStrong, { color: colors.primary }]}>
                        {offer.replacementSessionId
                          ? "Replacement lesson"
                          : "Offered replacement"}
                      </Text>
                      <Text
                        style={[
                          t.callout,
                          numeric,
                          { color: colors.foreground },
                        ]}
                      >
                        {format(offer.startsAt)}
                      </Text>
                      <Text
                        style={[t.caption, { color: colors.mutedForeground }]}
                      >
                        {Math.round(
                          (Date.parse(offer.endsAt) -
                            Date.parse(offer.startsAt)) /
                            60_000,
                        )}{" "}
                        minutes · No additional tuition
                      </Text>
                      {offer.status === "proposed" && value?.actions.accept ? (
                        <Text
                          style={[t.caption, { color: colors.mutedForeground }]}
                        >
                          Accept before {format(offer.expiresAt)}.
                        </Text>
                      ) : null}
                      {offer.replacementSessionId ? (
                        <ProgramButton
                          label="Open make-up lesson"
                          icon="arrow-right"
                          onPress={() =>
                            router.push({
                              pathname: "/session/[id]",
                              params: {
                                id: String(offer.replacementSessionId),
                              },
                            })
                          }
                        />
                      ) : null}
                    </View>
                  ) : null}
                  {value?.replacementReviewClosesAt ? (
                    <Text style={[t.caption, { color: colors.primary }]}>
                      Delivery review closes{" "}
                      {format(value.replacementReviewClosesAt)}. Report an issue
                      before this time.
                    </Text>
                  ) : null}
                  {!value && lesson.disallowedReason ? (
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      {lesson.disallowedReason}
                    </Text>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: space.xs,
                    }}
                  >
                    {!teacher && !operatorMode && lesson.canRequest ? (
                      <ProgramButton
                        label="Request make-up"
                        emphasis="primary"
                        icon="repeat"
                        disabled={busy}
                        onPress={() => openForm(lesson, "request")}
                      />
                    ) : null}
                    {!teacher &&
                    !operatorMode &&
                    lesson.canReportTeacherMissed ? (
                      <ProgramButton
                        label="Teacher missed lesson"
                        disabled={busy}
                        onPress={() =>
                          openForm(lesson, "request", "teacher_missed")
                        }
                      />
                    ) : null}
                    {value?.actions.accept ? (
                      <ProgramButton
                        label="Accept date"
                        emphasis="primary"
                        disabled={busy}
                        onPress={() => void act(lesson, "accept")}
                      />
                    ) : null}
                    {value?.actions.decline ? (
                      <ProgramButton
                        label="Decline date"
                        disabled={busy}
                        onPress={() => void act(lesson, "decline")}
                      />
                    ) : null}
                    {value?.actions.withdraw ? (
                      <ProgramButton
                        label="Withdraw request"
                        emphasis="quiet"
                        disabled={busy}
                        onPress={() => void act(lesson, "withdraw")}
                      />
                    ) : null}
                    {value?.actions.offer && teacher ? (
                      <ProgramButton
                        label="Offer a date"
                        emphasis="primary"
                        disabled={busy}
                        onPress={() => openForm(lesson, "offer")}
                      />
                    ) : null}
                    {value?.actions.reject && teacher ? (
                      <ProgramButton
                        label="Cannot offer a make-up"
                        emphasis="quiet"
                        disabled={busy}
                        onPress={() => openForm(lesson, "reject")}
                      />
                    ) : null}
                    {value?.actions.resolve && operatorMode ? (
                      <ProgramButton
                        label="Review & decide"
                        emphasis="primary"
                        disabled={busy}
                        onPress={() => openForm(lesson, "resolve")}
                      />
                    ) : null}
                    <ProgramButton
                      label="Original lesson"
                      emphasis="quiet"
                      onPress={() =>
                        router.push({
                          pathname: "/session/[id]",
                          params: { id: String(lesson.originalSessionId) },
                        })
                      }
                    />
                    {!operatorMode ? (
                      <ProgramButton
                        label={teacher ? "Ask Support" : "Refund review / help"}
                        emphasis="quiet"
                        onPress={() =>
                          router.push({
                            pathname: "/support",
                            params: {
                              sessionId: String(lesson.originalSessionId),
                              reason: "Payment",
                            },
                          })
                        }
                      />
                    ) : null}
                  </View>
                </ProgramCardShell>
              );
            })}
          </View>
          {visible.length > limit ? (
            <ProgramButton
              label={`Show more (${visible.length - limit} remaining)`}
              onPress={() => setLimit((count) => count + 20)}
            />
          ) : null}
        </>
      ) : null}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setModalOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            justifyContent: isExpanded ? "center" : "flex-end",
            paddingTop: insets.top + space.md,
            paddingHorizontal: isExpanded ? space.xl : 0,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{
              maxHeight: "94%",
              width: "100%",
              maxWidth: readingWidth,
              alignSelf: "center",
              flexGrow: 0,
              backgroundColor: colors.card,
              borderRadius: radius.lg,
            }}
            contentContainerStyle={{
              padding: space.lg,
              paddingBottom: Math.max(space.lg, insets.bottom + space.md),
              gap: space.md,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.md,
              }}
            >
              <Text
                accessibilityRole="header"
                style={[t.title2, { flex: 1, color: colors.foreground }]}
              >
                {label}
              </Text>
              <ProgramButton
                label="Close"
                icon="x"
                emphasis="quiet"
                disabled={busy}
                onPress={() => setModalOpen(false)}
              />
            </View>
            {form ? (
              <Text style={[t.callout, { color: colors.mutedForeground }]}>
                {form.lesson.classTitle} · Lesson{" "}
                {form.lesson.originalPosition + 1} ·{" "}
                {format(form.lesson.startsAt)}
              </Text>
            ) : null}
            {form?.mode === "request" ? (
              <ProgramNotice
                tone="neutral"
                title={
                  form.reason === "teacher_missed"
                    ? "Support can review non-delivery"
                    : remedyQuotaLabel(form.lesson.quota)
                }
                body={
                  form.reason === "teacher_missed"
                    ? "Reporting this does not automatically confirm that the teacher missed the lesson. The original payment stays linked for review; no automatic refund is issued."
                    : "This reserves one courtesy place while your teacher reviews it. Refund review remains available if a replacement is not suitable."
                }
              />
            ) : null}
            {form?.mode === "offer" ? (
              <>
                <ProgramNotice
                  title="Keep the original lesson linked"
                  tone="neutral"
                  body={`Same ${Math.round((Date.parse(form.lesson.endsAt) - Date.parse(form.lesson.startsAt)) / 60_000)}-minute duration. The replacement must finish by ${format(form.lesson.case!.replacementDeadlineAt)}. Conflicts are checked before a date is saved.`}
                />
                <ProgramButton
                  label={
                    date ? dates.format(batchDateValue(date)!) : "Choose date"
                  }
                  icon="calendar"
                  onPress={() => setDatePicker(true)}
                  disabled={busy}
                />
                <Text style={[t.caption, { color: colors.mutedForeground }]}>
                  Start time · Nepal time (24-hour)
                </Text>
                {Platform.OS === "web" ? (
                  <TextInput
                    accessibilityLabel="Replacement Nepal start time"
                    value={time}
                    onChangeText={setTime}
                    maxLength={5}
                    placeholder="09:00"
                    inputMode="text"
                    editable={!busy}
                    style={[
                      t.body,
                      {
                        minHeight: 48,
                        padding: space.sm,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        color: colors.foreground,
                        backgroundColor: colors.background,
                      },
                    ]}
                  />
                ) : (
                  <ProgramButton
                    label={time}
                    icon="clock"
                    onPress={() => setTimePicker(true)}
                    disabled={busy}
                  />
                )}
                {form.lesson.case?.reason === "teacher_missed" &&
                !form.lesson.case.teacherNonDeliveryConfirmed ? (
                  <ProgramButton
                    label={
                      confirmedTeacherMissed
                        ? "Confirmed: I did not deliver the original lesson"
                        : "Confirm I did not deliver the original lesson"
                    }
                    emphasis={confirmedTeacherMissed ? "primary" : "secondary"}
                    onPress={() => setConfirmedTeacherMissed((value) => !value)}
                    disabled={busy}
                  />
                ) : null}
              </>
            ) : (
              <>
                {form?.mode === "resolve" ? (
                  <>
                    <ProgramNotice
                      title="Human review, not an automatic payout or refund"
                      body="Check the original booking, disputes and replacement evidence. Confirm delivery only after reviewing what was actually taught. A connection or completed status alone is not sufficient."
                    />
                    <View style={{ gap: space.xs }}>
                      {outcomes.map((item) => (
                        <ProgramButton
                          key={item.value}
                          label={item.label}
                          emphasis={
                            outcome === item.value ? "primary" : "quiet"
                          }
                          onPress={() => {
                            setOutcome(item.value);
                            setDeliveryChecked(false);
                          }}
                          disabled={busy}
                        />
                      ))}
                    </View>
                    {outcome === "replacement_delivered" ? (
                      <ProgramButton
                        label={
                          deliveryChecked
                            ? "Delivery evidence reviewed and confirmed"
                            : "Confirm I reviewed delivery evidence"
                        }
                        emphasis={deliveryChecked ? "primary" : "secondary"}
                        onPress={() => setDeliveryChecked((value) => !value)}
                        disabled={busy}
                      />
                    ) : null}
                    {outcome === "refund_approved" ? (
                      <>
                        <ProgramNotice
                          title="Approval is not a transfer"
                          body="This records a refund owed for the original lesson amount. Practice enrollments remain simulated; no real funds are returned by this button."
                        />
                        <ProgramButton
                          label={
                            deliveryChecked
                              ? "Original amount and refund evidence checked"
                              : "Confirm I checked the original refund amount and evidence"
                          }
                          emphasis={deliveryChecked ? "primary" : "secondary"}
                          onPress={() => setDeliveryChecked((value) => !value)}
                          disabled={busy}
                        />
                      </>
                    ) : null}
                    {outcome !== "replacement_delivered" &&
                    outcome !== "refund_approved" ? (
                      <>
                        {outcome === "refund_denied" ? (
                          <ProgramNotice
                            title="A separate Support decision is required"
                            body="Use this only after Support has denied the refund dispute. This preserves the previous replacement review deadline; it does not decide the dispute or create a new review window."
                          />
                        ) : null}
                        <ProgramButton
                          label={
                            deliveryChecked
                              ? "Evidence and decision reviewed and confirmed"
                              : "Confirm I reviewed evidence for this decision"
                          }
                          emphasis={deliveryChecked ? "primary" : "secondary"}
                          onPress={() => setDeliveryChecked((value) => !value)}
                          disabled={busy}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                  {form?.mode === "resolve"
                    ? "Evidence and decision note (private to Support)"
                    : form?.mode === "reject"
                      ? "Why can you not offer a replacement?"
                      : "Tell us what happened"}
                </Text>
                <TextInput
                  accessibilityLabel={
                    form?.mode === "resolve"
                      ? "Private review evidence"
                      : "Make-up request details"
                  }
                  multiline
                  maxLength={1500}
                  value={note}
                  onChangeText={setNote}
                  editable={!busy}
                  placeholder="Add the details needed to review this lesson. Do not include ID documents or passwords."
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    t.body,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.background,
                      minHeight: 120,
                      padding: space.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      textAlignVertical: "top",
                    },
                  ]}
                />
              </>
            )}
            {formError ? (
              <Text
                accessibilityRole="alert"
                style={[t.callout, { color: colors.destructive }]}
              >
                {formError}
              </Text>
            ) : null}
            <ProgramButton
              label={
                form?.mode === "offer"
                  ? "Offer this date"
                  : form?.mode === "resolve"
                    ? "Record decision"
                    : form?.mode === "reject"
                      ? "Save decision"
                      : "Send request"
              }
              emphasis="primary"
              busy={busy}
              onPress={submit}
            />
            <ProgramButton
              label="Cancel"
              emphasis="quiet"
              disabled={busy}
              onPress={() => setModalOpen(false)}
            />
          </ScrollView>
        </View>
      </Modal>
      <NepaliDatePicker
        visible={datePicker}
        value={batchDateValue(date)}
        title="Choose a replacement date"
        minDate={
          data
            ? batchDateValue(
                lessonDraft({ startsAt: data.serverNow, durationMinutes: 60 })
                  .date,
              )
            : null
        }
        maxDate={
          form?.lesson.case
            ? batchDateValue(
                lessonDraft({
                  startsAt: form.lesson.case.replacementDeadlineAt,
                  durationMinutes: 60,
                }).date,
              )
            : null
        }
        onCancel={() => setDatePicker(false)}
        onPick={(picked) => {
          const pad = (n: number) => String(n).padStart(2, "0");
          setDate(
            `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`,
          );
          setDatePicker(false);
        }}
      />
      <NativeTimePicker
        visible={timePicker}
        value={time}
        onCancel={() => setTimePicker(false)}
        onPick={(value) => {
          setTime(value);
          setTimePicker(false);
        }}
      />
    </ClassGroupShell>
  );
}
