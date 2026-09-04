import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import SessionCard from "@/components/SessionCard";
import { useColors } from "@/hooks/useColors";
import type { Teacher } from "@/context/AuthContext";
import type { MonthlyPlanView } from "@/utils/monthly";

interface Session {
  id: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledStudents: string[];
  price: number;
  status: "upcoming" | "live" | "completed" | "cancelled";
  /** Its start time has been and gone and nobody started it. Decided by the server. */
  expired?: boolean;
  /**
   * Created under a test grant, so its price is not money anybody will ever be paid.
   *
   * The server's own fact, from `test_classes`. Without it this list showed "NPR 500 per class"
   * against a class that had never taken a rupee, and a teacher adding up their month from this
   * screen counted income that does not exist.
   */
  test?: boolean;
  testLabel?: string;
}

/**
 * The tabs, and why there are now six.
 *
 * The owner's words: "I have only been testing for less than a month and already my pages look
 * overcrowded." The answer to a crowded list is not a shorter list — a teacher needs every
 * class they ever ran — it is a way to ask for the part they came for.
 *
 * "Expired" is the one they named. Classes whose time came and went unstarted used to sit in
 * Upcoming, so a teacher scrolling for tomorrow's lesson scrolled through last week's misses
 * first. They are their own tab now: still there, out of the way, and honestly labelled.
 *
 * "Monthly" is not a status at all — a monthly class is a standing arrangement, not one lesson
 * — which is why it is fetched separately below rather than being another value of `status`.
 */
type FilterTab = "all" | "upcoming" | "live" | "completed" | "expired" | "monthly";

export default function TeacherSessions() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  /**
   * Each tab asks the server for that status, rather than pulling a slice of everything and
   * sifting it here.
   *
   * The old version fetched the hundred most recent sessions and filtered them in the app, so
   * a teacher with more history than that saw tabs that were simply wrong — an Upcoming tab
   * reporting "No sessions yet" while the dashboard, which asks the server for upcoming
   * sessions properly, listed several. Whatever else was going on, a list that can only be
   * right for teachers with little history is not a list worth keeping.
   */
  const loadSessions = useCallback(async () => {
    if (!teacher?.userId) return;
    setLoading(true);
    setLoadError(false);
    // "Expired" is upcoming classes whose time has passed, so it asks for the same status and
    // sifts by what the server says about each one. "Monthly" asks a different endpoint
    // entirely — see loadPlan.
    const statusParam = filter === "all" || filter === "monthly" ? ""
      : filter === "expired" ? "&status=upcoming"
      : `&status=${filter}`;
    try {
      const res = await apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string; expired?: boolean; test?: boolean; testLabel?: string }[] }>(
        `/sessions?teacherId=${teacher.userId}${statusParam}&limit=100`
      );
      setSessions(res.sessions.map((s) => ({
        id: String(s.id),
        teacherId: String(teacher.userId),
        teacherName: s.teacherName,
        subject: s.subject,
        topic: s.topic,
        date: s.date,
        duration: s.duration,
        maxStudents: s.maxStudents,
        enrolledStudents: Array(s.enrolledCount).fill(""),
        price: s.price,
        status: s.status as Session["status"],
        expired: s.expired === true,
        test: s.test === true,
        testLabel: s.testLabel,
      })));
    } catch (_e) {
      // An empty list and a failed request used to look identical: both showed "No sessions
      // yet", so a teacher whose classes had not loaded was told they had none.
      setLoadError(true);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [teacher?.userId, filter]);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
    }, [loadSessions]),
  );

  /**
   * The monthly plan, fetched once and kept.
   *
   * Separate from the list because it is a different kind of thing: one standing arrangement
   * rather than a row among many. The owner asked for it to be findable from here — "for
   * Teacher it must also show in 'My Plan' ... maybe create a new Filter/Section for Monthly
   * Recurring Classes" — and this is the screen a teacher already opens to see their teaching.
   */
  const [plan, setPlan] = useState<MonthlyPlanView | null>(null);
  const [planKnown, setPlanKnown] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await apiGet<MonthlyPlanView>("/monthly/plan");
        if (alive) { setPlan(res); setPlanKnown(true); }
      } catch {
        // A plan that could not be loaded is not the same as not having one, so the tab says
        // so rather than showing the "you have no monthly class" pitch to somebody who has one.
        if (alive) { setPlan(null); setPlanKnown(false); }
      }
    })();
    return () => { alive = false; };
  }, []));

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "upcoming", label: "Upcoming" },
    { key: "completed", label: "Completed" },
    { key: "expired", label: "Expired" },
    { key: "monthly", label: "Monthly" },
  ];

  /**
   * The server has already filtered by status; sifting again here is what made the tab wrong.
   *
   * The two exceptions are the two tabs the server has no status for. Expired and Upcoming are
   * both `status=upcoming` rows told apart by whether their time has passed — which the server
   * decides and sends, so the two tabs cannot disagree with each other or with the dashboard.
   */
  const filtered =
    filter === "expired" ? sessions.filter((s) => s.expired)
    : filter === "upcoming" ? sessions.filter((s) => !s.expired)
    : sessions;

  /**
   * Opening a class from this list.
   *
   * This used to push straight into the classroom with no check at all, which is how a class
   * from three days ago could be tapped and start a video call: the classroom asks the server
   * for a room the moment it mounts, the server created one, and the phone asked for camera
   * and microphone. The refusal happens here, before any of that — decided from the date and
   * length already in this list, so it is immediate and needs no round trip.
   */
  /**
   * Tapping a class always opens the class.
   *
   * It used to check whether the class could be *opened* and refuse with an alert when it
   * could not. That was right when a tap went straight into a video call; it is wrong now that
   * a tap goes to a page, and refusing to open a page helps nobody. Reported twice: a finished
   * class said "Session Expired" and showed nothing, and a class that had been opened and
   * ended said "Not open yet" — and those are exactly the classes a teacher wants to look at,
   * to see who enrolled, who attended, and what was said.
   *
   * The page carries the refusal instead, as a greyed-out button with the reason beside it.
   * That is where it belongs: next to the thing it is about, not in a dialog that takes the
   * class away with it.
   */
  const openSession = (item: Session) => {
    router.push(`/session/${item.id}`);
  };

  const FilterRow = () => (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        /**
         * `flexGrow: 0, flexShrink: 0` is load-bearing, not tidying.
         *
         * A horizontal ScrollView has no height of its own. As a flex child above a list that
         * wants all the room, it gets squeezed to nothing — the chips paint for one frame and
         * then the row collapses, which is exactly what a teacher reported: "the filters
         * flashed for a second before disappearing completely".
         *
         * A test that reads document.body.innerText will not catch this. Text inside a
         * zero-height element is still in innerText, so the suite went green while the row was
         * invisible on a real phone; the checks measure the row's height now.
         */
        testID="teacher-filter-row"
        style={styles.tabsRow}
      >
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, filter === tab.key && { backgroundColor: colors.primary }]}
            onPress={() => setFilter(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, { color: filter === tab.key ? "#fff" : colors.mutedForeground }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My Sessions</Text>
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/(teacher)/session-create")}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={styles.createBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {/*
        Six chips do not fit across a cheap Android phone, and squashing them makes every label
        unreadable rather than one of them off-screen. So the row scrolls.
      */}

      {/*
        My Plan.

        A monthly class is one standing arrangement, not a row in a list, so it gets a panel
        rather than a card in the FlatList below. Everything a teacher would come here to check
        is on it — the time it runs, what they charge, how many have joined and how far through
        the month they are — and the panel opens the full screen for anything else.
      */}
      {filter === "monthly" ? (
        <View style={[styles.list, { paddingBottom: insets.bottom + 100 }]}>
          <FilterRow />
          {plan?.class ? (
            <TouchableOpacity
              testID="teacher-monthly-plan"
              activeOpacity={0.85}
              onPress={() => router.push("/(teacher)/monthly")}
              style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.planTop}>
                <Text style={[styles.planTopic, { color: colors.foreground }]}>{plan.class.topic}</Text>
                <Text style={[styles.planPrice, { color: colors.primary }]}>
                  NPR {plan.class.monthlyPrice.toLocaleString()}/mo
                </Text>
              </View>
              <Text style={[styles.planMeta, { color: colors.mutedForeground }]}>
                {plan.class.subject} · every day at {plan.class.startTime} · {plan.class.durationMinutes} min
              </Text>
              <Text style={[styles.planMeta, { color: colors.mutedForeground }]}>
                {plan.class.enrolled} {plan.class.enrolled === 1 ? "student" : "students"}
                {plan.class.seatsLeft > 0 ? ` · ${plan.class.seatsLeft} seats left` : " · full"}
              </Text>
              {plan.class.sessionsPlanned > 0 ? (
                <Text style={[styles.planMeta, { color: colors.mutedForeground }]}>
                  {plan.class.sessionsPlanned - plan.class.sessionsRemaining} of {plan.class.sessionsPlanned} classes
                  held this cycle
                </Text>
              ) : null}
              {plan.plan?.status && plan.plan.status !== "active" ? (
                <Text style={[styles.planWarn, { color: colors.destructive }]} testID="teacher-monthly-suspended">
                  {plan.plan.suspendedReason ?? "This plan is not currently running."}
                </Text>
              ) : null}
              <Text style={[styles.planLink, { color: colors.secondary }]}>Open My Plan →</Text>
            </TouchableOpacity>
          ) : null}

          {/*
            Today's class, one tap from the plan.
            
            A teacher should not have to find their own daily class in a list of every class
            they have ever run — it is the same class every day, at the same time.
          */}
          {plan?.class?.today?.sessionId ? (
            <TouchableOpacity
              testID="teacher-monthly-today"
              activeOpacity={0.85}
              onPress={() => router.push(`/session/${plan.class!.today!.sessionId}`)}
              style={[styles.todayBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="video" size={16} color="#fff" />
              <Text style={styles.todayBtnText}>Today&apos;s class</Text>
            </TouchableOpacity>
          ) : !planKnown ? (
            <View style={styles.empty}>
              <Feather name="wifi-off" size={44} color={colors.border} />
              {/* Not the same as having no plan, and must never be shown as if it were. */}
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                We could not check your monthly plan. Pull to try again.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="repeat" size={44} color={colors.border} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                You do not run a monthly class yet
              </Text>
              <TouchableOpacity
                testID="teacher-monthly-start"
                activeOpacity={0.85}
                onPress={() => router.push("/(teacher)/monthly")}
                style={[styles.createBtn, { backgroundColor: colors.primary, marginTop: 12 }]}
              >
                <Text style={styles.createBtnText}>Set one up</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
      <FlatList
        data={filtered}
        /**
         * The filters ride inside the list rather than sitting above it.
         *
         * As a sibling they flashed on and then vanished on a teacher's iPhone — reported
         * twice, from two different routes into this screen. I could not reproduce it in
         * Chromium and my first explanation for it was wrong, so rather than patch a guess
         * this removes the situation that produced it: a row competing for height with a list
         * that wants all of it. Inside the list there is nothing to compete with, and it is
         * the arrangement the student's Sessions screen has always used without trouble.
         */
        ListHeaderComponent={<FilterRow />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={!!filtered.length}
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            onPress={() => openSession(item)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : loadError ? (
            <View style={styles.empty}>
              <Feather name="wifi-off" size={44} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Your sessions could not be loaded
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                This is a connection problem, not an empty diary. Check your internet and try again.
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={() => void loadSessions()}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <View style={styles.empty}>
            <Feather name="calendar" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {filter === "all" ? "No sessions yet"
                : filter === "expired" ? "Nothing has been missed"
                : `No ${filter} sessions`}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Create your first session to start teaching
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/(teacher)/session-create")}
              activeOpacity={0.85}
            >
              <Text style={styles.emptyBtnText}>Create Session</Text>
            </TouchableOpacity>
          </View>
          )
        }
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  planCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  planTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  planTopic: { flex: 1, fontSize: 17, fontFamily: "Inter_600SemiBold" },
  planPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  planMeta: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  planWarn: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, marginTop: 4 },
  planLink: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 8 },
  todayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: 12 },
  todayBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  tabsRow: { flexGrow: 0, flexShrink: 0 },
  tabs: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  tab: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#F4F4F0" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { paddingHorizontal: 20, paddingTop: 8 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
