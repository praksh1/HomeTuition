import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, apiPatch } from "@/utils/api";
import { useColors } from "@/hooks/useColors";
import { useNotifications } from "@/context/NotificationContext";
import { useDates } from "@/context/DatePreferenceContext";
import type { Teacher } from "@/context/AuthContext";

interface ApiSession {
  id: number;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledCount: number;
  status: string;
  /** Over, and never started. Worked out by the server from the clock. */
  expired?: boolean;
}

export default function TeacherDashboard() {
  const { user, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { format: formatDate } = useDates();
  const { unreadCount, refresh: refreshNotifs } = useNotifications();
  const teacher = user as Teacher;
  const [upcomingSessions, setUpcomingSessions] = useState<ApiSession[]>([]);
  const [expiredCount, setExpiredCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  /**
   * The real allowance, from the server.
   *
   * This used to read `teacher.sessionsThisMonth` against a hard-coded ten. That column has
   * never been written to since registration set it to zero, so every teacher on every plan was
   * shown "0/10 Sessions" for ever — and the upgrade nudge below, which fires at eight, could
   * never fire at all. Null until it loads, so nothing invents a number in the meantime.
   */
  const [allowance, setAllowance] = useState<{ used: number; limit: number; tierName: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshNotifs();
      loadSessions();
      loadAllowance();
    }, [teacher?.userId])
  );

  const loadAllowance = async () => {
    try {
      setAllowance(await apiGet<{ used: number; limit: number; tierName: string }>("/teachers/me/allowance"));
    } catch {
      // A dashboard that cannot reach the server should show nothing here rather than a zero,
      // which reads as "you have used none of your classes" and is a different claim.
      setAllowance(null);
    }
  };

  const loadSessions = async () => {
    if (!teacher?.userId) return;
    setSessionsLoading(true);
    try {
      /*
       * More than five are asked for, because some of them are not upcoming.
       *
       * A class nobody started keeps `status = 'upcoming'` for ever, so the five newest could
       * all be from last week — which is what a teacher was looking at: classes from days ago,
       * each with a Start button that refuses when pressed. They are dropped here and shown in
       * their own section on the Sessions tab instead.
       */
      const res = await apiGet<{ sessions: ApiSession[] }>(
        `/sessions?teacherId=${teacher.userId}&status=upcoming&limit=40`
      );
      const stillToCome = (res.sessions ?? []).filter((session) => !session.expired);
      setUpcomingSessions(
        [...stillToCome].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 5),
      );
      setExpiredCount((res.sessions ?? []).length - stillToCome.length);
    } catch {}
    setSessionsLoading(false);
  };

  const startSession = async (session: ApiSession) => {
    try {
      await apiPatch(`/sessions/${session.id}`, { status: "live" });
    } catch (err) {
      // Walking into the classroom anyway is what hid this: the class never went live, the
      // teacher taught to a room nobody could enter, and nothing said so. A refusal is now
      // shown and the navigation does not happen.
      const message =
        err instanceof ApiError && err.status === 409
          ? err.message
          : "That class could not be started. Please check your connection and try again.";

      /**
       * "You are already teaching X" is only half an answer without a way to X.
       *
       * A teacher whose browser had crashed was told they had an active session, could not
       * start a new one, and was given no route back to the old one either. The refusal
       * carries the class it means, so the offer can be made directly.
       */
      const runningId = err instanceof ApiError ? err.data.liveSessionId : undefined;
      if (typeof runningId === "number") {
        const goBack = `${message}\n\nOpen that class now?`;
        if (Platform.OS === "web") {
          if (window.confirm(goBack)) router.push(`/(teacher)/classroom/${runningId}`);
        } else {
          Alert.alert("You are already teaching", goBack, [
            { text: "Not now", style: "cancel" },
            { text: "Open it", onPress: () => router.push(`/(teacher)/classroom/${runningId}`) },
          ]);
        }
        return;
      }

      if (Platform.OS === "web") window.alert(`Cannot start this class\n\n${message}`);
      else Alert.alert("Cannot start this class", message);
      return;
    }
    router.push(`/(teacher)/classroom/${session.id}`);
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/welcome");
  };

  if (!teacher) return null;

  const isPending = teacher.approvalStatus === "pending";
  const isRejected = teacher.approvalStatus === "rejected";

  /**
   * The date in the reader's own calendar.
   *
   * This wrote `toLocaleDateString("en-NP")`, which is a Gregorian date with a Nepali locale —
   * so a teacher who had chosen Bikram Sambat everywhere else met "Aug 24" on the one screen
   * they open every day. "Today" and "Tomorrow" are kept: they are the same word in both
   * calendars and are easier to read than either.
   */
  const formatSessionTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 0) return `Today, ${timeStr}`;
    if (diffDays === 1) return `Tomorrow, ${timeStr}`;
    return `${formatDate(d, { withTime: false })}, ${timeStr}`;
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Namaste,</Text>
          <Text style={[styles.name, { color: colors.foreground }]}>{teacher.name}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border }]}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={18} color={colors.foreground} />
            {unreadCount > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.bellBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border }]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {isPending && (
        <View style={[styles.alertBanner, { backgroundColor: colors.accent + "15", borderColor: colors.accent + "40" }]}>
          <Feather name="clock" size={18} color={colors.accent} />
          <View style={styles.alertText}>
            <Text style={[styles.alertTitle, { color: "#B45309" }]}>Verification Pending</Text>
            <Text style={[styles.alertBody, { color: "#92400E" }]}>
              Upload your credentials in Profile to get approved and start teaching.
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(teacher)/profile")} activeOpacity={0.7}>
            <Text style={[styles.alertAction, { color: colors.accent }]}>Upload</Text>
          </TouchableOpacity>
        </View>
      )}

      {isRejected && (
        <View style={[styles.alertBanner, { backgroundColor: colors.destructive + "10", borderColor: colors.destructive + "30" }]}>
          <Feather name="x-circle" size={18} color={colors.destructive} />
          <View style={styles.alertText}>
            <Text style={[styles.alertTitle, { color: colors.destructive }]}>Verification Rejected</Text>
            <Text style={[styles.alertBody, { color: colors.mutedForeground }]}>
              Please re-upload valid documents in your Profile.
            </Text>
          </View>
        </View>
      )}

      <LinearGradient
        colors={[colors.primary, "#8B0000"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statsCard}
      >
        <Text style={styles.statsTitle}>This Month</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{allowance ? `${allowance.used}/${allowance.limit}` : "—"}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{teacher.totalStudents}</Text>
            <Text style={styles.statLabel}>Students</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>NPR {(teacher.monthlyEarnings / 1000).toFixed(0)}k</Text>
            <Text style={styles.statLabel}>Earned</Text>
          </View>
        </View>
        <View style={[styles.planBadge, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Feather name="shield" size={13} color="#fff" />
          <Text style={styles.planBadgeText}>Pro Plan · NPR 2,000/mo</Text>
        </View>
      </LinearGradient>

      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/(teacher)/session-create")}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={styles.actionBtnText}>New Session</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtnOutline, { borderColor: colors.border }]}
          onPress={() => router.push("/(teacher)/sessions")}
          activeOpacity={0.85}
        >
          <Feather name="calendar" size={18} color={colors.foreground} />
          <Text style={[styles.actionBtnOutlineText, { color: colors.foreground }]}>View All</Text>
        </TouchableOpacity>
      </View>

      {/*
        The way in to the monthly class.

        A full-width row rather than a third small button: it is a different kind of thing from
        "New Session" — a class that runs every day for a month — and a teacher who has one
        lives in it. It reads as an offer until they have one, and as a door afterwards.
      */}
      <TouchableOpacity
        testID="teacher-monthly-entry"
        style={[styles.monthlyEntry, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push("/(teacher)/monthly")}
        activeOpacity={0.85}
      >
        <View style={[styles.monthlyIcon, { backgroundColor: colors.primary + "14" }]}>
          <Feather name="repeat" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.monthlyTitle, { color: colors.foreground }]}>Monthly class</Text>
          <Text style={[styles.monthlySub, { color: colors.mutedForeground }]}>
            Teach the same class every day. Students buy the month.
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upcoming Sessions</Text>
        {sessionsLoading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {/*
        Said, not silently dropped.

        Classes that are over and were never started used to fill this list. Removing them
        without a word would leave a teacher looking at an empty dashboard wondering where a
        fortnight of classes went, so the count is shown with a way to reach them.
      */}
      {expiredCount > 0 && (
        <TouchableOpacity
          testID="teacher-expired-note"
          style={[styles.expiredNote, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/(teacher)/sessions")}
          activeOpacity={0.8}
        >
          <Feather name="clock" size={15} color={colors.mutedForeground} />
          <Text style={[styles.expiredNoteText, { color: colors.mutedForeground }]}>
            {expiredCount} {expiredCount === 1 ? "class" : "classes"} passed without being started.
            Tap to see them.
          </Text>
        </TouchableOpacity>
      )}

      {!sessionsLoading && upcomingSessions.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="calendar" size={24} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No upcoming sessions. Create one to start teaching!
          </Text>
        </View>
      )}

      {upcomingSessions.map((session) => (
        <TouchableOpacity
          key={session.id}
          style={[styles.sessionRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => startSession(session)}
          activeOpacity={0.7}
        >
          <View style={[styles.sessionDot, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="video" size={16} color={colors.primary} />
          </View>
          <View style={styles.sessionInfo}>
            <Text style={[styles.sessionSubject, { color: colors.primary }]}>{session.subject}</Text>
            <Text style={[styles.sessionTopic, { color: colors.foreground }]} numberOfLines={1}>
              {session.topic}
            </Text>
            <Text style={[styles.sessionTime, { color: colors.mutedForeground }]}>
              {formatSessionTime(session.date)}
            </Text>
          </View>
          <View style={styles.sessionRight}>
            <Text style={[styles.studentCount, { color: colors.mutedForeground }]}>
              {session.enrolledCount}/{session.maxStudents}
            </Text>
            <Feather name="users" size={13} color={colors.mutedForeground} />
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: colors.primary }]}
              onPress={() => startSession(session)}
              activeOpacity={0.8}
            >
              <Feather name="play" size={12} color="#fff" />
              <Text style={styles.startBtnText}>Start</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ))}

      {/*
        * Warn near the limit, not at a fixed eight — eight of ten is worth a word and eight of
        * thirty is not. Two left is the point at which a teacher can still act on it.
        */}
      {teacher.approvalStatus === "approved" && allowance !== null && allowance.used >= allowance.limit - 2 && (
        <View style={[styles.warningBanner, { backgroundColor: colors.destructive + "10", borderColor: colors.destructive + "20" }]}>
          <Feather name="alert-triangle" size={15} color={colors.destructive} />
          <Text style={[styles.warningText, { color: colors.destructive }]}>
            {allowance.used >= allowance.limit
              ? `You've used all ${allowance.limit} classes on your ${allowance.tierName} plan for this 30 days. Upgrade for more.`
              : `You've used ${allowance.used} of ${allowance.limit} classes on your ${allowance.tierName} plan. Upgrade for more.`}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting: { fontSize: 14, fontFamily: "Inter_400Regular" },
  name: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  bellBadge: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, justifyContent: "center", alignItems: "center", paddingHorizontal: 3 },
  bellBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  alertBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  alertText: { flex: 1 },
  alertTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  alertBody: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  alertAction: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  statsCard: { borderRadius: 20, padding: 20, gap: 16 },
  statsTitle: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#ffffff99" },
  statsRow: { flexDirection: "row", justifyContent: "space-around" },
  stat: { alignItems: "center", gap: 4 },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#ffffff99" },
  statDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)" },
  planBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  planBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#fff" },
  quickActions: { flexDirection: "row", gap: 12 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  actionBtnOutline: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, borderWidth: 1 },
  actionBtnOutlineText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  expiredNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  expiredNoteText: { flex: 1, fontSize: 12.5, fontFamily: "Inter_400Regular", lineHeight: 17 },
  monthlyEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  monthlyIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  monthlyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  monthlySub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  emptyText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, padding: 14 },
  sessionDot: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  sessionInfo: { flex: 1, gap: 2 },
  sessionSubject: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  sessionTopic: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sessionTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sessionRight: { alignItems: "center", gap: 6 },
  studentCount: { fontSize: 13, fontFamily: "Inter_500Medium" },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  startBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  warningBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  warningText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
});
