import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { ProgramNotice } from "@/components/programs/ProgramPieces";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet } from "@/utils/api";
import { batchDateValue, lessonDraft } from "@/utils/programBatches";

interface Home {
  title: string;
  isTeacher: boolean;
  lessons: Array<{
    position: number;
    sessionId: number;
    startsAt: string;
    durationMinutes: number;
  }>;
  counts: { messages: number; homework: number; materials: number };
}

export default function ClassHomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const [home, setHome] = useState<Home | null>(null);
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    try {
      setHome(await apiGet<Home>(`/class-groups/${batchId}`));
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load this class.");
    }
  }, [batchId]);
  useEffect(() => {
    void load();
  }, [load]);
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
  const upcoming =
    home.lessons.find(
      (lesson) => new Date(lesson.startsAt).getTime() >= Date.now(),
    ) ?? home.lessons.at(-1);
  const when = upcoming
    ? (() => {
        const local = lessonDraft({
          startsAt: upcoming.startsAt,
          durationMinutes: upcoming.durationMinutes,
        });
        return `${dates.format(batchDateValue(local.date)!)} · ${local.time} Nepal time`;
      })()
    : "No lesson scheduled";
  const cards = [
    {
      icon: "message-circle",
      label: "Class messages",
      note: home.counts.messages
        ? `${home.counts.messages} messages`
        : "Start the class conversation",
      path: "/class-chat",
    },
    {
      icon: "edit-3",
      label: "Homework",
      note: home.counts.homework
        ? `${home.counts.homework} open`
        : home.isTeacher
          ? "Set the first task"
          : "Nothing due yet",
      path: "/class-homework",
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
    },
    {
      icon: "life-buoy",
      label: "Help",
      note: "Questions, safety or technical support",
      path: "/support",
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
          NEXT LESSON
        </Text>
        <Text style={[t.title3, numeric, { color: colors.primaryForeground }]}>
          {when}
        </Text>
        {upcoming ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/session/[id]",
                params: { id: String(upcoming.sessionId) },
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
              Open lesson
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={{ gap: space.sm }}>
        {cards.map((card) => (
          <TouchableOpacity
            key={card.label}
            accessibilityRole="button"
            onPress={() =>
              router.push(
                card.path === "/support"
                  ? "/support"
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
