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

import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost, ApiError } from "@/utils/api";
import {
  type MonthlyClass,
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

      {missed && missed.missed.length > 0 && (
        <MissedList missed={missed} classId={klass.id} formatBoth={formatBoth} onChanged={onChanged} />
      )}

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
  classId,
  formatBoth,
  onChanged,
}: {
  missed: MissedClassesView;
  classId: number;
  formatBoth: (v: string | number | Date) => string;
  onChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const arrange = async (dayId: number) => {
    setProblem(null);
    setBusy(dayId);
    try {
      // Three days out, at the class's usual time, which is the commonest thing a teacher wants
      // and saves them a date picker on a phone. Moving it is a later job.
      const at = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      await apiPost(`/monthly/classes/${classId}/makeups`, { missedDayId: dayId, at: at.toISOString() });
      await onChanged();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not arrange that make-up.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Classes you missed</Text>
      <Text style={[styles.fieldHint, { color: colors.mutedForeground, marginBottom: 10 }]}>
        Arrange a make-up within 48 hours and it does not count against you. You have{" "}
        {missed.makeups.left} of {missed.makeups.allowed} make-ups left this month.
      </Text>

      {problem && <Text style={[styles.noticeText, { color: colors.destructive, marginBottom: 8 }]}>{problem}</Text>}

      {missed.missed.map((row) => (
        <View key={row.id} style={[styles.missedRow, { borderTopColor: colors.border }]}>
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
          {!row.madeUpAt && missed.makeups.left > 0 && (
            <TouchableOpacity
              testID={`monthly-makeup-${row.id}`}
              onPress={() => void arrange(row.id)}
              disabled={busy === row.id}
              style={[styles.smallBtn, { borderColor: colors.primary }]}
              activeOpacity={0.8}
            >
              {busy === row.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.smallBtnText, { color: colors.primary }]}>Make up</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      ))}
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
