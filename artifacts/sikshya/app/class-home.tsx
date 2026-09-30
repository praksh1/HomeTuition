import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { ProgramNotice } from "@/components/programs/ProgramPieces";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { useNotifications } from "@/context/NotificationContext";
import { apiGet } from "@/utils/api";
import { classHomeworkOverview } from "@/utils/classHomeworkOverview";
import { classLessonJourney } from "@/utils/classLessonJourney";
import type { ClassJourneyDisplayLesson } from "@/utils/classLessonJourney";
import { batchDateValue, lessonDraft } from "@/utils/programBatches";
import { serverNow } from "@/utils/sessionClock";
import {
  lessonHistoryLabel,
  type LessonAttendanceState,
} from "@/utils/lessonHistory";
import {
  remedyQuotaLabel,
  remedyStatusLabel,
  type RemedyList,
} from "@/utils/lessonRemedyView";

interface Home {
  title: string;
  isTeacher: boolean;
  serverNow: string;
  lessons: Array<{
    position: number;
    sessionId: number;
    startsAt: string;
    durationMinutes: number;
    status?: string;
    attendance?: LessonAttendanceState;
  }>;
  counts: {
    messages: number;
    unreadMessages: number;
    homework: number;
    homeworkToDo: number;
    homeworkLate: number;
    homeworkAwaitingReview: number;
    materials: number;
    students: number;
  };
}

interface HomeCard {
  icon: ComponentProps<typeof Feather>["name"];
  label: string;
  note: string;
  unread: number;
  badgeLabel: string;
  path: string;
  withBatch: boolean;
}

export default function ClassHomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space, numeric, radius } = useLayout();
  const dates = useDates();
  const { lastEvent } = useNotifications();
  const [home, setHome] = useState<Home | null>(null);
  const [problem, setProblem] = useState("");
  const [remedies, setRemedies] = useState<RemedyList | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showPrevious, setShowPrevious] = useState(false);
  const receivedAt = useRef(Date.now());
  const [tick, setTick] = useState(Date.now());
  const load = useCallback(async () => {
    try {
      const next = await apiGet<Home>(`/class-groups/${batchId}`);
      receivedAt.current = Date.now();
      setTick(receivedAt.current);
      setHome(next);
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load this class.");
    }
  }, [batchId]);
  useFocusEffect(
    useCallback(() => {
      void load();
      let current = true;
      void apiGet<RemedyList>(`/class-groups/${batchId}/remedies`)
        .then((result) => {
          if (current) setRemedies(result);
        })
        .catch(() => {
          if (current) setRemedies(null);
        });
      return () => {
        current = false;
      };
    }, [batchId, load]),
  );
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      (lastEvent?.kind === "class_message" ||
        lastEvent?.kind === "makeup_update" ||
        lastEvent?.kind.startsWith("class_homework_")) &&
      Number(lastEvent.batchId) === batchId
    ) {
      void load();
      if (lastEvent?.kind === "makeup_update")
        void apiGet<RemedyList>(`/class-groups/${batchId}/remedies`)
          .then(setRemedies)
          .catch(() => setRemedies(null));
    }
  }, [batchId, lastEvent, load]);
  if (!home && !problem)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (!home)
    return (
      <ClassGroupShell title="Class unavailable" eyebrow="My class">
        <ProgramNotice
          tone="stopped"
          title="Could not open this class"
          body={problem}
        />
      </ClassGroupShell>
    );
  const journey = classLessonJourney(
    home.lessons,
    serverNow(home.serverNow, receivedAt.current, tick),
  );
  const focusLesson = journey.focusLesson;
  const formatLesson = (lesson: Home["lessons"][number]) => {
    const local = lessonDraft({
      startsAt: lesson.startsAt,
      durationMinutes: lesson.durationMinutes,
    });
    return `${dates.format(batchDateValue(local.date)!)} · ${local.time} Nepal time`;
  };
  const when = journey.stage === "finished"
    ? "No upcoming date"
    : focusLesson
    ? (() => {
        return formatLesson(focusLesson);
      })()
    : "No lesson scheduled";
  const heroLabel =
    journey.stage === "current"
      ? "LESSON TIME NOW"
      : journey.stage === "upcoming"
        ? "NEXT LESSON"
        : journey.stage === "finished"
        ? "NO UPCOMING LESSONS"
          : "NO LESSONS SCHEDULED";
  const heroContext =
    journey.focusNumber && journey.stage !== "finished"
      ? `Lesson ${journey.focusNumber} of ${home.lessons.length}`
      : journey.stage === "finished"
        ? "Review earlier and closed lesson dates below"
        : "The teacher has not added lesson dates yet";
  const cards: HomeCard[] = [
    ...(home.isTeacher
      ? [
          {
            icon: "users" as HomeCard["icon"],
            label: "Students",
            note: home.counts.students
              ? `${home.counts.students} enrolled`
              : "No students enrolled yet",
            unread: 0,
            badgeLabel: "",
            path: "/class-students",
            withBatch: true,
          },
        ]
      : []),
    {
      icon: "message-circle" as HomeCard["icon"],
      label: "Class messages",
      note: home.counts.messages
        ? home.counts.unreadMessages
          ? `${home.counts.unreadMessages} unread · ${home.counts.messages} total`
          : `${home.counts.messages} messages`
        : "Start the class conversation",
      unread: home.counts.unreadMessages,
      badgeLabel: `${home.counts.unreadMessages} unread class messages`,
      path: "/class-chat",
      withBatch: true,
    },
    {
      icon: "edit-3" as HomeCard["icon"],
      label: "Homework",
      note: classHomeworkOverview(home.counts, home.isTeacher),
      path: "/class-homework",
      unread: home.isTeacher
        ? home.counts.homeworkAwaitingReview
        : home.counts.homeworkLate,
      badgeLabel: home.isTeacher
        ? `${home.counts.homeworkAwaitingReview} homework hand-ins to review`
        : `${home.counts.homeworkLate} late homework tasks`,
      withBatch: true,
    },
    {
      icon: "folder" as HomeCard["icon"],
      label: "Materials",
      note: home.counts.materials
        ? `${home.counts.materials} shared`
        : home.isTeacher
          ? "Add notes or useful links"
          : "Nothing shared yet",
      path: "/class-materials",
      unread: 0,
      badgeLabel: "",
      withBatch: true,
    },
    {
      icon: "credit-card" as HomeCard["icon"],
      label: home.isTeacher ? "Earnings history" : "Payments & receipts",
      note: home.isTeacher
        ? "Lesson earnings and receipts"
        : "Charges, receipts and refunds",
      path: home.isTeacher ? "/(teacher)/subscription" : "/(student)/payments",
      unread: 0,
      badgeLabel: "",
      withBatch: false,
    },
    ...(remedies?.enabled
      ? [
          {
            icon: "repeat" as HomeCard["icon"],
            label: "Make-up lessons",
            note: home.isTeacher
              ? "Requests, replacement dates and held lesson payments"
              : remedies.quotas.length === 1
                ? remedyQuotaLabel(remedies.quotas[0]!)
                : "Your allowance, requests and replacement dates",
            path: "/makeups",
            unread: 0,
            badgeLabel: "",
            withBatch: true,
          },
        ]
      : []),
    {
      icon: "life-buoy" as HomeCard["icon"],
      label: "Help",
      note: "Questions, safety or technical support",
      path: "/support",
      unread: 0,
      badgeLabel: "",
      withBatch: false,
    },
  ];
  const lessonRows = (lessons: ClassJourneyDisplayLesson[]) => (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        backgroundColor: colors.card,
        overflow: "hidden",
      }}
    >
      {lessons.map((lesson, index) => {
        const isCurrent =
          journey.stage === "current" &&
          lesson.sessionId === journey.focusLesson?.sessionId;
        const previous = journey.previousLessons.some((past) => past.sessionId === lesson.sessionId);
        const stateLabel = lessonHistoryLabel({ status: lesson.status, previous,
          current: isCurrent, attendance: lesson.attendance, isTeacher: home.isTeacher });
        return (
          <View
            key={lesson.sessionId}
            style={{
              minHeight: 58,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.border,
              flexDirection: "column",
              alignItems: "stretch",
              gap: space.sm,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                  Lesson {lesson.displayNumber}
                </Text>
                <Text
                  style={[
                    t.caption,
                    numeric,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {formatLesson(lesson)}
                </Text>
              </View>
              {stateLabel ? (
                <View
                  style={{
                    maxWidth: "48%",
                    paddingHorizontal: space.sm,
                    paddingVertical: space.xxs,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surfaceSunk,
                  }}
                >
                  <Text style={[t.caption, { color: colors.primary }]}>
                    {stateLabel}
                  </Text>
                </View>
              ) : null}
            </View>
            {previous || remedies?.enabled ? (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                {previous ? (
                  <>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`View lesson ${lesson.displayNumber}`}
                      onPress={() =>
                        router.push({
                          pathname: "/session/[id]",
                          params: { id: String(lesson.sessionId) },
                        })
                      }
                      style={{
                        minHeight: 44,
                        paddingHorizontal: space.sm,
                        justifyContent: "center",
                      }}
                    >
                      <Text style={[t.caption, { color: colors.primary }]}>
                        View lesson
                      </Text>
                    </TouchableOpacity>
                    {!home.isTeacher && lesson.attendance !== "not_enrolled" ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Get help with lesson ${lesson.displayNumber}`}
                        onPress={() =>
                          router.push({
                            pathname: "/support",
                            params: { sessionId: String(lesson.sessionId) },
                          })
                        }
                        style={{
                          minHeight: 44,
                          paddingHorizontal: space.sm,
                          justifyContent: "center",
                        }}
                      >
                        <Text style={[t.caption, { color: colors.primary }]}>
                          Get help
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : null}
                {remedies?.enabled &&
                remedies.lessons.some(
                  (item) =>
                    item.originalSessionId === lesson.sessionId &&
                    (home.isTeacher
                      ? item.case !== null
                      : item.case !== null ||
                        item.canRequest ||
                        item.canReportTeacherMissed),
                ) ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Make-up options for lesson ${lesson.displayNumber}`}
                    onPress={() =>
                      router.push({
                        pathname: "/makeups",
                        params: {
                          id: String(batchId),
                          sessionId: String(lesson.sessionId),
                        },
                      })
                    }
                    style={{
                      minHeight: 44,
                      paddingHorizontal: space.sm,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={[t.caption, { color: colors.primary }]}>
                      {(() => {
                        const found = remedies.lessons.find(
                          (item) =>
                            item.originalSessionId === lesson.sessionId &&
                            item.case,
                        );
                        return found?.case && !home.isTeacher
                          ? remedyStatusLabel(found.case)
                          : "Make-up options";
                      })()}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
  return (
    <ClassGroupShell
      title={home.title}
      eyebrow={home.isTeacher ? "Teaching" : "My class"}
    >
      <View
        style={{
          padding: space.lg,
          borderRadius: radius.md,
          backgroundColor: colors.primary,
          gap: space.sm,
        }}
      >
        <Text style={[t.caption, { color: colors.primaryForeground }]}>
          {heroLabel}
        </Text>
        <Text style={[t.title3, numeric, { color: colors.primaryForeground }]}>
          {when}
        </Text>
        <Text style={[t.caption, { color: colors.primaryForeground }]}>
          {heroContext}
        </Text>
        {focusLesson && journey.stage !== "finished" ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/session/[id]",
                params: { id: String(focusLesson.sessionId) },
              })
            }
            style={{
              minHeight: 48,
              backgroundColor: colors.background,
              borderRadius: radius.sm,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={[t.bodyStrong, { color: colors.primary }]}>
              {journey.stage === "current" ? "Open this lesson" : "Open lesson"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {journey.upcomingLessons.length || journey.previousLessons.length ? (
        <View style={{ gap: space.sm }}>
          <View style={{ gap: space.xxs }}>
            <Text
              accessibilityRole="header"
              style={[t.title3, { color: colors.foreground }]}
            >
              Upcoming lessons
            </Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              {journey.upcomingLessons.length
                ? `${journey.remainingDates} scheduled ${journey.remainingDates === 1 ? "date" : "dates"} remaining`
                : "No upcoming lesson dates"}
            </Text>
          </View>
          {journey.upcomingLessons.length
            ? lessonRows(showAllUpcoming ? journey.upcomingLessons : journey.upcomingLessons.slice(0, 3))
            : null}
          {journey.upcomingLessons.length > 3 ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={showAllUpcoming ? "Show fewer upcoming dates" : `Show all ${journey.upcomingLessons.length} upcoming dates`}
              onPress={() => setShowAllUpcoming((shown) => !shown)}
              style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs }}
            >
              <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>
                {showAllUpcoming ? "Show fewer dates" : `+ ${journey.upcomingLessons.length - 3} more scheduled ${journey.upcomingLessons.length - 3 === 1 ? "date" : "dates"}`}
              </Text>
              <Feather name={showAllUpcoming ? "chevron-up" : "chevron-down"} size={17} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
          {journey.previousLessons.length ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`${showPrevious ? "Hide" : "Show"} ${journey.previousLessons.length} previous lesson dates`}
                onPress={() => setShowPrevious((shown) => !shown)}
                style={{ minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: colors.actionSoft, flexDirection: "row", alignItems: "center", gap: space.sm }}
              >
                <Feather name="clock" size={18} color={colors.primary} />
                <Text style={[t.bodyStrong, { flex: 1, color: colors.primary }]}>
                  Previous lessons ({journey.previousLessons.length})
                </Text>
                <Feather name={showPrevious ? "chevron-up" : "chevron-down"} size={18} color={colors.primary} />
              </TouchableOpacity>
              {showPrevious ? lessonRows(journey.previousLessons) : null}
              {showPrevious && !home.isTeacher ? <Text style={[t.caption, { color: colors.mutedForeground }]}>Joined means a classroom connection was recorded, not that the full lesson was delivered. Missing attendance needs review; it does not decide a refund.</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        {cards.map((card) => (
          <TouchableOpacity
            key={card.label}
            accessibilityRole="button"
            onPress={() =>
              router.push(
                !card.withBatch
                  ? (card.path as never)
                  : ({
                      pathname: card.path,
                      params: { id: String(batchId) },
                    } as never),
              )
            }
            style={{
              minHeight: 76,
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.sm,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.surfaceSunk,
              }}
            >
              <Feather name={card.icon} size={21} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                {card.label}
              </Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                {card.note}
              </Text>
            </View>
            {card.unread ? (
              <View
                accessibilityLabel={card.badgeLabel}
                style={{
                  minWidth: 24,
                  height: 24,
                  paddingHorizontal: 6,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.brand,
                }}
              >
                <Text
                  style={[
                    t.caption,
                    numeric,
                    { color: colors.brandForeground },
                  ]}
                >
                  {card.unread > 99 ? "99+" : card.unread}
                </Text>
              </View>
            ) : null}
            <Feather
              name="chevron-right"
              size={20}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        ))}
      </View>
    </ClassGroupShell>
  );
}
