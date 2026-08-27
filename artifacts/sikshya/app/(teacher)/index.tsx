import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, apiPatch } from "@/utils/api";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { numeric } from "@/constants/typography";
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

/** What `GET /teachers/me/allowance` sends back. */
interface Allowance {
  tier: string;
  tierName: string;
  limit: number;
  used: number;
  remaining: number;
  price: number;
}

/**
 * A grey bar where text will be.
 *
 * Cheaper than it looks: the opacity loop runs on the native driver, so it never touches the
 * JavaScript thread and costs nothing on the budget Android this app is built for. Worth having
 * over a plain spinner because it holds the shape of what is coming — the layout does not jump
 * when the numbers land, which is most of what "fast" feels like on a poor connection.
 */
function Skeleton({ width, height = 14, tint }: { width: number | string; height?: number; tint: string }) {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={{ width: width as number, height, borderRadius: 6, backgroundColor: tint, opacity: pulse }}
    />
  );
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
  const [expiredCount, setExpiredCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  /**
   * The real allowance, from the server.
   *
   * This used to read `teacher.sessionsThisMonth` against a hard-coded ten. That column has
   * never been written to since registration set it to zero, so every teacher on every plan was
   * shown "0/10 Sessions" for ever — and the upgrade nudge below, which fires at eight, could
   * never fire at all. Null until it loads, so nothing invents a number in the meantime.
   */
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  /**
   * Loading and failed are different states and must look different.
   *
   * Without this the card cannot tell "we have not asked yet" from "we asked and could not
   * reach the server", and both would render the same placeholder — which is how a teacher ends
   * up staring at a dash wondering whether it is a spinner or an answer.
   */
  const [allowanceLoading, setAllowanceLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      refreshNotifs();
      loadSessions();
      loadAllowance();
    }, [teacher?.userId])
  );

  const loadAllowance = async () => {
    setAllowanceLoading(true);
    try {
      setAllowance(await apiGet<Allowance>("/teachers/me/allowance"));
    } catch {
      // A dashboard that cannot reach the server should show nothing here rather than a zero,
      // which reads as "you have used none of your classes" and is a different claim.
      setAllowance(null);
    }
    setAllowanceLoading(false);
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

  // Ink for the navy card. Tokens rather than white-at-an-opacity: an alpha over a gradient
  // lands on a different colour at each end, and can pass contrast on one side and fail the
  // other. Both of these are measured against both ends.
  const onNavy = { color: colors.onInverse };
  const onNavyMuted = { color: colors.onInverseMuted };

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

  /** A stat on the navy card. Its own component so the three cannot drift apart. */
  const Stat = ({ children, label }: { children: React.ReactNode; label: string }) => (
    <View style={styles.stat}>
      <View style={styles.statValue}>{children}</View>
      <Text style={[t.caption, onNavyMuted]} numberOfLines={1}>{label}</Text>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + 100,
        gap: space.md,
        // Capped and centred, so a laptop gets a readable column rather than a dashboard
        // stretched across a metre of screen. A no-op on a phone.
        width: "100%",
        maxWidth: 760,
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

      {/*
        On a laptop the summary and the two buttons sit side by side; on a phone they stack.
        Same components either way — the screen is given more room, not redesigned.
      */}
      <View style={{ flexDirection: isExpanded ? "row" : "column", gap: space.md, alignItems: "stretch" }}>
        {/* ------------------------------------------------------------ this month */}
        <LinearGradient
          // Navy into the action blue. The card is a *surface*, so it does not use crimson —
          // and both ends carry white text well above AA.
          colors={[colors.secondary, colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.statsCard, { borderRadius: radius.lg, padding: space.lg, gap: space.md, flex: isExpanded ? 1.4 : undefined }]}
        >
          <View style={styles.statsHead}>
            <Text style={[t.overline, onNavyMuted]}>This month</Text>
            {allowance && (
              <Text style={[t.caption, onNavyMuted]}>
                {allowance.tierName} · NPR {allowance.price.toLocaleString()}
              </Text>
            )}
          </View>

          <View style={styles.statsRow}>
            <Stat label="Classes">
              {allowanceLoading ? (
                <Skeleton width={54} height={22} tint={colors.onInverseMuted} />
              ) : allowance ? (
                <Text style={[t.title1, numeric, onNavy]}>
                  {allowance.used}
                  <Text style={[t.title3, onNavyMuted]}>/{allowance.limit}</Text>
                </Text>
              ) : (
                <Text style={[t.title3, onNavyMuted]}>Unavailable</Text>
              )}
            </Stat>

            <View style={[styles.statDivider, { backgroundColor: colors.onInverseMuted }]} />

            <Stat label="Students">
              <Text style={[t.title1, numeric, onNavy]}>{teacher.totalStudents}</Text>
            </Stat>

            <View style={[styles.statDivider, { backgroundColor: colors.onInverseMuted }]} />

            {/*
              Earnings are not tracked yet.

              `monthly_earnings` is written once, to zero, at registration and never again — so
              this tile has been telling every teacher they earned NPR 0k since the app was
              built. A fabricated zero about money is the worst kind of placeholder, because it
              is indistinguishable from a real answer. It says what it actually knows instead,
              and starts working the day payments do.
            */}
            <Stat label="Earned · soon">
              <Text style={[t.title1, numeric, onNavyMuted]}>—</Text>
            </Stat>
          </View>

          {allowance && allowance.remaining > 0 && (
            <View style={styles.planBadge}>
              <Feather name="shield" size={13} color={colors.onInverseMuted} />
              <Text style={[t.caption, onNavyMuted]}>
                {allowance.remaining} more {allowance.remaining === 1 ? "class" : "classes"} on this plan
              </Text>
            </View>
          )}
        </LinearGradient>

        {/* --------------------------------------------------------- quick actions */}
        <View
          style={{
            flexDirection: isExpanded ? "column" : "row",
            gap: space.sm,
            flex: isExpanded ? 1 : undefined,
            justifyContent: "center",
          }}
        >
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: space.sm },
              elevation.card,
            ]}
            onPress={() => router.push("/(teacher)/session-create")}
            activeOpacity={0.85}
            accessibilityRole="button"
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
          >
            <Feather name="calendar" size={18} color={colors.foreground} />
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>View all</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/*
        The way in to the monthly class.

        A full-width row rather than a third small button: it is a different kind of thing from
        "New class" — a class that runs every day for a month — and a teacher who has one lives
        in it. It reads as an offer until they have one, and as a door afterwards.
      */}
      <TouchableOpacity
        testID="teacher-monthly-entry"
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
        onPress={() => router.push("/(teacher)/monthly")}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <View style={[styles.squareIcon, { backgroundColor: colors.actionSoft, borderRadius: radius.sm }]}>
          <Feather name="repeat" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[t.title3, { color: colors.foreground }]}>Monthly class</Text>
          <Text style={[t.callout, { color: colors.mutedForeground, marginTop: 2 }]}>
            Teach the same class every day. Students buy the month.
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.inkFaint} />
      </TouchableOpacity>

      {/* -------------------------------------------------------------- upcoming */}
      <View style={[styles.sectionHeader, { marginTop: space.xs }]}>
        <Text style={[t.title2, { color: colors.foreground }]}>Upcoming</Text>
        {!sessionsLoading && upcomingSessions.length > 0 && (
          <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>
            {upcomingSessions.length} {upcomingSessions.length === 1 ? "class" : "classes"}
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
              <Skeleton width={64} height={10} tint={colors.muted} />
              <Skeleton width="70%" height={15} tint={colors.muted} />
              <Skeleton width={104} height={12} tint={colors.muted} />
            </View>
          </View>
        ))}

      {!sessionsLoading && upcomingSessions.length === 0 && (
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

      {/*
        Warn near the limit, not at a fixed eight — eight of ten is worth a word and eight of
        thirty is not. Two left is the point at which a teacher can still act on it.

        Amber while there is room to act, rust once the plan is spent: running out is a
        different message from running low, and they should not look the same.
      */}
      {teacher.approvalStatus === "approved" && allowance !== null && allowance.remaining <= 2 && (
        <TouchableOpacity
          style={[
            styles.banner,
            {
              backgroundColor: allowance.remaining === 0 ? colors.destructiveSoft : colors.warnSoft,
              borderColor: allowance.remaining === 0 ? colors.destructive : colors.warn,
              borderRadius: radius.md,
              padding: space.sm,
              alignItems: "center",
            },
          ]}
          onPress={() => router.push("/(teacher)/subscription")}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Feather
            name="alert-triangle"
            size={15}
            color={allowance.remaining === 0 ? colors.destructive : colors.warn}
          />
          <Text
            style={[
              t.caption,
              { flex: 1, color: allowance.remaining === 0 ? colors.destructive : colors.warn },
            ]}
          >
            {allowance.remaining === 0
              ? `All ${allowance.limit} classes on your ${allowance.tierName} plan are used.`
              : `${allowance.remaining} ${allowance.remaining === 1 ? "class" : "classes"} left on your ${allowance.tierName} plan.`}
          </Text>
          <Text style={[t.caption, { color: colors.primary }]}>Upgrade</Text>
        </TouchableOpacity>
      )}
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

  statsCard: { justifyContent: "center" },
  statsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  statsRow: { flexDirection: "row", alignItems: "stretch" },
  stat: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { minHeight: 30, justifyContent: "center", alignItems: "center" },
  statDivider: { width: StyleSheet.hairlineWidth },
  planBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
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
