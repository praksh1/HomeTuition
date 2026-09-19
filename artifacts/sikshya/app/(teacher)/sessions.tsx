import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  HIT_SLOP_MIN,
  bottomNavClearance,
  desktopWorkspaceMax,
  marketplaceColumnMax,
} from "@/constants/layout";
import type { Teacher } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import { notificationClock, notificationGroupLabel, nepalDayKey } from "@/utils/notificationCenter";

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
  expired?: boolean;
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
type AgendaItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "lesson"; key: string; session: Session };

const SESSION_POLL_MS = 15_000;

type ApiSession = {
  id: number;
  teacherName: string;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledCount: number;
  price: number;
  status: string;
  expired?: boolean;
  testClass?: boolean;
  testClassLabel?: string;
  classGroup?: Session["classGroup"];
};

function mapSession(row: ApiSession, teacherId: number): Session {
  return {
    id: String(row.id),
    teacherId: String(teacherId),
    teacherName: row.teacherName,
    subject: row.subject,
    topic: row.topic,
    date: row.date,
    duration: row.duration,
    maxStudents: row.maxStudents,
    enrolledStudents: Array(row.enrolledCount).fill(""),
    price: row.price,
    status: row.status as Session["status"],
    expired: row.expired === true,
    testClass: row.testClass === true,
    testClassLabel: row.testClassLabel,
    classGroup: row.classGroup,
  };
}

export default function TeacherSessions() {
  const { user } = useAuth();
  const teacher = user as Teacher;
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const { t, numeric, radius, space, gutter, isExpanded } = useLayout();
  const [mode, setMode] = useState<ViewMode>("upcoming");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestSequence = useRef(0);

  const loadSessions = useCallback(async (quiet = false) => {
    if (!teacher?.userId) return;
    // A slow Upcoming response must not arrive after a quick tap on Live and repaint the wrong
    // agenda beneath the selected filter. State updates alone cannot order network answers.
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    setLoadError(false);
    const read = (status: string) => apiGet<{ sessions: ApiSession[] }>(
      `/sessions?teacherId=${teacher.userId}&status=${status}&limit=100`,
    );
    try {
      if (mode === "history") {
        const [completed, cancelled, pending] = await Promise.all([
          read("completed"),
          read("cancelled"),
          read("upcoming"),
        ]);
        const history = [
          ...completed.sessions,
          ...cancelled.sessions,
          ...pending.sessions.filter((row) => row.expired),
        ];
        if (sequence === requestSequence.current) {
          setSessions(history.map((row) => mapSession(row, teacher.userId)));
        }
      } else {
        const response = await read(mode);
        const rows = mode === "upcoming"
          ? response.sessions.filter((row) => !row.expired)
          : response.sessions;
        if (sequence === requestSequence.current) {
          setSessions(rows.map((row) => mapSession(row, teacher.userId)));
        }
      }
    } catch {
      if (!quiet && sequence === requestSequence.current) {
        setLoadError(true);
        setSessions([]);
      }
    } finally {
      if (!quiet && sequence === requestSequence.current) setLoading(false);
    }
  }, [mode, teacher?.userId]);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
      const timer = setInterval(() => void loadSessions(true), SESSION_POLL_MS);
      return () => clearInterval(timer);
    }, [loadSessions]),
  );

  const agenda = useMemo<AgendaItem[]>(() => {
    const ordered = sessions.slice().sort((left, right) => {
      const difference = new Date(left.date).getTime() - new Date(right.date).getTime();
      return mode === "history" ? -difference : difference;
    });
    const result: AgendaItem[] = [];
    let previousDay = "";
    for (const session of ordered) {
      const day = nepalDayKey(session.date);
      if (day !== previousDay) {
        result.push({
          kind: "day",
          key: `day-${day}`,
          label: notificationGroupLabel(
            day,
            Date.now(),
            (value) => dates.format(value, { withWeekday: true, withTime: false }),
          ),
        });
        previousDay = day;
      }
      result.push({ kind: "lesson", key: `lesson-${session.id}`, session });
    }
    return result;
  }, [dates, mode, sessions]);

  const views: Array<{ id: ViewMode; label: string }> = [
    { id: "upcoming", label: "Upcoming" },
    { id: "live", label: "Live" },
    { id: "history", label: "History" },
  ];

  const lessonStatus = (session: Session) => {
    if (session.status === "live") return { label: "Live now", ink: colors.brand, fill: colors.brandSoft };
    if (session.status === "cancelled") return { label: "Cancelled", ink: colors.destructive, fill: colors.destructiveSoft };
    if (session.expired) return { label: "Not held", ink: colors.destructive, fill: colors.destructiveSoft };
    if (session.status === "completed") return { label: "Completed", ink: colors.success, fill: colors.successSoft };
    return { label: "Upcoming", ink: colors.primary, fill: colors.actionSoft };
  };

  const emptyTitle = mode === "live"
    ? "Nothing is live right now"
    : mode === "history"
      ? "No teaching history yet"
      : "Your schedule is open";
  const emptyMessage = mode === "upcoming"
    ? "Create a class and its lesson dates will appear here."
    : mode === "live"
      ? "A lesson moves here automatically when you start it."
      : "Completed, cancelled and missed lessons will stay here for your records.";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        testID="teacher-schedule-list"
        data={agenda}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{
          width: "100%",
          maxWidth: isExpanded ? desktopWorkspaceMax : marketplaceColumnMax,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + bottomNavClearance,
          gap: space.xs,
        }}
        ListHeaderComponent={(
          <View testID="teacher-schedule-content" style={{ gap: space.lg, marginBottom: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ flex: 1, gap: space.xxs }}>
                <Text style={[t.title1, { color: colors.foreground }]}>Teaching schedule</Text>
                <Text style={[t.callout, { color: colors.mutedForeground }]}>Each lesson, in the order you will teach it.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a new class"
                onPress={() => router.push("/(teacher)/create-class")}
                style={{
                  minHeight: HIT_SLOP_MIN,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  backgroundColor: colors.primary,
                }}
              >
                <Feather name="plus" size={18} color={colors.primaryForeground} />
                <Text style={[t.caption, { color: colors.primaryForeground }]}>New class</Text>
              </Pressable>
            </View>

            <View
              testID="teacher-filter-row"
              style={{ flexDirection: "row", gap: space.xxs, padding: space.xxs, borderRadius: radius.pill, backgroundColor: colors.muted }}
            >
              {views.map((view) => {
                const selected = mode === view.id;
                return (
                  <Pressable
                    key={view.id}
                    testID={`teacher-group-${view.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    aria-pressed={selected}
                    onPress={() => setMode(view.id)}
                    style={{
                      minHeight: HIT_SLOP_MIN,
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.pill,
                      backgroundColor: selected ? colors.card : colors.muted,
                    }}
                  >
                    <Text style={[t.caption, { color: selected ? colors.primary : colors.mutedForeground }]}>{view.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        renderItem={({ item }) => {
          if (item.kind === "day") {
            return (
              <Text accessibilityRole="header" style={[t.overline, { color: colors.mutedForeground, marginTop: space.md, marginBottom: space.xxs }]}>
                {item.label}
              </Text>
            );
          }
          const session = item.session;
          const status = lessonStatus(session);
          const classTitle = session.classGroup?.title ?? session.topic;
          const lessonLabel = session.classGroup
            ? `Lesson ${session.classGroup.lessonPosition + 1} of ${session.classGroup.lessonCount}`
            : "One-time lesson";
          return (
            <Pressable
              testID={`teacher-session-${session.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${classTitle}, ${lessonLabel}`}
              onPress={() => router.push(`/session/${session.id}`)}
              style={{
                minHeight: HIT_SLOP_MIN * 2,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.md,
                borderWidth: 1,
                borderColor: session.status === "live" ? colors.brand : colors.border,
                borderRadius: radius.md,
                backgroundColor: colors.card,
              }}
            >
              <View style={{ minWidth: 72, gap: space.xxs }}>
                <Text style={[t.bodyStrong, numeric, { color: session.status === "live" ? colors.brand : colors.foreground }]}>
                  {notificationClock(session.date).replace(" Nepal time", "")}
                </Text>
                <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{session.duration} min</Text>
              </View>
              <View style={{ flex: 1, gap: space.xxs }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
                  <Text style={[t.title3, { flex: 1, color: colors.foreground }]} numberOfLines={2}>{classTitle}</Text>
                  <View style={{ paddingHorizontal: space.xs, paddingVertical: space.xxs, borderRadius: radius.pill, backgroundColor: status.fill }}>
                    <Text style={[t.overline, { color: status.ink }]}>{status.label}</Text>
                  </View>
                </View>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>{lessonLabel} · {session.subject}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xxs }}>
                  <Feather name="users" size={14} color={colors.inkFaint} />
                  <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>
                    {session.enrolledStudents.length} enrolled
                  </Text>
                  {session.testClass ? <Text style={[t.caption, { color: colors.warn }]}> · Test class</Text> : null}
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={colors.inkFaint} />
            </Pressable>
          );
        }}
        ListEmptyComponent={loading ? (
          <View style={{ minHeight: 240, alignItems: "center", justifyContent: "center", gap: space.sm }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading your schedule…</Text>
          </View>
        ) : loadError ? (
          <View style={{ minHeight: 240, alignItems: "center", justifyContent: "center", gap: space.sm }}>
            <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.destructiveSoft }}>
              <Feather name="wifi-off" size={22} color={colors.destructive} />
            </View>
            <Text style={[t.title3, { color: colors.foreground }]}>Your schedule could not be loaded</Text>
            <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>Nothing was removed. Check your connection and try again.</Text>
            <Pressable accessibilityRole="button" onPress={() => void loadSessions()} style={{ minHeight: HIT_SLOP_MIN, paddingHorizontal: space.md, justifyContent: "center" }}>
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ minHeight: 260, alignItems: "center", justifyContent: "center", gap: space.sm }}>
            <View style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.actionSoft }}>
              <Feather name="calendar" size={25} color={colors.primary} />
            </View>
            <Text style={[t.title2, { color: colors.foreground, textAlign: "center" }]}>{emptyTitle}</Text>
            <Text style={[t.callout, { maxWidth: 360, color: colors.mutedForeground, textAlign: "center" }]}>{emptyMessage}</Text>
            {mode === "upcoming" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(teacher)/create-class")}
                style={{ minHeight: HIT_SLOP_MIN, marginTop: space.xs, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}
              >
                <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Create a class</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}
