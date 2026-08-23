import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";
import { notify } from "@/utils/alerts";
import { countdown, humanDuration, serverNow, waitingState } from "@/utils/sessionClock";
import { joinState, startState } from "@/utils/sessionWindow";
import SessionThread from "@/components/SessionThread";
import DropClass from "@/components/DropClass";
import RescheduleClass from "@/components/RescheduleClass";

/**
 * A class's own page — the link the owner asked for.
 *
 * "The teacher should be able to click on it and see the students that have enrolled" without
 * starting the class, and "the completed session must show who attended". Both of those, plus
 * the student's half: whether the teacher has arrived, how long they have been waiting, and a
 * way to reach somebody once that wait passes ten minutes.
 *
 * It also fixes something that was quietly broken. The invitation email has always linked to
 * `/session/:id`, and until now no such screen existed — every invitation sent led to a "not
 * found". The new booking email links here too.
 *
 * The clock on this page runs on the *server's* time, not the handset's. The market is cheap
 * Android phones, plenty of which are minutes or hours out; a wrong clock here would tell a
 * student their teacher was late for a class that had not started, and offer them a refund
 * for it. See utils/sessionClock.ts.
 */

interface SessionDetail {
  id: number;
  teacherId: number;
  teacherName: string;
  subject: string;
  topic: string;
  description: string | null;
  date: string;
  duration: number;
  price: number;
  maxStudents: number;
  enrolledCount: number;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface AttendanceEntry {
  userId: number;
  name: string;
  attended: boolean;
  presentMs: number;
  joinCount: number;
  firstJoinedAt: string | null;
  lastSeenAt: string | null;
  enrolledAt: string;
}

interface Finding {
  code: string;
  userId?: number;
  detail: string;
}

interface Attendance {
  role: "teacher" | "student";
  serverTime: string;
  known: boolean;
  teacherJoinedAt: string | null;
  teacherIsLate: boolean;
  teacherLateBy: number | null;
  enrolled?: AttendanceEntry[];
  findings?: Finding[];
  teacher?: { userId: number; name: string; presentMs: number } | null;
  you?: { presentMs: number } | null;
  attendeeCount?: number;
}

export default function SessionPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * When the server's clock was heard, on this device's clock.
   *
   * Both ends of that subtraction come from the same handset, so the elapsed time is right
   * even when the handset's absolute time is not.
   */
  const heardAt = useRef(Date.now());
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await apiGet<SessionDetail>(`/sessions/${id}`);
      setSession(detail);
      setLoadError(null);
      try {
        const record = await apiGet<Attendance>(`/sessions/${id}/attendance`);
        heardAt.current = Date.now();
        setAttendance(record);
      } catch {
        // Not being allowed to read the register is not a failure to load the class — somebody
        // following an invitation link has not booked yet, and should still see what they are
        // being invited to.
        setAttendance(null);
      }
    } catch {
      setLoadError("This class could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // A running clock, as asked for: "the session must show a running date and timestamp at all
  // times". One second is what makes it read as running rather than as a stale label.
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * The register is re-read while the page is open, so a waiting student sees their teacher
   * arrive without having to do anything. Fifteen seconds is frequent enough to feel live and
   * light enough for a phone on a poor connection.
   */
  useEffect(() => {
    if (!session || session.status === "completed" || session.status === "cancelled") return;
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(timer);
  }, [session?.status, load]);

  const now = serverNow(attendance?.serverTime ?? null, heardAt.current, tick);
  const isTeacher = !!session && !!user && Number(user.userId) === Number(session.teacherId);

  if (loading) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {loadError ?? "This class could not be found."}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const scheduled = new Date(session.date);
  /**
   * Two different doors, so two different buttons.
   *
   * The teacher's opens ten minutes early and stays open ten minutes past the booked finish,
   * for the one who ended the call by mistake. The student's opens at the same moment but
   * shuts at five past, and never asks whether the teacher has arrived — they are entitled to
   * go in and wait, and that wait is what a refund is argued from. See utils/sessionWindow.ts.
   */
  const start = isTeacher ? startState(session, now) : joinState(session, now);
  const waiting = attendance
    ? waitingState({
        teacherJoinedAt: attendance.teacherJoinedAt,
        teacherIsLate: attendance.teacherIsLate,
        teacherLateBy: attendance.teacherLateBy,
        known: attendance.known,
      })
    : null;

  const openClassroom = () => {
    if (!start.enabled) {
      notify(start.label, start.reason ?? "This class can no longer be opened.");
      return;
    }
    router.push(isTeacher ? `/(teacher)/classroom/${session.id}` : `/(student)/classroom/${session.id}`);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} testID="session-back-btn">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Class details</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.subject, { color: colors.primary }]}>{session.subject}</Text>
        <Text style={[styles.topic, { color: colors.foreground }]}>{session.topic}</Text>
        {!isTeacher && (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>with {session.teacherName}</Text>
        )}

        {/*
          The date and the running clock. The owner asked for a timestamp visible at all times,
          because it is what a dispute is measured against — "the teacher was ten minutes late"
          means nothing if neither person can see what the time was.
        */}
        <View style={[styles.clock, { borderColor: colors.border }]} testID="session-clock">
          <Feather name="clock" size={14} color={colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.clockPrimary, { color: colors.foreground }]}>
              {scheduled.toLocaleString("en-NP", {
                weekday: "short", day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit",
              })}
            </Text>
            <Text style={[styles.clockSecondary, { color: colors.mutedForeground }]}>
              {countdown(session.date, now)} · {session.duration} min · now{" "}
              {new Date(now).toLocaleTimeString("en-NP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </Text>
          </View>
        </View>

        {session.description ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{session.description}</Text>
        ) : null}
      </View>

      {/* The student's half: has the teacher turned up, and what to do if not. */}
      {!isTeacher && waiting && session.status !== "completed" && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your teacher</Text>
          <Text style={[styles.muted, { color: waiting.offerHelp ? colors.destructive : colors.mutedForeground }]}>
            {waiting.message}
          </Text>
          {waiting.offerHelp && (
            <TouchableOpacity
              testID="session-get-help"
              style={[styles.helpBtn, { backgroundColor: colors.destructive }]}
              onPress={() => router.push(`/support?sessionId=${session.id}&reason=Technical%20Failure`)}
              activeOpacity={0.85}
            >
              <Feather name="life-buoy" size={16} color="#fff" />
              <Text style={styles.helpBtnText}>Get help with this class</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/*
        The teacher's schedule, and what changing it costs.

        Only for a class that has not happened: moving a lesson that was already taught is not
        rescheduling, and the students who sat through it would be told their class had moved.
      */}
      {isTeacher && session.status === "upcoming" && (
        <RescheduleClass sessionId={session.id} currentDate={session.date} onMoved={() => void load()} />
      )}

      {/* The teacher's half: who is coming, without having to start the class to find out. */}
      {isTeacher && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {session.status === "completed" ? "Who attended" : "Who has booked"}
          </Text>

          {!attendance?.enrolled?.length ? (
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              Nobody has booked this class yet.
            </Text>
          ) : (
            attendance.enrolled.map((student) => (
              <View key={student.userId} style={[styles.row, { borderTopColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.foreground }]}>{student.name}</Text>
                  <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                    {student.attended
                      ? `Present for ${humanDuration(student.presentMs)}` +
                        (student.joinCount > 1 ? ` · reconnected ${student.joinCount - 1} time${student.joinCount === 2 ? "" : "s"}` : "")
                      : session.status === "completed"
                        ? "Did not attend"
                        : "Not joined yet"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: student.attended ? colors.success + "15" : colors.muted },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: student.attended ? colors.success : colors.mutedForeground },
                    ]}
                  >
                    {student.attended ? "Attended" : "Booked"}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/*
            Statements of fact about what happened, not a verdict — see the server's
            lib/sessionEvidence.ts. Shown to the teacher because they are the person who can
            explain them, and because seeing them here is better than first meeting them in a
            refund claim.
          */}
          {!!attendance?.findings?.length && (
            <View style={[styles.findings, { borderTopColor: colors.border }]}>
              {attendance.findings.map((finding, index) => (
                <View key={`${finding.code}-${index}`} style={styles.findingRow}>
                  <Feather name="info" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.findingText, { color: colors.mutedForeground }]}>{finding.detail}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/*
        The class's own message thread.

        "Add a Session Group Messaging link on this page for session-specific chat (used for
        late notices and refund evidence)" — and the student's side of the same ask, "should
        also be able to see the Messaging Link... and be able to send/receive messages directly
        from here". So it is not a link to somewhere else: it is the thread, on the page, for
        both of them.

        Only shown to people with a place in the class. Somebody following an invitation link
        who has not booked yet can see what they are being invited to and nothing more.
      */}
      {attendance && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Class messages</Text>
          <SessionThread
            sessionId={session.id}
            audienceHint={
              isTeacher
                ? "Everyone who has booked this class can read this — use it to tell them if you are running late."
                : "Your teacher and everyone else in this class can read this."
            }
          />
        </View>
      )}

      {/*
        Getting out, for a student who has one — and, for one who already has, what happened
        to their money. The second is why this is no longer hidden on a finished class: a
        refund is chased after the class, not before it.

        Below the thread on purpose: a student thinking about dropping should pass the teacher's
        "running ten minutes late, start without me" on the way, because that message is often
        the whole reason the thought went away.
      */}
      {!isTeacher && (
        <DropClass sessionId={session.id} onDropped={() => void load()} />
      )}

      {/*
        The Start button, greyed out rather than hidden or quietly refusing.

        "We MUST still make sure, the completed session can never be restarted! The start
        option should be grayed out unless it is less than 3 hours old." Greying it out is the
        point — a teacher who has to tap something to be told it will not work has been given a
        reason to think the app is broken. The server enforces the same window on the room
        endpoint, so this is the courtesy and that is the control.
      */}
      <TouchableOpacity
        testID="session-start-btn"
        disabled={!start.enabled}
        onPress={openClassroom}
        activeOpacity={0.85}
        style={[
          styles.primaryBtn,
          { backgroundColor: start.enabled ? colors.primary : colors.muted },
        ]}
      >
        <Feather name="video" size={18} color={start.enabled ? "#fff" : colors.mutedForeground} />
        <Text style={[styles.primaryBtnText, { color: start.enabled ? "#fff" : colors.mutedForeground }]}>
          {start.label}
        </Text>
      </TouchableOpacity>
      {start.reason && (
        <Text testID="session-start-reason" style={[styles.reason, { color: colors.mutedForeground }]}>
          {start.reason}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  subject: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  topic: { fontSize: 19, fontFamily: "Inter_600SemiBold", lineHeight: 26 },
  muted: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  description: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  clock: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 4 },
  clockPrimary: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  clockSecondary: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, paddingTop: 12, marginTop: 4 },
  rowName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  findings: { borderTopWidth: 1, paddingTop: 12, marginTop: 8, gap: 8 },
  findingRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  findingText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  helpBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 8 },
  helpBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 15 },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  reason: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -8, lineHeight: 18 },
  secondaryBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
