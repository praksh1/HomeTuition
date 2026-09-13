import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import SessionCard from "@/components/SessionCard";
import { useColors } from "@/hooks/useColors";
import type { Student } from "@/context/AuthContext";
import { studentClassSection, studentSessionSection } from "@/utils/studentSessionGroups";
import { useDates } from "@/context/DatePreferenceContext";
import { useLayout } from "@/hooks/useLayout";

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
  /** How this student stands with the class: still in it, or dropped out of it. */
  /** `test` means an operator granted this place for testing. See utils/testAccess.ts. */
  enrolment?: "paid" | "refunded" | "test" | null;
  /**
   * The class is open to test bookings — the server's fact about the class, not about this
   * viewer's money. Carried but deliberately not shown here: a student without a grant pays the
   * full price for a test class, and telling them the class is "test-enabled" answers a question
   * they did not ask with a word that sounds like "free". Their own place is `enrolment`.
   */
  testClass?: boolean;
  testClassLabel?: string;
  classGroup?: {
    batchId: number;
    title: string;
    lessonPosition: number;
    lessonCount: number;
  };
}

type ViewMode = "upcoming" | "live" | "history";
type SessionListItem =
  | { kind: "session"; key: string; session: Session }
  | {
      kind: "class";
      key: string;
      batchId: number;
      title: string;
      teacherName: string;
      session: Session;
      lessonCount: number;
      remainingCount: number;
      testBooking: boolean;
    };

/** How often the session list re-checks for classes going live while the screen is open. */
const SESSION_POLL_MS = 15000;

export default function StudentSessions() {
  const { user } = useAuth();
  const colors = useColors();
  const dates = useDates();
  const { t, numeric, radius, space } = useLayout();
  const insets = useSafeAreaInsets();
  const student = user as Student;
  const [sessions, setSessions] = useState<Session[]>([]);
  /**
   * A ticking clock, so a class that runs out while this screen is open moves itself out of
   * Upcoming rather than sitting there until the next fetch.
   */
  const [tick, setTick] = useState(Date.now());
  /**
   * True until the first fetch answers.
   *
   * Without it this screen rendered "No sessions yet — browse teachers and book your first
   * session" for the second or two before the classes arrived, telling a student who had
   * booked and paid that they had nothing. Only the first load counts: the poll below must
   * not flash the list away every few seconds.
   */
  const [loading, setLoading] = useState(true);

  // Sessions go live on the teacher's schedule, not the student's navigation. Loading only
  // on focus meant a class that started while this screen was open never appeared as live —
  // the student saw "come back at that time to join" with no way in until a manual refresh.
  // Re-fetching on an interval keeps the Join button honest.
  useFocusEffect(
    useCallback(() => {
      loadSessions();
      const timer = setInterval(loadSessions, SESSION_POLL_MS);
      return () => clearInterval(timer);
    }, [student?.userId])
  );

  // The first useful screen is what is ahead, not a forty-five-row archive. Live and History
  // remain one tap away and carry counts, like a timetable rather than a database table.
  const [group, setGroup] = useState<ViewMode>("upcoming");

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const loadSessions = async () => {
    try {
      const [myRes] = await Promise.all([
        student?.userId
          ? apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string; enrolment?: string | null; testClass?: boolean; testClassLabel?: string; classGroup?: Session["classGroup"] }[] }>(
              `/sessions?studentId=${student.userId}&limit=50`
            )
          : Promise.resolve({ sessions: [] }),
      ]);

      const mapSession = (s: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string; enrolment?: string | null; testClass?: boolean; testClassLabel?: string; classGroup?: Session["classGroup"] }): Session => ({
        id: String(s.id),
        teacherId: "",
        teacherName: s.teacherName,
        subject: s.subject,
        topic: s.topic,
        date: s.date,
        duration: s.duration,
        maxStudents: s.maxStudents,
        enrolledStudents: Array(s.enrolledCount).fill(""),
        price: s.price,
        status: s.status as Session["status"],
        enrolment: (s.enrolment as Session["enrolment"]) ?? null,
        testClass: s.testClass === true,
        testClassLabel: s.testClassLabel,
        classGroup: s.classGroup,
      });

      /**
       * Only classes this student actually holds.
       *
       * Every live class on the platform used to be merged in here, so one the student had
       * never booked appeared under "Live Now" with a green "Join Live Session" — no mention of
       * paying. Tapping it got as far as the video room, which refused it, and the student was
       * told "Couldn't set up the video room" for a class they simply had not bought.
       *
       * Classes to buy belong in Discover. This screen is the ones they own.
       */
      setSessions(myRes.sessions.map(mapSession));
    } catch (_e) {
      // Offline: fall through to whatever was last known rather than emptying the list.
    } finally {
      setLoading(false);
    }
  };

  /**
   * Tapping a class opens the class, not a video call.
   *
   * "Tapping a session must open a Details Page, not launch the call" — the owner asked for it
   * for both roles, and the reasons are the same on both sides: seeing who is there, when it
   * starts, and how to reach somebody about it should not require joining a call first. The
   * page carries the Join button, the running clock, and the session's own message thread.
   *
   * Everything this used to do here — checking payment, checking the join window, telling a
   * student when the door opens — is done on that page, by the same rules, and by the server
   * when the button is actually pressed. Deciding it twice is how a screen ends up offering
   * what the server refuses.
   */
  const openSession = (session: Session) => {
    router.push(`/session/${session.id}`);
  };


  /**
   * Which pile a class belongs in, decided by the clock and not only by its status.
   *
   * A class whose time has passed sat under "Upcoming" forever if nobody had marked it
   * finished — which is exactly what a teacher's back-dated class did, and what a class the
   * teacher simply never opened does. The status still wins when it says the class is over;
   * the clock catches the ones it does not.
   */
  const isOver = (s: Session) => studentSessionSection(s, tick) === "history";

  const dropped = sessions.filter((s) => s.enrolment === "refunded");
  const held = sessions.filter((s) => s.enrolment !== "refunded");

  const liveSessions = held.filter((s) => s.status === "live" && !isOver(s));
  const upcomingSessions = held.filter((s) => s.status === "upcoming" && !isOver(s));
  const pastSessions = held.filter((s) => s.status !== "live" && isOver(s));

  /** One purchased class is one card, even when it owns thirty classroom session rows. */
  const buckets = new Map<number, Session[]>();
  for (const session of held) {
    if (!session.classGroup) continue;
    const list = buckets.get(session.classGroup.batchId) ?? [];
    list.push(session);
    buckets.set(session.classGroup.batchId, list);
  }
  const standalone = held.filter((session) => !session.classGroup);
  const rowsFor = (mode: ViewMode): SessionListItem[] => {
    const belongs = (session: Session) => mode === "live"
      ? liveSessions.includes(session)
      : mode === "upcoming"
        ? upcomingSessions.includes(session)
        : pastSessions.includes(session);
    const classRows: SessionListItem[] = [];
    for (const [batchId, classSessions] of buckets) {
      if (studentClassSection(classSessions, tick) !== mode) continue;
      const live = classSessions.filter((session) => liveSessions.includes(session));
      const upcoming = classSessions.filter((session) => upcomingSessions.includes(session));
      // A continuing class belongs in exactly one place. Its completed lessons remain inside
      // Class Home; they must not create a second copy of the whole class under History.
      const candidates = (mode === "live"
        ? live
        : mode === "upcoming"
          ? upcoming
          : classSessions.filter((session) => pastSessions.includes(session)))
        .sort((a, b) =>
        mode === "history"
          ? new Date(b.date).getTime() - new Date(a.date).getTime()
          : new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      if (!candidates.length) continue;
      const session = candidates[0]!;
      classRows.push({
        kind: "class",
        key: `class-${batchId}`,
        batchId,
        title: session.classGroup?.title ?? session.topic,
        teacherName: session.teacherName,
        session,
        lessonCount: session.classGroup?.lessonCount ?? classSessions.length,
        remainingCount: classSessions.filter((item) => !isOver(item)).length,
        testBooking: classSessions.some((item) => item.enrolment === "test"),
      });
    }
    const singleRows: SessionListItem[] = standalone
      .filter(belongs)
      .map((session) => ({ kind: "session", key: `session-${session.id}`, session }));
    return [...classRows, ...singleRows].sort((a, b) => {
      const aDate = new Date(a.session.date).getTime();
      const bDate = new Date(b.session.date).getTime();
      return mode === "history" ? bDate - aDate : aDate - bDate;
    });
  };
  const liveRows = rowsFor("live");
  const upcomingRows = rowsFor("upcoming");
  const historyRows = rowsFor("history");
  const visibleRows = group === "live" ? liveRows : group === "history" ? historyRows : upcomingRows;
  const groups: Array<{ id: ViewMode; label: string; count: number }> = [
    { id: "upcoming", label: "Upcoming", count: upcomingRows.length },
    { id: "live", label: "Live", count: liveRows.length },
    { id: "history", label: "History", count: historyRows.length + dropped.length },
  ];

  const renderClass = (item: Extract<SessionListItem, { kind: "class" }>) => {
    const status = group === "live" ? "Live now" : group === "history" ? "Completed" : "Next lesson";
    return (
      <TouchableOpacity
        testID={`student-class-group-${item.batchId}`}
        accessibilityRole="button"
        activeOpacity={0.82}
        onPress={() => router.push({ pathname: "/class-home", params: { id: String(item.batchId) } })}
        style={[styles.classCard, { backgroundColor: colors.card, borderColor: group === "live" ? colors.success : colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm }]}
      >
        <View style={styles.classTop}>
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text style={[t.title3, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>{item.teacherName}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: group === "live" ? colors.success + "18" : colors.muted, borderRadius: radius.pill }]}>
            <Text style={[t.caption, { color: group === "live" ? colors.success : colors.mutedForeground }]}>{status}</Text>
          </View>
        </View>
        <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>
          {dates.format(item.session.date, { withTime: true })}
        </Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          {group === "history"
            ? `${item.lessonCount} lesson class · open homework, messages and records`
            : `${item.remainingCount} of ${item.lessonCount} lessons remaining${item.testBooking ? " · test booking" : ""}`}
        </Text>
        <View style={styles.openRow}>
          <Text style={[t.bodyStrong, { color: colors.primary }]}>Open class</Text>
          <Feather name="arrow-right" size={18} color={colors.primary} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My learning</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>Your classes, grouped by course—not one card per lesson.</Text>
      </View>

      <FlatList
        data={group === "history"
          ? [...visibleRows, ...dropped.map((session): SessionListItem => ({ kind: "session", key: `dropped-${session.id}`, session }))]
          : visibleRows}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100, gap: space.sm }]}
        ListHeaderComponent={
          <View testID="student-filter-row" style={[styles.groups, { gap: space.xs, marginBottom: space.sm }]}>
              {groups.map((g) => {
                const active = group === g.id;
                return (
                  <TouchableOpacity
                    key={g.id}
                    testID={`student-group-${g.id}`}
                    onPress={() => setGroup(g.id)}
                    activeOpacity={0.75}
                    style={[styles.group, { flex: 1, borderRadius: radius.pill,
                      borderColor: active ? colors.secondary : colors.border,
                      backgroundColor: active ? colors.secondary + "14" : colors.card,
                    }]}
                  >
                    <Text style={[styles.groupText, { color: active ? colors.secondary : colors.mutedForeground }]}>
                      {g.label}{g.count > 0 ? ` ${g.count}` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </View>
        }
        renderItem={({ item }) => item.kind === "class"
          ? renderClass(item)
          : <View testID={item.key}>
              <SessionCard session={item.session} showTeacher onPress={() => openSession(item.session)} />
              {item.session.enrolment === "refunded" ? <View style={[styles.droppedFlag, { backgroundColor: colors.muted }]}>
                <Feather name="corner-up-left" size={12} color={colors.mutedForeground} />
                <Text style={[styles.droppedFlagText, { color: colors.mutedForeground }]}>Dropped · open for refund status</Text>
              </View> : null}
            </View>}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Loading your classes…
              </Text>
            </View>
          ) : (
          <View style={styles.empty}>
            <Feather name="calendar" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {group === "history" ? "No class history yet" : group === "live" ? "Nothing live right now" : "No upcoming classes"}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {group === "upcoming" ? "Find a class or teacher and reserve your place." : "Use Upcoming to see what is next."}
            </Text>
            <TouchableOpacity
              style={[styles.discoverBtn, { backgroundColor: colors.secondary }]}
              onPress={() => router.push("/(student)")}
              activeOpacity={0.85}
            >
              <Text style={styles.discoverBtnText}>Explore classes</Text>
            </TouchableOpacity>
          </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  list: { paddingHorizontal: 20, paddingTop: 8 },
  droppedFlag: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: -6, marginBottom: 12,
  },
  droppedFlagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  groups: { flexDirection: "row", alignItems: "center" },
  group: { borderWidth: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, paddingVertical: 8 },
  groupText: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  classCard: { borderWidth: 1 },
  classTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5 },
  openRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  discoverBtn: { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  discoverBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
