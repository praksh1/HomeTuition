import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import SessionCard from "@/components/SessionCard";
import { useColors } from "@/hooks/useColors";
import type { Student } from "@/context/AuthContext";
import { joinState } from "@/utils/sessionWindow";

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
  enrolment?: "paid" | "refunded" | null;
}

/** How often the session list re-checks for classes going live while the screen is open. */
const SESSION_POLL_MS = 15000;

export default function StudentSessions() {
  const { user } = useAuth();
  const colors = useColors();
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

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const loadSessions = async () => {
    try {
      const [myRes, liveRes] = await Promise.all([
        student?.userId
          ? apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string; enrolment?: string | null }[] }>(
              `/sessions?studentId=${student.userId}&limit=50`
            )
          : Promise.resolve({ sessions: [] }),
        apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string; enrolment?: string | null }[] }>(
          "/sessions?status=live&limit=10"
        ),
      ]);

      const mapSession = (s: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string; enrolment?: string | null }): Session => ({
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
      });

      const allSessions = [
        ...myRes.sessions.map(mapSession),
        ...liveRes.sessions.filter((ls) => !myRes.sessions.some((ms) => ms.id === ls.id)).map(mapSession),
      ];
      setSessions(allSessions);
    } catch (_e) {
      // Offline: fall through to whatever was last known rather than emptying the list.
    } finally {
      setLoading(false);
    }
  };

  const notify = (title: string, msg: string) => {
    if (Platform.OS === "web") window.alert(`${title}\n\n${msg}`);
    else Alert.alert(title, msg, [{ text: "OK" }]);
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
  const isOver = (s: Session) =>
    s.status === "completed" || s.status === "cancelled" || !joinState(s, tick).enabled;

  const dropped = sessions.filter((s) => s.enrolment === "refunded");
  const held = sessions.filter((s) => s.enrolment !== "refunded");

  const liveSessions = held.filter((s) => s.status === "live" && !isOver(s));
  const upcomingSessions = held.filter((s) => s.status === "upcoming" && !isOver(s));
  const pastSessions = held.filter((s) => s.status !== "live" && isOver(s));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My Sessions</Text>
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={!!sessions.length}
        ListHeaderComponent={
          <View>
            {liveSessions.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.liveIndicator, { backgroundColor: colors.success }]} />
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Live Now</Text>
                </View>
                {liveSessions.map((s) => (
                  <View key={s.id}>
                    <SessionCard session={s} showTeacher onPress={() => openSession(s)} />
                    <TouchableOpacity
                      style={[styles.joinBtn, { backgroundColor: colors.success }]}
                      onPress={() => openSession(s)}
                      activeOpacity={0.85}
                    >
                      <Feather name="video" size={16} color="#fff" />
                      <Text style={styles.joinBtnText}>Join Live Session</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {upcomingSessions.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upcoming</Text>
                {upcomingSessions.map((s) => (
                  <SessionCard key={s.id} session={s} showTeacher onPress={() => openSession(s)} />
                ))}
              </View>
            )}

            {pastSessions.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Past Sessions</Text>
                {/*
                  Tappable, which they were not. A finished class had no onPress at all, so
                  pressing one did nothing whatsoever — reported as exactly that. Its page is
                  where the messages, the attendance and any refund live, and all three are
                  wanted most after the class rather than before it.
                */}
                {pastSessions.map((s) => (
                  <SessionCard key={s.id} session={s} showTeacher onPress={() => openSession(s)} />
                ))}
              </View>
            )}

            {dropped.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Dropped</Text>
                <Text style={[styles.sectionNote, { color: colors.mutedForeground }]}>
                  Classes you left. Open one to see where its refund has got to.
                </Text>
                {dropped.map((s) => (
                  <View key={s.id} testID={`dropped-session-${s.id}`}>
                    <SessionCard session={s} showTeacher onPress={() => openSession(s)} />
                    <View style={[styles.droppedFlag, { backgroundColor: colors.muted }]}>
                      <Feather name="corner-up-left" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.droppedFlagText, { color: colors.mutedForeground }]}>
                        Dropped — tap for refund status
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={() => null}
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
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No sessions yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Browse teachers and book your first session
            </Text>
            <TouchableOpacity
              style={[styles.discoverBtn, { backgroundColor: colors.secondary }]}
              onPress={() => router.push("/(student)")}
              activeOpacity={0.85}
            >
              <Text style={styles.discoverBtnText}>Find a Teacher</Text>
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
  section: { gap: 4, marginBottom: 20 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  liveIndicator: { width: 10, height: 10, borderRadius: 5 },
  sectionNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8, lineHeight: 17 },
  droppedFlag: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: -6, marginBottom: 12,
  },
  droppedFlagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  joinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: -4, marginBottom: 8 },
  joinBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  discoverBtn: { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  discoverBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
