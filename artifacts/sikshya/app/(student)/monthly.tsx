import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN, radius as layoutRadius, space as layoutSpace } from "@/constants/layout";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost, ApiError } from "@/utils/api";
import { formatStartMinute, money, paidAndGuaranteed, type MonthlyClass } from "@/utils/monthly";
import { studentMonthlyEmptyCopy } from "@/utils/monthlyJourneyState";

/**
 * Monthly classes, from a student's side.
 *
 * The thing this screen has to get right is the price. A student joining on day twenty pays for
 * ten classes, not for a month, and if the number they are shown is not the number they are
 * charged then nothing else about the tier matters. So the price shown here is the one the
 * server quoted — the app never works one out.
 */
/**
 * What the button should say about today's class.
 *
 * "Join today's class" only once the doors are actually open, because a button that promises a
 * room and then refuses is worse than one that tells you when to come back. Ten minutes is the
 * same window the rest of the app uses — see utils/sessionWindow.ts.
 */
function todayLabel(startsAt: string, dates: { format: (v: string, o?: { withTime?: boolean }) => string }): string {
  const starts = new Date(startsAt).getTime();
  const now = Date.now();
  const doorsOpen = starts - 10 * 60 * 1000;
  if (now >= doorsOpen) return "Join today's class";
  const sameDay = new Date(starts).toDateString() === new Date(now).toDateString();
  if (sameDay) return `Today's class — ${dates.format(startsAt, { withTime: true }).split(", ").pop()}`;
  return `Next class — ${dates.format(startsAt, { withTime: true })}`;
}

export default function StudentMonthlyScreen() {
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const { formatBoth } = useDates();

  const [classes, setClasses] = useState<MonthlyClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<MonthlyClass | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await apiGet<{ classes: MonthlyClass[] }>("/monthly/classes");
      setClasses(found.classes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load monthly classes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async (klass: MonthlyClass, method: PaymentMethod) => {
    setProblem(null);
    try {
      await apiPost(`/monthly/classes/${klass.id}/join`, { paymentMethod: method });
      setJoining(null);
      await load();
    } catch (e) {
      // Thrown on, so the sheet stays open and says why rather than claiming success.
      setProblem(e instanceof ApiError ? e.message : "Could not join that class.");
      throw e;
    }
  };

  const mine = classes.filter((c) => c.enrolment);
  const others = classes.filter((c) => !c.enrolment);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + space.md, paddingHorizontal: gutter, borderBottomColor: colors.border }]}>
        <Text style={[t.title1, { color: colors.foreground }]}>Monthly classes</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: gutter, paddingBottom: insets.bottom + space.huge }]}
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
          <View style={[styles.notice, { backgroundColor: colors.destructiveSoft, borderColor: colors.destructive, borderRadius: radius.md }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <View style={styles.noticeCopy}>
              <Text style={[t.bodyStrong, { color: colors.destructive }]}>Monthly classes did not load</Text>
              <Text style={[t.callout, { color: colors.foreground }]}>{error}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading monthly classes again" onPress={() => void load()} style={styles.retryBtn}>
                <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {problem && (
          <View style={[styles.notice, { backgroundColor: colors.destructiveSoft, borderColor: colors.destructive, borderRadius: radius.md }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[t.callout, styles.noticeText, { color: colors.destructive }]}>{problem}</Text>
          </View>
        )}

        {!error && mine.length > 0 && (
          <>
            <Text style={[t.bodyStrong, styles.sectionTitle, { color: colors.foreground }]}>Your monthly class</Text>
            {mine.map((klass) => (
              <ClassCard key={klass.id} klass={klass} formatBoth={formatBoth} onJoin={() => setJoining(klass)} />
            ))}
          </>
        )}

        {!error && <Text style={[t.bodyStrong, styles.sectionTitle, { color: colors.foreground }]}>
          {mine.length > 0 ? "Other monthly classes" : "Classes you can join"}
        </Text>}

        {!error && others.length === 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md }]}>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>
              {studentMonthlyEmptyCopy(mine.length > 0)} A monthly class runs every day at the same
              time, and you pay once per monthly cycle.
            </Text>
          </View>
        )}

        {!error && others.map((klass) => (
          <ClassCard key={klass.id} klass={klass} formatBoth={formatBoth} onJoin={() => setJoining(klass)} />
        ))}
      </ScrollView>

      {joining?.quote ? <PaymentSheet
        visible
        amount={joining.quote.amount}
        label={`${joining.subject} — ${joining.quote.sessionsRemaining} classes left in this monthly cycle`}
        onClose={() => setJoining(null)}
        onSuccess={(method) => join(joining, method)}
      /> : null}
    </View>
  );
}

function ClassCard({
  klass,
  formatBoth,
  onJoin,
}: {
  klass: MonthlyClass;
  formatBoth: (v: string | number | Date) => string;
  onJoin: () => void;
}) {
  const colors = useColors();
  const { t, numeric, space, radius } = useLayout();
  const dates = useDates();
  const quote = klass.quote;
  const full = klass.seatsLeft <= 0;
  const nothingLeft = quote?.startsNextCycle === true;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[t.title2, { color: colors.foreground }]}>{klass.subject}</Text>
      <Text style={[t.callout, { color: colors.mutedForeground, marginTop: space.xxs }]}>{klass.topic}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs }]}>with {klass.teacherName}</Text>

      <View style={[styles.factRow, { borderTopColor: colors.border }]}>
        <Fact icon="clock" text={`Every day at ${formatStartMinute(klass.startMinute)}`} />
        <Fact icon="users" text={full ? "Full" : `${klass.seatsLeft} places left`} />
      </View>
      <View style={styles.factRow}>
        <Fact icon="calendar" text={`${klass.sessionsRemaining} classes left this month`} />
      </View>

      {/*
        Today's class, one tap from here.

        The owner's ask: a student should not have to go to the Sessions tab to attend. The
        class-day is already a real session with a real room — only the link was missing.
      */}
      {klass.today?.sessionId ? (
        <TouchableOpacity
          testID={`monthly-today-${klass.id}`}
          activeOpacity={0.85}
          onPress={() => router.push(`/session/${klass.today!.sessionId}`)}
          style={[styles.todayBtn, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={todayLabel(klass.today.startsAt, dates)}
        >
          <Feather name="video" size={16} color={colors.primaryForeground} />
          <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>
            {todayLabel(klass.today.startsAt, dates)}
          </Text>
        </TouchableOpacity>
      ) : null}

      {klass.enrolment ? (
        <View style={[styles.joined, { backgroundColor: colors.actionSoft, borderColor: colors.primary }]}>
          <Feather name="check-circle" size={16} color={colors.primary} />
          {/*
            What was paid for, and what is guaranteed.

            This used to say only the first. The teacher's obligation is a floor of 25, so a
            student who receives 26 of 29 had "lost three" while the teacher owed nothing —
            two numbers for one arrangement, and the gap is where a refund argument starts.
            See paidAndGuaranteed() in utils/monthly.ts.
          */}
          <Text style={[t.callout, styles.joinedText, { color: colors.foreground }]} testID="monthly-paid-line">
            You are in this class. {paidAndGuaranteed(klass.enrolment)}
          </Text>
        </View>
      ) : (
        <>
          {/*
            The price, spelled out.

            A month costs one thing and this student is being asked for another, and the gap is
            the whole point of the tier. Showing only the smaller number looks like a discount;
            showing only the bigger one looks like an overcharge. Both, with the reason.
          */}
          {quote && !nothingLeft && (
            <View style={styles.priceBlock}>
              <Text style={[t.title1, numeric, { color: colors.foreground }]}>{money(quote.amount)}</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                for the {quote.sessionsRemaining} classes left this month
                {quote.sessionsRemaining < quote.sessionsPlanned
                  ? ` — a full monthly cycle is ${money(klass.monthlyPrice)}`
                  : ""}
              </Text>
            </View>
          )}

          {nothingLeft ? (
            <View style={[styles.notice, { backgroundColor: colors.warnSoft, borderColor: colors.warn, marginTop: space.sm, marginBottom: 0 }]}>
              <Feather name="clock" size={16} color={colors.warn} />
              <Text style={[t.callout, styles.noticeText, { color: colors.foreground }]}>
                This month has no classes left, so there is nothing to pay for yet. It starts again
                {klass.cycle ? ` on ${formatBoth(klass.cycle.endsAt)}` : " next month"}.
              </Text>
            </View>
          ) : quote ? (
            <TouchableOpacity
              testID={`monthly-join-${klass.id}`}
              onPress={onJoin}
              disabled={full}
              style={[styles.joinBtn, { backgroundColor: full ? colors.input : colors.primary }]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: full }}
            >
              <Text style={[t.bodyStrong, numeric, { color: full ? colors.mutedForeground : colors.primaryForeground }]}>
                {full ? "This class is full" : `Join for ${money(quote.amount)} for this monthly cycle`}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.notice, { backgroundColor: colors.warnSoft, borderColor: colors.warn, marginTop: space.sm, marginBottom: 0 }]}>
              <Feather name="alert-circle" size={16} color={colors.warn} />
              <Text style={[t.callout, styles.noticeText, { color: colors.foreground }]}>The price is unavailable right now. Refresh before trying to join.</Text>
            </View>
          )}
        </>
      )}

      {klass.enrolment && (
        <View style={styles.linkRow}>
          <TouchableOpacity
            testID={`monthly-chat-${klass.id}`}
            onPress={() => router.push({ pathname: "/monthly-chat", params: { id: String(klass.id) } })}
            style={[styles.linkBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Open ${klass.subject} class chat`}
          >
            <Feather name="message-circle" size={16} color={colors.primary} />
            <Text style={[t.callout, { color: colors.foreground }]}>Class chat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`monthly-homework-${klass.id}`}
            onPress={() => router.push({ pathname: "/monthly-homework", params: { id: String(klass.id) } })}
            style={[styles.linkBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Open ${klass.subject} homework`}
          >
            <Feather name="book-open" size={16} color={colors.primary} />
            <Text style={[t.callout, { color: colors.foreground }]}>Homework</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  const colors = useColors();
  const { t } = useLayout();
  return (
    <View style={styles.fact}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingBottom: layoutSpace.md, borderBottomWidth: StyleSheet.hairlineWidth },
  scroll: { paddingTop: layoutSpace.md },
  sectionTitle: { marginTop: layoutSpace.xs, marginBottom: layoutSpace.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: layoutSpace.md, marginBottom: layoutSpace.md },
  factRow: { flexDirection: "row", flexWrap: "wrap", gap: layoutSpace.md, marginTop: layoutSpace.sm, paddingTop: layoutSpace.sm, borderTopWidth: 0 },
  fact: { flexDirection: "row", alignItems: "center", gap: layoutSpace.xxs },
  priceBlock: { marginTop: layoutSpace.md, gap: layoutSpace.xxs },
  joinBtn: { borderRadius: layoutRadius.md, minHeight: HIT_SLOP_MIN, paddingHorizontal: layoutSpace.md, alignItems: "center", justifyContent: "center", marginTop: layoutSpace.md },
  joined: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: layoutSpace.xs,
    padding: layoutSpace.sm,
    borderRadius: layoutRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: layoutSpace.md,
  },
  todayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: layoutSpace.xs, borderRadius: layoutRadius.sm, minHeight: HIT_SLOP_MIN, paddingHorizontal: layoutSpace.md, marginBottom: layoutSpace.sm },
  joinedText: { flex: 1 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: layoutSpace.xs,
    padding: layoutSpace.sm,
    borderRadius: layoutRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: layoutSpace.md,
  },
  noticeCopy: { flex: 1, gap: layoutSpace.xxs },
  noticeText: { flex: 1 },
  retryBtn: { minHeight: HIT_SLOP_MIN, justifyContent: "center", alignSelf: "flex-start" },
  linkRow: { flexDirection: "row", gap: layoutSpace.xs, marginTop: layoutSpace.md },
  linkBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: layoutSpace.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layoutRadius.sm,
    minHeight: HIT_SLOP_MIN,
    paddingHorizontal: layoutSpace.sm,
  },
});
