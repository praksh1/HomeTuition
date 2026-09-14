import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { batchDateValue, lessonDraft } from "@/utils/programBatches";
import { serverNow } from "@/utils/sessionClock";

interface Home {
  title: string;
  isTeacher: boolean;
  serverNow: string;
  lessons: Array<{
    position: number;
    sessionId: number;
    startsAt: string;
    durationMinutes: number;
  }>;
  counts: {
    messages: number;
    unreadMessages: number;
    homework: number;
    homeworkToDo: number;
    homeworkLate: number;
    homeworkAwaitingReview: number;
    materials: number;
  };
}

export default function ClassHomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const { lastEvent } = useNotifications();
  const [home, setHome] = useState<Home | null>(null);
  const [problem, setProblem] = useState("");
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
    }, [load]),
  );
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      (lastEvent?.kind === "class_message" ||
        lastEvent?.kind.startsWith("class_homework_")) &&
      Number(lastEvent.batchId) === batchId
    ) {
      void load();
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
  const when = focusLesson
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
          ? "SCHEDULE COMPLETE"
          : "NO LESSONS SCHEDULED";
  const heroContext =
    journey.focusNumber && journey.stage !== "finished"
      ? `Lesson ${journey.focusNumber} of ${home.lessons.length}`
      : journey.stage === "finished"
        ? `All ${journey.passedDates} scheduled ${journey.passedDates === 1 ? "date has" : "dates have"} passed`
        : "The teacher has not added lesson dates yet";
  const cards = [
    {
      icon: "message-circle",
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
      icon: "edit-3",
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
      icon: "folder",
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
      icon: "credit-card",
      label: home.isTeacher ? "Earnings history" : "Payments & receipts",
      note: home.isTeacher
        ? "Payouts and payment records"
        : "Charges, receipts and refunds",
      path: home.isTeacher ? "/subscription" : "/(student)/payments",
      unread: 0,
      badgeLabel: "",
      withBatch: false,
    },
    {
      icon: "life-buoy",
      label: "Help",
      note: "Questions, safety or technical support",
      path: "/support",
      unread: 0,
      badgeLabel: "",
      withBatch: false,
    },
  ] as const;
  return (
    <ClassGroupShell
      title={home.title}
      eyebrow={home.isTeacher ? "Teaching" : "My class"}
    >
      <View
        style={{
          padding: space.lg,
          borderRadius: 16,
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
              borderRadius: 12,
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
      {journey.visibleLessons.length ? (
        <View style={{ gap: space.sm }}>
          <View style={{ gap: space.xxs }}>
            <Text
              accessibilityRole="header"
              style={[t.title3, { color: colors.foreground }]}
            >
              Schedule
            </Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              {journey.stage === "finished"
                ? "Most recent scheduled dates"
                : `${journey.remainingDates} scheduled ${journey.remainingDates === 1 ? "date" : "dates"} remaining`}
            </Text>
          </View>
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              backgroundColor: colors.card,
              overflow: "hidden",
            }}
          >
            {journey.visibleLessons.map((lesson, index) => {
              const isCurrent =
                journey.stage === "current" &&
                lesson.sessionId === journey.focusLesson?.sessionId;
              return (
                <View
                  key={lesson.sessionId}
                  style={{
                    minHeight: 58,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    borderTopWidth: index ? 1 : 0,
                    borderTopColor: colors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <View style={{ flex: 1, gap: space.xxs }}>
                    <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                      Lesson {lesson.position}
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
                  {isCurrent ? (
                    <View
                      style={{
                        paddingHorizontal: space.sm,
                        paddingVertical: space.xxs,
                        borderRadius: 999,
                        backgroundColor: colors.surfaceSunk,
                      }}
                    >
                      <Text style={[t.caption, { color: colors.primary }]}>
                        Now
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          {journey.hiddenDates ? (
            <Text
              style={[
                t.caption,
                numeric,
                { color: colors.mutedForeground, textAlign: "center" },
              ]}
            >
              + {journey.hiddenDates} more scheduled{" "}
              {journey.hiddenDates === 1 ? "date" : "dates"}
            </Text>
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
              borderRadius: 14,
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
                borderRadius: 12,
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
                  borderRadius: 12,
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
