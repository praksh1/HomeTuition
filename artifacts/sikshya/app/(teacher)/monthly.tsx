import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import NepaliDatePicker from "@/components/NepaliDatePicker";
import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { apiDelete, apiGet, apiPost, ApiError } from "@/utils/api";
import {
  type MonthlyClass,
  type MonthlyCycle,
  type MonthlyPlanView,
  type MissedClassesView,
  formatStartMinute,
  parseStartMinute,
} from "@/utils/monthly";

/**
 * The teacher's monthly class, from buying the plan to seeing where they stand.
 *
 * One screen with three states rather than three screens, because they are three moments in
 * one thing and a teacher should never have to find the right one: no plan yet, a plan with no
 * class, and a class that is running.
 */
/**
 * What the button should say about today's class.
 *
 * "Start today's class" only once the doors are actually open — ten minutes before, the same
 * window the rest of the app uses. Before that it says when instead, because a button that
 * promises a room and then refuses is worse than one that tells you to come back.
 */
function todayLabel(
  startsAt: string,
  formatBoth: (v: string | number | Date, o?: { withTime?: boolean }) => string,
): string {
  const starts = new Date(startsAt).getTime();
  const now = Date.now();
  if (now >= starts - 10 * 60 * 1000) return "Start today's class";
  const when = formatBoth(startsAt, { withTime: true });
  const sameDay = new Date(starts).toDateString() === new Date(now).toDateString();
  return sameDay ? `Today's class — ${when.split(", ").pop()}` : `Next class — ${when}`;
}

export default function MonthlyClassScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { formatBoth } = useDates();

  const [view, setView] = useState<MonthlyPlanView | null>(null);
  const [missed, setMissed] = useState<MissedClassesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const load = useCallback(async () => {
    try {
      const plan = await apiGet<MonthlyPlanView>("/monthly/plan");
      setView(plan);
      setError(null);
      if (plan.class?.id) {
        try {
          setMissed(await apiGet<MissedClassesView>(`/monthly/classes/${plan.class.id}/missed`));
        } catch {
          // The missed list is extra detail; the page is still worth showing without it.
          setMissed(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your monthly class.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async (method: PaymentMethod) => {
    await apiPost("/monthly/plan", { paymentMethod: method });
    setBuying(false);
    setLoading(true);
    await load();
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Monthly class</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}

        {view?.plan?.status === "suspended" && (
          <SuspensionNotice reason={view.plan.suspendedReason} until={view.plan.suspendedUntil} formatBoth={formatBoth} />
        )}

        {!view?.plan && <NoPlanYet tierPrice={view?.tierPrice ?? 6500} onBuy={() => setBuying(true)} />}

        {view?.plan && !view.class && <CreateClass onCreated={load} />}

        {view?.plan && view.class && (
          <RunningClass
            view={view}
            klass={view.class}
            missed={missed}
            formatBoth={formatBoth}
            onChanged={load}
          />
        )}
      </ScrollView>

      <PaymentSheet
        visible={buying}
        amount={view?.tierPrice ?? 6500}
        label="Monthly teaching plan"
        onClose={() => setBuying(false)}
        onSuccess={buy}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ states */

function SuspensionNotice({
  reason,
  until,
  formatBoth,
}: {
  reason: string | null;
  until: string | null;
  formatBoth: (v: string | number | Date) => string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.suspend, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}>
      <Feather name="alert-octagon" size={22} color={colors.destructive} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.suspendTitle, { color: colors.destructive }]}>Your class is suspended</Text>
        <Text style={[styles.suspendBody, { color: colors.foreground }]}>
          {reason ?? "Your monthly class has been suspended."}
        </Text>
        {until && (
          <Text style={[styles.suspendBody, { color: colors.mutedForeground, marginTop: 6 }]}>
            You can teach again from {formatBoth(until)}.
          </Text>
        )}
      </View>
    </View>
  );
}

function NoPlanYet({ tierPrice, onBuy }: { tierPrice: number; onBuy: () => void }) {
  const colors = useColors();
  const points = [
    "One class, at the same time every day",
    "Up to 45 students in it",
    "Up to 90 minutes a day",
    "Your own group chat and homework portal",
    "Students pay you monthly, and pay less if they join part-way through",
  ];
  return (
    <View>
      <Text style={[styles.h1, { color: colors.foreground }]}>Teach the same class every day</Text>
      <Text style={[styles.lede, { color: colors.mutedForeground }]}>
        A monthly class runs daily at a time you choose. Students buy the month, not one lesson
        at a time.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.price, { color: colors.foreground }]}>NPR {tierPrice.toLocaleString()}</Text>
        <Text style={[styles.priceHint, { color: colors.mutedForeground }]}>a month, paid to Sikshya</Text>
        <View style={{ height: 14 }} />
        {points.map((point) => (
          <View key={point} style={styles.point}>
            <Feather name="check" size={16} color={colors.primary} />
            <Text style={[styles.pointText, { color: colors.foreground }]}>{point}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.notice, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}>
        <Feather name="info" size={16} color={colors.accent} />
        <Text style={[styles.noticeText, { color: colors.foreground }]}>
          Your month starts when you set up your class, not when you pay. You must teach at
          least 25 classes a month, or your students get part of their money back.
        </Text>
      </View>

      <TouchableOpacity
        testID="monthly-buy"
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onBuy();
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.primaryBtnText}>Get the monthly plan</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ----------------------------------------------------------- create a class */

function CreateClass({ onCreated }: { onCreated: () => Promise<void> }) {
  const colors = useColors();
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [time, setTime] = useState("16:00");
  const [duration, setDuration] = useState("60");
  const [fee, setFee] = useState("");
  const [seats, setSeats] = useState("45");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    const startMinute = parseStartMinute(time);
    if (startMinute === null) {
      setProblem("Write the time as HH:MM, like 16:00.");
      return;
    }
    const minutes = Number(duration);
    const price = Number(fee);
    const maxStudents = Number(seats);
    if (!subject.trim() || !topic.trim()) {
      setProblem("Your class needs a subject and a topic.");
      return;
    }
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 90) {
      setProblem("A class can run from 1 to 90 minutes.");
      return;
    }
    if (!Number.isInteger(price) || price < 0) {
      setProblem("The monthly fee must be a whole number of rupees.");
      return;
    }

    setSaving(true);
    try {
      await apiPost("/monthly/classes", {
        subject: subject.trim(),
        topic: topic.trim(),
        startMinute,
        durationMinutes: minutes,
        monthlyPrice: price,
        maxStudents,
      });
      await onCreated();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not create the class. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <Text style={[styles.h1, { color: colors.foreground }]}>Set up your class</Text>
      <Text style={[styles.lede, { color: colors.mutedForeground }]}>
        Your month starts the moment you finish this, so the first class can be today.
      </Text>

      <Field label="Subject" value={subject} onChange={setSubject} placeholder="Maths" testID="monthly-subject" />
      <Field label="What you are teaching" value={topic} onChange={setTopic} placeholder="Algebra for Grade 10" testID="monthly-topic" />
      <Field
        label="Time every day"
        value={time}
        onChange={setTime}
        placeholder="16:00"
        hint="Nepal time, on a 24-hour clock. 16:00 is 4 in the afternoon."
        testID="monthly-time"
      />
      <Field label="Minutes per class" value={duration} onChange={setDuration} keyboardType="number-pad" hint="90 at most." testID="monthly-duration" />
      <Field
        label="What a student pays each month (NPR)"
        value={fee}
        onChange={setFee}
        keyboardType="number-pad"
        placeholder="3000"
        hint="Somebody joining part-way through pays less, worked out from the classes left."
        testID="monthly-fee"
      />
      <Field label="Most students at once" value={seats} onChange={setSeats} keyboardType="number-pad" hint="45 at most." testID="monthly-seats" />

      {problem && (
        <View style={[styles.notice, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text style={[styles.noticeText, { color: colors.destructive }]}>{problem}</Text>
        </View>
      )}

      <TouchableOpacity
        testID="monthly-create"
        style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
        onPress={() => void submit()}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Start my monthly class</Text>}
      </TouchableOpacity>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  keyboardType,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  keyboardType?: "default" | "number-pad";
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
      />
      {hint && <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{hint}</Text>}
    </View>
  );
}

/* --------------------------------------------------------- a running class */

function RunningClass({
  view,
  klass,
  missed,
  formatBoth,
  onChanged,
}: {
  view: MonthlyPlanView;
  klass: MonthlyClass;
  missed: MissedClassesView | null;
  formatBoth: (v: string | number | Date) => string;
  onChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const standing = view.standing;
  const held = view.ledger?.held ?? 0;

  return (
    <View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.classSubject, { color: colors.foreground }]}>{klass.subject}</Text>
        <Text style={[styles.classTopic, { color: colors.mutedForeground }]}>{klass.topic}</Text>

        <View style={styles.statRow}>
          <Stat label="Every day at" value={formatStartMinute(klass.startMinute)} />
          <Stat label="For" value={`${klass.durationMinutes} min`} />
          <Stat label="Students" value={`${klass.enrolled}/${klass.maxStudents}`} />
        </View>
        <View style={styles.statRow}>
          <Stat label="Classes held" value={`${held} of ${klass.sessionsPlanned}`} />
          <Stat label="Still to come" value={String(klass.sessionsRemaining)} />
          <Stat label="A month costs" value={`NPR ${klass.monthlyPrice}`} />
        </View>

        {view.cycle && (
          <Text style={[styles.cycleLine, { color: colors.mutedForeground }]}>
            This month runs to {formatBoth(view.cycle.endsAt)}
          </Text>
        )}
      </View>

      {/*
        Today's class, one tap from here.

        The owner, on the live site: *"The daily class link still does not show up here!"* It
        was on their Sessions tab and on the student's monthly screen, and missing from the one
        screen that is about this class — which is where a teacher goes to look at it.

        Shown all day rather than only when the room opens, and saying when: a teacher checking
        at breakfast wants to know the class is there. A button that appears ten minutes
        beforehand reads as the app having forgotten about it.
      */}
      {klass.today?.sessionId ? (
        <TouchableOpacity
          testID={`teacher-monthly-today-${klass.id}`}
          activeOpacity={0.85}
          onPress={() => router.push(`/session/${klass.today!.sessionId}`)}
          style={[styles.todayBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name="video" size={16} color="#fff" />
          <Text style={styles.todayBtnText}>{todayLabel(klass.today.startsAt, formatBoth)}</Text>
        </TouchableOpacity>
      ) : null}

      {/*
        The floor, shown as a count rather than a rule.
        "You must teach 25" means nothing at a glance; "5 more to go" is a number a teacher can
        act on, and it is the same number their students' refunds hang off.
      */}
      <DeliveryBar held={held} planned={klass.sessionsPlanned} />

      {standing && standing.abuses > 0 && (
        <View
          style={[
            styles.notice,
            standing.warn || standing.suspended
              ? { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }
              : { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" },
          ]}
        >
          <Feather
            name={standing.warn || standing.suspended ? "alert-triangle" : "info"}
            size={16}
            color={standing.warn || standing.suspended ? colors.destructive : colors.accent}
          />
          <Text style={[styles.noticeText, { color: colors.foreground }]}>
            {standing.suspended
              ? "Your class is suspended."
              : `${standing.abuses} ${standing.abuses === 1 ? "class was" : "classes were"} missed with no make-up arranged. ` +
                `${standing.remaining} more and your class is suspended for 30 days.`}
          </Text>
        </View>
      )}

      {missed && missed.missed.length > 0 && view.cycle && (
        <MissedList
          missed={missed}
          klass={klass}
          cycle={view.cycle}
          formatBoth={formatBoth}
          onChanged={onChanged}
        />
      )}

      {/*
        Days you will not be here.

        The owner: *"I thought you added a feature where a teacher could schedule a make up in
        advance?"* The rule behind it went in and the screen did not, so from the app there was
        no such feature at all. This is that screen.
      */}
      <LeaveList formatBoth={formatBoth} />

      <View style={styles.linkRow}>
        <LinkTile
          icon="message-circle"
          label="Class chat"
          onPress={() => router.push({ pathname: "/monthly-chat", params: { id: String(klass.id) } })}
          testID="monthly-open-chat"
        />
        <LinkTile
          icon="book-open"
          label="Homework"
          onPress={() => router.push({ pathname: "/monthly-homework", params: { id: String(klass.id) } })}
          testID="monthly-open-homework"
        />
      </View>
    </View>
  );
}

function DeliveryBar({ held, planned }: { held: number; planned: number }) {
  const colors = useColors();
  const floor = 25;
  const short = Math.max(0, floor - held);
  const pct = Math.min(1, held / floor);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {short === 0 ? "You have taught enough classes this month" : `${short} more ${short === 1 ? "class" : "classes"} to go`}
      </Text>
      <View style={[styles.barTrack, { backgroundColor: colors.input }]}>
        <View
          style={[
            styles.barFill,
            { width: `${pct * 100}%`, backgroundColor: short === 0 ? colors.primary : colors.accent },
          ]}
        />
      </View>
      <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
        {short === 0
          ? `${held} held, out of ${planned} planned. Nothing is owed back to your students.`
          : `Teach at least ${floor} classes a month. Below that, your students get part of their money back.`}
      </Text>
    </View>
  );
}

function MissedList({
  missed,
  klass,
  cycle,
  formatBoth,
  onChanged,
}: {
  missed: MissedClassesView;
  klass: MonthlyClass;
  cycle: MonthlyCycle;
  formatBoth: (v: string | number | Date, o?: { withTime?: boolean }) => string;
  onChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Classes you missed</Text>
      <Text style={[styles.fieldHint, { color: colors.mutedForeground, marginBottom: 10 }]}>
        Arrange a make-up within 48 hours and it does not count against you. You have{" "}
        {missed.makeups.left} of {missed.makeups.allowed} make-ups left this month.
      </Text>

      {missed.missed.map((row) => (
        <View key={row.id}>
          <View style={[styles.missedRow, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.missedWhen, { color: colors.foreground }]}>{formatBoth(row.wasAt)}</Text>
              <Text
                style={[
                  styles.fieldHint,
                  { color: row.countsAgainstYou ? colors.destructive : colors.mutedForeground },
                ]}
              >
                {row.madeUpAt
                  ? `Make-up on ${formatBoth(row.madeUpAt)}`
                  : row.countsAgainstYou
                    ? "This counts against you"
                    : `${row.hoursLeft} hours left to arrange a make-up`}
              </Text>
            </View>
            {!row.madeUpAt && missed.makeups.left > 0 && editing !== row.id && (
              <TouchableOpacity
                testID={`monthly-makeup-${row.id}`}
                onPress={() => setEditing(row.id)}
                style={[styles.smallBtn, { borderColor: colors.primary }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.smallBtnText, { color: colors.primary }]}>Schedule</Text>
              </TouchableOpacity>
            )}
          </View>
          {editing === row.id && (
            <MakeupScheduler
              missedDayId={row.id}
              klass={klass}
              cycle={cycle}
              formatBoth={formatBoth}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await onChanged();
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
}

/** A Gregorian day-shaped Date for the class's time zone, independent of the device's zone. */
function calendarDateInZone(value: string | number | Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(read("year"), read("month") - 1, read("day"));
}

function clockInZone(value: string | number | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("hour") === "24" ? "00" : read("hour")}:${read("minute")}`;
}

function gregorianDayKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function MakeupScheduler({
  missedDayId,
  klass,
  cycle,
  formatBoth,
  onCancel,
  onSaved,
}: {
  missedDayId: number;
  klass: MonthlyClass;
  cycle: MonthlyCycle;
  formatBoth: (v: string | number | Date, o?: { withTime?: boolean }) => string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const colors = useColors();
  const { t, numeric, space, radius } = useLayout();
  const lastInstant = new Date(cycle.endsAt).getTime() - 1;
  const initialInstant = Math.min(Date.now() + 24 * 60 * 60 * 1000, lastInstant);
  const [date, setDate] = useState(() => calendarDateInZone(initialInstant, klass.timeZone));
  const [time, setTime] = useState(() =>
    formatStartMinute((klass.startMinute + klass.durationMinutes) % (24 * 60)),
  );
  const [pickingDate, setPickingDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    const startMinute = parseStartMinute(time);
    if (startMinute === null) {
      setProblem("Write the time as HH:MM, like 17:30.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await apiPost(`/monthly/classes/${klass.id}/makeups`, {
        missedDayId,
        localDate: gregorianDayKey(date),
        startMinute,
      });
      await onSaved();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not arrange that make-up.");
    } finally {
      setBusy(false);
    }
  };

  const today = calendarDateInZone(Date.now(), klass.timeZone);
  const lastDay = calendarDateInZone(lastInstant, klass.timeZone);
  const cycleEndDay = calendarDateInZone(cycle.endsAt, klass.timeZone);
  const cycleEndTime = clockInZone(cycle.endsAt, klass.timeZone);

  return (
    <View
      testID={`monthly-makeup-editor-${missedDayId}`}
      style={{
        gap: space.sm,
        padding: space.sm,
        marginTop: space.xs,
        borderRadius: radius.sm,
        backgroundColor: colors.muted,
      }}
    >
      <View style={{ gap: space.xxs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Choose the replacement class</Text>
        <Text style={[t.callout, numeric, { color: colors.mutedForeground }]}>
          Any future day and time is allowed before this cycle ends on {formatBoth(cycleEndDay)} at {cycleEndTime} Nepal time.
        </Text>
      </View>

      <View style={{ gap: space.xs }}>
        <Text style={[t.caption, { color: colors.foreground }]}>Date</Text>
        <TouchableOpacity
          testID={`monthly-makeup-date-${missedDayId}`}
          onPress={() => setPickingDate(true)}
          activeOpacity={0.8}
          style={{
            minHeight: HIT_SLOP_MIN,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.sm,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.sm,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Feather name="calendar" size={20} color={colors.primary} />
          <Text style={[t.body, { color: colors.foreground }]}>{formatBoth(date)}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ gap: space.xs }}>
        <Text style={[t.caption, { color: colors.foreground }]}>Time</Text>
        <TextInput
          testID={`monthly-makeup-time-${missedDayId}`}
          value={time}
          onChangeText={setTime}
          placeholder="17:30"
          placeholderTextColor={colors.mutedForeground}
          style={[
            t.body,
            numeric,
            {
              minHeight: HIT_SLOP_MIN,
              paddingHorizontal: space.sm,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: radius.sm,
              borderColor: colors.border,
              color: colors.foreground,
              backgroundColor: colors.card,
            },
          ]}
        />
        <Text style={[t.caption, { color: colors.mutedForeground }]}>
          Use a 24-hour Nepal-time clock. Pick a slot that does not overlap the daily class at {formatStartMinute(klass.startMinute)}.
        </Text>
      </View>

      {problem && <Text style={[t.callout, { color: colors.destructive }]}>{problem}</Text>}

      <View style={{ flexDirection: "row", gap: space.xs }}>
        <TouchableOpacity
          onPress={onCancel}
          disabled={busy}
          activeOpacity={0.8}
          style={{
            minHeight: HIT_SLOP_MIN,
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.sm,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`monthly-makeup-save-${missedDayId}`}
          onPress={() => void save()}
          disabled={busy}
          activeOpacity={0.85}
          style={{
            minHeight: HIT_SLOP_MIN,
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.sm,
            backgroundColor: colors.primary,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onInverse} />
          ) : (
            <Text style={[t.bodyStrong, { color: colors.onInverse }]}>Schedule makeup</Text>
          )}
        </TouchableOpacity>
      </View>

      <NepaliDatePicker
        visible={pickingDate}
        value={date}
        minDate={today}
        maxDate={lastDay}
        title="Pick the makeup date"
        onCancel={() => setPickingDate(false)}
        onPick={(picked) => {
          setDate(picked);
          setPickingDate(false);
        }}
      />
    </View>
  );
}

interface LeaveRow {
  id: number;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

/**
 * Telling the app you will be away.
 *
 * ### What this is not
 *
 * It is **not** a way to cancel classes, and it deliberately does not pretend to be. The price,
 * the 25-class delivery floor and the suspension count all assume the class runs every day, and
 * changing that is a bigger question the owner has parked — see
 * `.agents/backlog/monthly-partial-months-and-dropping.md`. So the panel says plainly how many
 * classes fall inside the dates and that they are still owed, rather than letting somebody book
 * a fortnight away and discover the consequences at the end of the month.
 *
 * What it does buy is the thing that was actually broken: a make-up can no longer be scheduled
 * onto a day the teacher already knows they will miss — one absence quietly becoming two.
 */
function LeaveList({ formatBoth }: { formatBoth: (v: string | number | Date) => string }) {
  const colors = useColors();
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ leave: LeaveRow[] }>("/monthly/leave");
      setRows(data.leave);
    } catch {
      // The rest of the screen is worth showing without this.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!from || !to || busy) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    try {
      const res = await apiPost<{ note: string }>("/monthly/leave", {
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
        reason: reason.trim() || undefined,
      });
      // The server counts the classes inside and says what is still owed. Shown as it came
      // back rather than reworded here, so one sentence about the rule lives in one place.
      setNote(res.note);
      setFrom(null); setTo(null); setReason(""); setOpen(false);
      await load();
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await apiDelete(`/monthly/leave/${id}`);
      await load();
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "Could not remove that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Days you will be away</Text>
      <Text style={[styles.fieldHint, { color: colors.mutedForeground, marginBottom: 10 }]}>
        Tell us in advance and no make-up will be scheduled onto a day you are not here. Your
        classes on those days are still yours to hold.
      </Text>

      {problem && <Text style={[styles.noticeText, { color: colors.destructive, marginBottom: 8 }]}>{problem}</Text>}
      {note && <Text style={[styles.fieldHint, { color: colors.foreground, marginBottom: 8 }]}>{note}</Text>}

      {rows.map((row) => (
        <View key={row.id} style={[styles.missedRow, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.missedWhen, { color: colors.foreground }]}>
              {formatBoth(row.startsAt)}
              {row.endsAt.slice(0, 10) !== row.startsAt.slice(0, 10) ? ` — ${formatBoth(row.endsAt)}` : ""}
            </Text>
            {!!row.reason && (
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{row.reason}</Text>
            )}
          </View>
          <TouchableOpacity
            testID={`leave-remove-${row.id}`}
            onPress={() => void remove(row.id)}
            disabled={busy}
            style={[styles.smallBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.smallBtnText, { color: colors.mutedForeground }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      {!open ? (
        <TouchableOpacity
          testID="leave-add"
          onPress={() => setOpen(true)}
          style={[styles.smallBtn, { borderColor: colors.primary, alignSelf: "flex-start", marginTop: 10 }]}
          activeOpacity={0.8}
        >
          <Text style={[styles.smallBtnText, { color: colors.primary }]}>Add days away</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ marginTop: 10, gap: 8 }}>
          <TouchableOpacity
            testID="leave-from"
            onPress={() => setPicking("from")}
            style={[styles.pickField, { borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Feather name="calendar" size={14} color={colors.mutedForeground} />
            <Text style={[styles.pickFieldText, { color: from ? colors.foreground : colors.mutedForeground }]}>
              {from ? formatBoth(from) : "First day away"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="leave-to"
            onPress={() => setPicking("to")}
            style={[styles.pickField, { borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Feather name="calendar" size={14} color={colors.mutedForeground} />
            <Text style={[styles.pickFieldText, { color: to ? colors.foreground : colors.mutedForeground }]}>
              {to ? formatBoth(to) : "Last day away"}
            </Text>
          </TouchableOpacity>
          <TextInput
            testID="leave-reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Why? (optional — shown back to you)"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.pickField, { borderColor: colors.border, color: colors.foreground }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              testID="leave-save"
              onPress={() => void save()}
              disabled={!from || !to || busy}
              style={[styles.smallBtn, { borderColor: colors.primary, opacity: !from || !to ? 0.5 : 1 }]}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.smallBtnText, { color: colors.primary }]}>Save</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setOpen(false); setFrom(null); setTo(null); setReason(""); setProblem(null); }}
              style={[styles.smallBtn, { borderColor: colors.border }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.smallBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <NepaliDatePicker
        visible={picking !== null}
        value={picking === "from" ? from : to}
        minDate={picking === "to" ? (from ?? new Date()) : new Date()}
        title={picking === "from" ? "First day away" : "Last day away"}
        onCancel={() => setPicking(null)}
        onPick={(d) => {
          if (picking === "from") {
            setFrom(d);
            // A one-day trip is the common case, so the second date starts filled in rather
            // than making somebody pick the same day twice.
            if (!to || to.getTime() < d.getTime()) setTo(d);
          } else {
            setTo(d);
          }
          setPicking(null);
        }}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function LinkTile({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.85}
    >
      <Feather name={icon} size={22} color={colors.primary} />
      <Text style={[styles.tileText, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  scroll: { padding: 16 },
  h1: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 6 },
  lede: { fontSize: 14.5, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 16 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 14 },
  price: { fontSize: 30, fontFamily: "Inter_700Bold" },
  priceHint: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  point: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  pointText: { flex: 1, fontSize: 14.5, fontFamily: "Inter_400Regular", lineHeight: 20 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  noticeText: { flex: 1, fontSize: 13.5, fontFamily: "Inter_400Regular", lineHeight: 19 },
  suspend: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 2,
    marginBottom: 16,
  },
  suspendTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 4 },
  suspendBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  primaryBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 14.5, fontFamily: "Inter_500Medium", marginBottom: 6 },
  fieldHint: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 5, lineHeight: 17 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    fontSize: 15.5,
    fontFamily: "Inter_400Regular",
  },
  classSubject: { fontSize: 20, fontFamily: "Inter_700Bold" },
  classTopic: { fontSize: 14.5, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 14 },
  statRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  stat: { flex: 1 },
  statValue: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  cycleLine: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  barTrack: { height: 10, borderRadius: 5, overflow: "hidden", marginTop: 10, marginBottom: 8 },
  barFill: { height: 10, borderRadius: 5 },
  todayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, marginBottom: 12 },
  todayBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },
  pickField: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  pickFieldText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  missedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  missedWhen: { fontSize: 14.5, fontFamily: "Inter_500Medium" },
  smallBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  smallBtnText: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  linkRow: { flexDirection: "row", gap: 12 },
  tile: {
    flex: 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 22,
    alignItems: "center",
    gap: 10,
  },
  tileText: { fontSize: 14.5, fontFamily: "Inter_500Medium" },
});
