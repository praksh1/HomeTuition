import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import SessionCard from "@/components/SessionCard";
import { useColors } from "@/hooks/useColors";
import type { Student } from "@/context/AuthContext";

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
}

/** How often the session list re-checks for classes going live while the screen is open. */
const SESSION_POLL_MS = 15000;

export default function StudentSessions() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const student = user as Student;
  const [sessions, setSessions] = useState<Session[]>([]);

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

  const loadSessions = async () => {
    try {
      const [myRes, liveRes] = await Promise.all([
        student?.userId
          ? apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string }[] }>(
              `/sessions?studentId=${student.userId}&limit=50`
            )
          : Promise.resolve({ sessions: [] }),
        apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string }[] }>(
          "/sessions?status=live&limit=10"
        ),
      ]);

      const mapSession = (s: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string }): Session => ({
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
      });

      const allSessions = [
        ...myRes.sessions.map(mapSession),
        ...liveRes.sessions.filter((ls) => !myRes.sessions.some((ms) => ms.id === ls.id)).map(mapSession),
      ];
      setSessions(allSessions);
    } catch (_e) {}
  };

  const notify = (title: string, msg: string) => {
    if (Platform.OS === "web") window.alert(`${title}\n\n${msg}`);
    else Alert.alert(title, msg, [{ text: "OK" }]);
  };

  const joinSession = async (session: Session) => {
    if (session.status === "completed" || session.status === "cancelled") {
      notify("Session Ended", "This session has already ended.");
      return;
    }

    // Never refuse entry based on the copy of the session held in this list. A teacher can
    // start a class at any moment, and a student who tapped a card that was fetched moments
    // earlier was told "come back at [time]" while the class was already running.
    let status: Session["status"] = session.status;
    try {
      const fresh = await apiGet<{ status: string }>(`/sessions/${session.id}`);
      status = fresh.status as Session["status"];
      if (status !== session.status) {
        setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, status } : s)));
      }
    } catch {
      // Offline or the server is unreachable — fall through on what we last knew.
    }

    if (status === "completed" || status === "cancelled") {
      notify("Session Ended", "This session has already ended.");
      return;
    }

    // The server decides, because only it knows the payment state and the join window. A
    // paid student is admitted once the class is live *or* within a few minutes of the
    // scheduled start, so they can be waiting in the room when the teacher arrives instead of
    // being told to come back and refresh.
    let access: {
      canJoin: boolean;
      isEnrolled: boolean;
      hasPaid?: boolean;
      awaitingTeacher?: boolean;
      joinOpensAt?: string | null;
      joinWindowMinutes?: number;
    };
    try {
      access = await apiGet(`/sessions/${session.id}/access`);
    } catch {
      notify("Couldn't Check", "We couldn't confirm your access to this class. Please try again.");
      return;
    }

    if (!access.canJoin) {
      if (!access.isEnrolled) {
        notify("Not Booked", "You need to book this class before you can join.");
        return;
      }
      if (!access.hasPaid) {
        // Booking is atomic now, so this should be unreachable; if it ever fires, the student
        // needs a way out rather than a dead end.
        notify(
          "Payment Not Completed",
          "This booking was never paid for, so it can't be joined. Please book it again from the teacher's page — you won't be charged twice.",
        );
        return;
      }
      // Paid and waiting: tell them exactly when the door opens.
      const opens = access.joinOpensAt ? new Date(access.joinOpensAt) : null;
      const mins = access.joinWindowMinutes ?? 5;
      if (opens) {
        const t = opens.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        notify(
          "Not Open Yet",
          `"${session.topic}" opens at ${t}, ${mins} minutes before it starts.

You're booked and paid — come back then and you can wait in the room for your teacher.`,
        );
      } else {
        notify("Not Open Yet", "This class isn't open yet. You're booked — try again closer to the start time.");
      }
      return;
    }

    router.push(`/(student)/classroom/${session.id}`);
  };

  const liveSessions = sessions.filter((s) => s.status === "live");
  const upcomingSessions = sessions.filter((s) => s.status === "upcoming");
  const pastSessions = sessions.filter((s) => s.status === "completed" || s.status === "cancelled");

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
                    <SessionCard session={s} showTeacher onPress={() => joinSession(s)} />
                    <TouchableOpacity
                      style={[styles.joinBtn, { backgroundColor: colors.success }]}
                      onPress={() => joinSession(s)}
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
                  <SessionCard key={s.id} session={s} showTeacher onPress={() => joinSession(s)} />
                ))}
              </View>
            )}

            {pastSessions.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Past Sessions</Text>
                {pastSessions.map((s) => (
                  <SessionCard key={s.id} session={s} showTeacher />
                ))}
              </View>
            )}
          </View>
        }
        renderItem={() => null}
        ListEmptyComponent={
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
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  joinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: -4, marginBottom: 8 },
  joinBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  discoverBtn: { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  discoverBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
