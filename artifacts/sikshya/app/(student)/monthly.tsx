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
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost, ApiError } from "@/utils/api";
import { formatStartMinute, money, type MonthlyClass } from "@/utils/monthly";

/**
 * Monthly classes, from a student's side.
 *
 * The thing this screen has to get right is the price. A student joining on day twenty pays for
 * ten classes, not for a month, and if the number they are shown is not the number they are
 * charged then nothing else about the tier matters. So the price shown here is the one the
 * server quoted — the app never works one out.
 */
export default function StudentMonthlyScreen() {
  const colors = useColors();
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
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Monthly classes</Text>
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
        {problem && (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>{problem}</Text>
          </View>
        )}

        {mine.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your monthly class</Text>
            {mine.map((klass) => (
              <ClassCard key={klass.id} klass={klass} formatBoth={formatBoth} onJoin={() => setJoining(klass)} />
            ))}
          </>
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {mine.length > 0 ? "Other monthly classes" : "Classes you can join"}
        </Text>

        {others.length === 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No monthly classes are running yet. A monthly class runs every day at the same time,
              and you pay once a month.
            </Text>
          </View>
        )}

        {others.map((klass) => (
          <ClassCard key={klass.id} klass={klass} formatBoth={formatBoth} onJoin={() => setJoining(klass)} />
        ))}
      </ScrollView>

      <PaymentSheet
        visible={joining !== null}
        amount={joining?.quote?.amount ?? 0}
        label={joining ? `${joining.subject} — the rest of this month` : undefined}
        onClose={() => setJoining(null)}
        onSuccess={(method) => (joining ? join(joining, method) : Promise.resolve())}
      />
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
  const quote = klass.quote;
  const full = klass.seatsLeft <= 0;
  const nothingLeft = quote?.startsNextCycle === true;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.subject, { color: colors.foreground }]}>{klass.subject}</Text>
      <Text style={[styles.topic, { color: colors.mutedForeground }]}>{klass.topic}</Text>
      <Text style={[styles.teacher, { color: colors.mutedForeground }]}>with {klass.teacherName}</Text>

      <View style={[styles.factRow, { borderTopColor: colors.border }]}>
        <Fact icon="clock" text={`Every day at ${formatStartMinute(klass.startMinute)}`} />
        <Fact icon="users" text={full ? "Full" : `${klass.seatsLeft} places left`} />
      </View>
      <View style={styles.factRow}>
        <Fact icon="calendar" text={`${klass.sessionsRemaining} classes left this month`} />
      </View>

      {klass.enrolment ? (
        <View style={[styles.joined, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
          <Feather name="check-circle" size={16} color={colors.primary} />
          <Text style={[styles.joinedText, { color: colors.foreground }]}>
            You are in this class. You paid {money(klass.enrolment.amountPaid)} for{" "}
            {klass.enrolment.sessionsPaidFor} classes.
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
              <Text style={[styles.priceNow, { color: colors.foreground }]}>{money(quote.amount)}</Text>
              <Text style={[styles.priceWhy, { color: colors.mutedForeground }]}>
                for the {quote.sessionsRemaining} classes left this month
                {quote.sessionsRemaining < quote.sessionsPlanned
                  ? ` — a full month is ${money(klass.monthlyPrice)}`
                  : ""}
              </Text>
            </View>
          )}

          {nothingLeft ? (
            <View style={[styles.notice, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30", marginTop: 12, marginBottom: 0 }]}>
              <Feather name="clock" size={16} color={colors.accent} />
              <Text style={[styles.noticeText, { color: colors.foreground }]}>
                This month has no classes left, so there is nothing to pay for yet. It starts again
                {klass.cycle ? ` on ${formatBoth(klass.cycle.endsAt)}` : " next month"}.
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              testID={`monthly-join-${klass.id}`}
              onPress={onJoin}
              disabled={full}
              style={[styles.joinBtn, { backgroundColor: full ? colors.input : colors.primary }]}
              activeOpacity={0.85}
            >
              <Text style={[styles.joinBtnText, { color: full ? colors.mutedForeground : "#FFFFFF" }]}>
                {full ? "This class is full" : `Join for ${money(quote?.amount ?? 0)}`}
              </Text>
            </TouchableOpacity>
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
          >
            <Feather name="message-circle" size={16} color={colors.primary} />
            <Text style={[styles.linkBtnText, { color: colors.foreground }]}>Class chat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`monthly-homework-${klass.id}`}
            onPress={() => router.push({ pathname: "/monthly-homework", params: { id: String(klass.id) } })}
            style={[styles.linkBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Feather name="book-open" size={16} color={colors.primary} />
            <Text style={[styles.linkBtnText, { color: colors.foreground }]}>Homework</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.fact}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={[styles.factText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 10 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 14 },
  subject: { fontSize: 19, fontFamily: "Inter_700Bold" },
  topic: { fontSize: 14.5, fontFamily: "Inter_400Regular", marginTop: 2 },
  teacher: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  factRow: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 12, paddingTop: 12, borderTopWidth: 0 },
  fact: { flexDirection: "row", alignItems: "center", gap: 6 },
  factText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  priceBlock: { marginTop: 14 },
  priceNow: { fontSize: 26, fontFamily: "Inter_700Bold" },
  priceWhy: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  joinBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 14 },
  joinBtnText: { fontSize: 15.5, fontFamily: "Inter_600SemiBold" },
  joined: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
  },
  joinedText: { flex: 1, fontSize: 13.5, fontFamily: "Inter_400Regular", lineHeight: 19 },
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
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  linkRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  linkBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
  },
  linkBtnText: { fontSize: 13.5, fontFamily: "Inter_500Medium" },
});
