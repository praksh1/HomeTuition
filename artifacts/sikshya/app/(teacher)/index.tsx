import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, apiPatch } from "@/utils/api";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { numeric } from "@/constants/typography";
import { desktopWorkspaceMax, marketplaceColumnMax } from "@/constants/layout";
import Skeleton from "@/components/Skeleton";
import { useNotifications } from "@/context/NotificationContext";
import { useDates } from "@/context/DatePreferenceContext";
import type { Teacher } from "@/context/AuthContext";
import { teacherAgendaPath, teacherAgendaTimeLabel } from "@/utils/teacherAgenda";

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
  const { t, gutter, space, radius, elevation, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const { format: formatDate } = useDates();
  const { unreadCount, refresh: refreshNotifs } = useNotifications();
  const teacher = user as Teacher;
  const [upcomingSessions, setUpcomingSessions] = useState<ApiSession[]>([]);
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);
  const [expiredCount, setExpiredCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const sessionSequence = useRef(0);

  useFocusEffect(
    useCallback(() => {
      refreshNotifs();
      loadSessions();
      const timer = setInterval(() => void loadSessions(true), 15_000);
      return () => { clearInterval(timer); sessionSequence.current += 1; };
    }, [teacher?.userId])
  );

  const loadSessions = async (quiet = false) => {
    if (!teacher?.userId) return;
    const sequence = ++sessionSequence.current;
    if (!quiet) setSessionsLoading(true);
    try {
      const [next, missed] = await Promise.all([
        apiGet<{ sessions: ApiSession[]; total: number }>(teacherAgendaPath(teacher.userId, "upcoming", 5)),
        apiGet<{ total: number }>(teacherAgendaPath(teacher.userId, "missed", 1)),
      ]);
      if (sequence !== sessionSequence.current) return;
      setUpcomingSessions(next.sessions);
      setUpcomingCount(Number.isSafeInteger(next.total) && next.total >= next.sessions.length ? next.total : null);
      setExpiredCount(missed.total);
      setSessionsError(false);
    } catch {
      if (sequence === sessionSequence.current) setSessionsError(true);
    } finally {
      if (sequence === sessionSequence.current) setSessionsLoading(false);
    }
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
  const formatSessionTime = (dateStr: string) => teacherAgendaTimeLabel(dateStr, formatDate);

  return (
    <ScrollView
      testID="teacher-dashboard"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + 100,
        gap: space.md,
        // Capped and centred, so a laptop gets a readable column rather than a dashboard
        // stretched across a metre of screen. A no-op on a phone.
        width: "100%",
        maxWidth: isExpanded ? desktopWorkspaceMax : marketplaceColumnMax,
        alignSelf: "center",
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* ---------------------------------------------------------------- header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Namaste,</Text>
          <Text style={[t.title1, { color: colors.foreground }]} numberOfLines={1}>
            {teacher.name}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: space.xs }}>
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border, borderRadius: radius.sm }]}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Feather name="bell" size={18} color={colors.foreground} />
            {unreadCount > 0 && (
              // Crimson, not blue: this is "something wants you", which is the one thing the
              // brand colour marks besides the logo and a live class.
              <View style={[styles.bellBadge, { backgroundColor: colors.brand, borderColor: colors.background }]}>
                <Text style={[t.overline, styles.badgeText, { color: colors.brandForeground }]}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.border, borderRadius: radius.sm }]}
            onPress={handleLogout}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ------------------------------------------------------- approval banners */}
      {isPending && (
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.warnSoft, borderColor: colors.warn, borderRadius: radius.md, padding: space.md },
          ]}
        >
          <Feather name="clock" size={18} color={colors.warn} />
          <View style={{ flex: 1 }}>
            <Text style={[t.bodyStrong, { color: colors.warn }]}>Verification pending</Text>
            <Text style={[t.callout, { color: colors.mutedForeground, marginTop: 2 }]}>
              Upload your credentials in Profile to get approved and start teaching.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/(teacher)/profile")}
            activeOpacity={0.7}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Upload</Text>
          </TouchableOpacity>
        </View>
      )}

      {isRejected && (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: colors.destructiveSoft,
              borderColor: colors.destructive,
              borderRadius: radius.md,
              padding: space.md,
            },
          ]}
        >
          <Feather name="x-circle" size={18} color={colors.destructive} />
          <View style={{ flex: 1 }}>
            <Text style={[t.bodyStrong, { color: colors.destructive }]}>Verification rejected</Text>
            <Text style={[t.callout, { color: colors.mutedForeground, marginTop: 2 }]}>
              Please re-upload valid documents in your Profile.
            </Text>
          </View>
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <Text style={[t.title2, { color: colors.foreground }]}>Your teaching day</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          Create and manage classes here. Open Schedule for lesson times and attendance.
        </Text>
        {/* --------------------------------------------------------- quick actions */}
        <View
          style={{
            flexDirection: "row",
            gap: space.sm,
            justifyContent: "center",
          }}
        >
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: space.sm },
              elevation.card,
            ]}
            onPress={() => router.push("/(teacher)/create-class")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="New class"
          >
            <Feather name="plus" size={18} color={colors.primaryForeground} />
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>New class</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { borderColor: colors.lineStrong, borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.sm },
            ]}
            onPress={() => router.push("/(teacher)/sessions")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Schedule"
          >
            <Feather name="calendar" size={18} color={colors.foreground} />
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Schedule</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/*
        The way in to Learning Programs.

        Beside the monthly class rather than in the tab bar: the bar already holds six and the note
        in `_layout.tsx` records why a seventh is a squeeze on a cheap Android. A program is the
        same shape of thing as a monthly class — written once, then lived inside — so it belongs in
        the same place, and the sentence under it says what a program is, because a teacher who has
        never made one has every reason to think it is another word for a class.
      */}
      <TouchableOpacity
        testID="teacher-programs-entry"
        style={[
          styles.monthlyEntry,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radius.md,
            padding: space.md,
            gap: space.sm,
          },
        ]}
        onPress={() => router.push("/(teacher)/teaching-classes")}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="My classes. Your teaching, timetable and price"
      >
        <View style={[styles.squareIcon, { backgroundColor: colors.actionSoft, borderRadius: radius.sm }]}>
          <Feather name="map" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[t.title3, { color: colors.foreground }]}>My classes</Text>
          <Text style={[t.callout, { color: colors.mutedForeground, marginTop: 2 }]}>
            Your teaching, timetable and price — together.
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.inkFaint} />
      </TouchableOpacity>

      {/* -------------------------------------------------------------- upcoming */}
      <View style={[styles.sectionHeader, { marginTop: space.xs }]}>
        <Text style={[t.title2, { color: colors.foreground }]}>Upcoming</Text>
        {!sessionsLoading && upcomingSessions.length > 0 && (
          <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>
            {upcomingCount !== null && upcomingCount > upcomingSessions.length
              ? `Next ${upcomingSessions.length} of ${upcomingCount} lessons`
              : `${upcomingSessions.length} ${upcomingSessions.length === 1 ? "lesson" : "lessons"}`}
          </Text>
        )}
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
          style={[
            styles.expiredNote,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              borderRadius: radius.sm,
              paddingHorizontal: space.sm,
              paddingVertical: space.sm,
              gap: space.xs,
            },
          ]}
          onPress={() => router.push("/(teacher)/sessions")}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Feather name="clock" size={15} color={colors.mutedForeground} />
          <Text style={[t.caption, { flex: 1, color: colors.mutedForeground }]}>
            {expiredCount} {expiredCount === 1 ? "class" : "classes"} passed without being started.
            Tap to see them.
          </Text>
        </TouchableOpacity>
      )}

      {/* Loading holds the shape of a class row, so nothing jumps when the real ones arrive. */}
      {sessionsLoading &&
        upcomingSessions.length === 0 &&
        [0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.sessionRow,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, gap: space.sm },
            ]}
          >
            <View style={[styles.squareIcon, { backgroundColor: colors.muted, borderRadius: radius.sm }]} />
            <View style={{ flex: 1, gap: space.xxs }}>
              <Skeleton width={64} height={10} />
              <Skeleton width="70%" height={15} />
              <Skeleton width={104} height={12} />
            </View>
          </View>
        ))}

      {sessionsError && <TouchableOpacity accessibilityRole="button" onPress={() => void loadSessions()}
        style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.warnSoft }}>
        <Text style={[t.callout, { color: colors.warn }]}>Could not refresh your schedule. Tap to try again.</Text>
      </TouchableOpacity>}
      {!sessionsLoading && !sessionsError && upcomingSessions.length === 0 && (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: space.sm },
          ]}
        >
          <Feather name="calendar" size={22} color={colors.inkFaint} />
          <Text style={[t.body, { color: colors.foreground }]}>No classes coming up</Text>
          <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>
            Create one and your students will be able to find and book it.
          </Text>
        </View>
      )}

      {upcomingSessions.map((session) => {
        const full = session.enrolledCount >= session.maxStudents;
        return (
          <TouchableOpacity
            key={session.id}
            style={[
              styles.sessionRow,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, gap: space.sm },
              elevation.card,
            ]}
            onPress={() => startSession(session)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${session.topic}, ${session.subject}, ${formatSessionTime(session.date)}`}
          >
            <View style={[styles.squareIcon, { backgroundColor: colors.actionSoft, borderRadius: radius.sm }]}>
              <Feather name="video" size={16} color={colors.primary} />
            </View>

            {/*
              Three levels, told by weight and colour rather than size alone: the subject is a
              quiet uppercase label, the topic is the thing itself, the time sits under it.
            */}
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[t.overline, { color: colors.inkFaint }]} numberOfLines={1}>
                {session.subject}
              </Text>
              <Text style={[t.title3, { color: colors.foreground }]} numberOfLines={1}>
                {session.topic}
              </Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                {formatSessionTime(session.date)}
              </Text>
            </View>

            <View style={{ alignItems: "flex-end", gap: space.xs }}>
              <View style={styles.seatRow}>
                <Feather name="users" size={12} color={full ? colors.success : colors.inkFaint} />
                <Text style={[t.caption, numeric, { color: full ? colors.success : colors.inkFaint }]}>
                  {session.enrolledCount}/{session.maxStudents}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.startBtn,
                  { backgroundColor: colors.primary, borderRadius: radius.xs, paddingHorizontal: space.sm, gap: space.xxs },
                ]}
                onPress={() => startSession(session)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Start ${session.topic}`}
              >
                <Feather name="play" size={11} color={colors.primaryForeground} />
                <Text style={[t.caption, { color: colors.primaryForeground }]}>Start</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        testID="teacher-earnings-entry"
        accessibilityRole="button"
        accessibilityLabel="Earnings history. Payment records and payout information"
        onPress={() => router.push("/(teacher)/subscription")}
        style={[styles.monthlyEntry, { borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, gap: space.sm }]}
      >
        <Feather name="credit-card" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Earnings history</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Payment records, pending earnings and payouts</Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.inkFaint} />
      </TouchableOpacity>
    </ScrollView>
  );
}

/**
 * Only what does not depend on a token or the screen size.
 *
 * Colours, spacing, radii and type all arrive from `useColors()` and `useLayout()` at render
 * time, so they cannot live in a StyleSheet created once at module load. What is left here is
 * structure — the things that are true at every size, in every palette.
 */
const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  iconBtn: { width: 44, height: 44, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  bellBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  // The overline step carries uppercase and tracking; a two-digit badge needs neither.
  badgeText: { letterSpacing: 0, textTransform: "none" },

  banner: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1 },

  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
  },

  monthlyEntry: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  squareIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  expiredNote: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth },

  emptyCard: { alignItems: "center", borderWidth: StyleSheet.hairlineWidth },

  sessionRow: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  seatRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  startBtn: { flexDirection: "row", alignItems: "center", minHeight: 32, justifyContent: "center" },
});
