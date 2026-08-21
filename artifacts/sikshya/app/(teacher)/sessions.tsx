import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import { canOpenSession } from "@/utils/sessionWindow";
import SessionCard from "@/components/SessionCard";
import { useColors } from "@/hooks/useColors";
import type { Teacher } from "@/context/AuthContext";

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

type FilterTab = "all" | "upcoming" | "live" | "completed";

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
    const statusParam = filter === "all" ? "" : `&status=${filter}`;
    try {
      const res = await apiGet<{ sessions: { id: number; teacherName: string; subject: string; topic: string; date: string; duration: number; maxStudents: number; enrolledCount: number; price: number; status: string }[] }>(
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

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "upcoming", label: "Upcoming" },
    { key: "completed", label: "Completed" },
  ];

  // The server has already filtered by status; sifting again here is what made the tab wrong.
  const filtered = sessions;

  /**
   * Opening a class from this list.
   *
   * This used to push straight into the classroom with no check at all, which is how a class
   * from three days ago could be tapped and start a video call: the classroom asks the server
   * for a room the moment it mounts, the server created one, and the phone asked for camera
   * and microphone. The refusal happens here, before any of that — decided from the date and
   * length already in this list, so it is immediate and needs no round trip.
   */
  const openSession = (item: Session) => {
    const check = canOpenSession(item);
    if (!check.ok) {
      if (Platform.OS === "web") window.alert(`${check.title}\n\n${check.message}`);
      else Alert.alert(check.title, check.message, [{ text: "OK" }]);
      return;
    }
    router.push(`/(teacher)/classroom/${item.id}`);
  };

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

      <View style={styles.tabs}>
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
      </View>

      <FlatList
        data={filtered}
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
              {filter === "all" ? "No sessions yet" : `No ${filter} sessions`}
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
  createBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  tabs: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  tab: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#F4F4F0" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { paddingHorizontal: 20, paddingTop: 8 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
