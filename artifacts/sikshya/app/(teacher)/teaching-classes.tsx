import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { marketplaceColumnMax } from "@/constants/layout";
import {
  ProgramBackControl,
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { apiGet } from "@/utils/api";
import { BatchTestPanel } from "@/components/classes/BatchTestPanel";
import { BatchTestMoneySummary } from "@/components/classes/BatchTestMoneySummary";
import { batchDateValue, lessonDraft } from "@/utils/programBatches";
import {
  classIsPublished,
  groupTeachingClasses,
  type TeachingClass,
} from "@/utils/teachingClass";

export default function TeachingClasses() {
  const colors = useColors();
  const { t, space, gutter } = useLayout();
  const dates = useDates();
  const dateLabel = (iso: string) => {
    const wallClock = lessonDraft({ startsAt: iso, durationMinutes: 60 });
    return `${dates.formatBoth(batchDateValue(wallClock.date)!)} · ${wallClock.time} Nepal time`;
  };
  const [items, setItems] = useState<TeachingClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [olderToolsOpen, setOlderToolsOpen] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiGet<{
        classes: TeachingClass[];
        nextCursor: number | null;
      }>("/teaching-classes");
      setItems(result.classes);
      setNextCursor(result.nextCursor);
    } catch {
      setError(
        "We could not load your classes. Your saved work has not been changed.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  const more = async () => {
    if (nextCursor === null || loading) return;
    setLoading(true);
    try {
      const result = await apiGet<{
        classes: TeachingClass[];
        nextCursor: number | null;
      }>(`/teaching-classes?before=${nextCursor}`);
      setItems((old) => [...old, ...result.classes]);
      setNextCursor(result.nextCursor);
    } catch {
      setError(
        "We could not load the next page. Try again to reload your classes.",
      );
    } finally {
      setLoading(false);
    }
  };
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: gutter,
          gap: space.lg,
          width: "100%",
          maxWidth: marketplaceColumnMax,
          alignSelf: "center",
        }}
      >
        <ProgramBackControl
          testID="classes-back"
          label="Dashboard"
          onPress={() => router.replace("/(teacher)")}
        />
        <View style={{ gap: space.xs }}>
          <Text style={[t.title1, { color: colors.foreground }]}>
            My classes
          </Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Your teaching, timetable and price — together in one place.
          </Text>
        </View>
        <ProgramButton
          label="Create a class"
          emphasis="primary"
          icon="plus"
          onPress={() => router.push("/(teacher)/create-class")}
        />
        <BatchTestMoneySummary role="teacher" />
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : error ? (
          <ProgramNotice title={error} tone="stopped">
            <ProgramButton label="Try again" onPress={() => void load()} />
          </ProgramNotice>
        ) : items.length ? (
          groupTeachingClasses(items).map((group) => (
            <ProgramCardShell key={group.key}>
              <Text style={[t.title3, { color: colors.foreground }]}>
                {group.title}
              </Text>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>
                {group.items[0]!.batch.format === "ongoing"
                  ? "Regular tuition · shared 30-day dates"
                  : "Short course"}
              </Text>
              {group.items.map((item) => (
                <View
                  key={item.batch.id}
                  style={{
                    gap: space.sm,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <ProgramChip
                    label={
                      item.batch.status === "closed"
                        ? "Closed"
                        : classIsPublished(item)
                          ? "Published"
                          : item.batch.status === "published"
                            ? "Unpublished changes"
                            : "Draft"
                    }
                  />
                  {item.batch.tuitionPeriod ? (
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      {dateLabel(item.batch.tuitionPeriod.startsAt)} until{" "}
                      {dateLabel(item.batch.tuitionPeriod.endsAt)}
                    </Text>
                  ) : null}
                  <ProgramButton
                    label={
                      item.batch.status === "draft"
                        ? "Continue setup"
                        : "View these dates"
                    }
                    spoken={`${item.batch.status === "draft" ? "Continue setup" : "View dates"} for ${item.title}${item.batch.tuitionPeriod ? `, ${dateLabel(item.batch.tuitionPeriod.startsAt)}` : ""}`}
                    onPress={() =>
                      router.push({
                        pathname: "/(teacher)/teaching-class/[id]",
                        params: { id: String(item.batch.id) },
                      })
                    }
                  />
                  {item.batch.testPilotEndsAt && item.batch.status === "published" ? <BatchTestPanel batchId={item.batch.id} teacher /> : null}
                </View>
              ))}
            </ProgramCardShell>
          ))
        ) : (
          <ProgramNotice
            title="Start with the class you already teach"
            body="Evening tuition, exam preparation, languages or a skill — describe it, choose your days and set one clear price."
          />
        )}
        {nextCursor !== null && !loading && !error ? (
          <ProgramButton label="More classes" onPress={() => void more()} />
        ) : null}
        <ProgramButton
          label={olderToolsOpen ? "Hide earlier test tools" : "Earlier test tools"}
          emphasis="quiet"
          onPress={() => setOlderToolsOpen(!olderToolsOpen)}
        />
        {olderToolsOpen ? <ProgramNotice
          title="Earlier test tools"
          body="Open classes and screens used during earlier testing. Your saved test data has been kept."
          tone="neutral"
        >
          <ProgramButton
            label="Single-lesson tests"
            emphasis="quiet"
            onPress={() => router.push("/(teacher)/sessions")}
          />
          <ProgramButton
            label="Monthly class tools"
            emphasis="quiet"
            onPress={() => router.push("/(teacher)/monthly")}
          />
          <ProgramButton
            label="Advanced class editor"
            emphasis="quiet"
            onPress={() => router.push("/(teacher)/programs")}
          />
        </ProgramNotice> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
