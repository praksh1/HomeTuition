import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { desktopWorkspaceMax, HIT_SLOP_MIN } from "@/constants/layout";
import {
  ProgramBackControl,
  ProgramButton,
  ProgramCardShell,
  ProgramChip,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { apiGet } from "@/utils/api";
import { batchDateValue, lessonDraft } from "@/utils/programBatches";
import {
  classIsPublished,
  groupTeachingClasses,
  type TeachingClass,
} from "@/utils/teachingClass";

export default function TeachingClasses() {
  const colors = useColors();
  const { t, space, gutter, radius, numeric, isExpanded } = useLayout();
  const dates = useDates();
  const dateLabel = (iso: string) => {
    const wallClock = lessonDraft({ startsAt: iso, durationMinutes: 60 });
    return `${dates.formatBoth(batchDateValue(wallClock.date)!)} · ${wallClock.time} Nepal time`;
  };
  const [items, setItems] = useState<TeachingClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sequence = useRef(0);
  const loadingMore = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const address = `/teaching-classes?q=${encodeURIComponent(query)}&status=${status}`;
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await apiGet<{
        classes: TeachingClass[];
        nextCursor: number | null;
      }>(address);
      if (current !== sequence.current) return;
      setItems(result.classes);
      setNextCursor(result.nextCursor);
    } catch {
      if (current !== sequence.current) return;
      setError(
        "We could not load your classes. Your saved work has not been changed.",
      );
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [address]);
  const more = async () => {
    if (nextCursor === null || loading || loadingMore.current) return;
    loadingMore.current = true;
    const current = sequence.current;
    setMoreBusy(true);
    try {
      const result = await apiGet<{
        classes: TeachingClass[];
        nextCursor: number | null;
      }>(`${address}&before=${nextCursor}`);
      if (current !== sequence.current) return;
      setItems((old) => [...old, ...result.classes.filter((item) => !old.some((existing) => existing.batch.id === item.batch.id))]);
      setNextCursor(result.nextCursor);
    } catch {
      if (current !== sequence.current) return;
      setError(
        "We could not load the next page. Try again to reload your classes.",
      );
    } finally {
      loadingMore.current = false;
      setMoreBusy(false);
    }
  };
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { sequence.current += 1; };
    }, [load]),
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: gutter,
          gap: space.lg,
          width: "100%",
          maxWidth: desktopWorkspaceMax,
          alignSelf: "center",
        }}
      >
        <ProgramBackControl
          testID="classes-back"
          label="Dashboard"
          onPress={() => router.replace("/(teacher)")}
        />
        <View style={{ flexDirection: isExpanded ? "row" : "column", alignItems: isExpanded ? "center" : "stretch", gap: space.md }}>
          <View style={{ flex: isExpanded ? 1 : undefined, gap: space.xs }}>
            <Text style={[t.title1, { color: colors.foreground }]}>My classes</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>
              Your teaching studio. Find a class here; see your next lesson in Schedule.
            </Text>
          </View>
          <ProgramButton label="Create a class" emphasis="primary" icon="plus"
            onPress={() => router.push("/(teacher)/create-class")} />
        </View>
        <View style={{ flexDirection: isExpanded ? "row" : "column", gap: space.sm }}>
          <TextInput accessibilityLabel="Search all your classes" placeholder="Search all your classes" value={search}
            onChangeText={setSearch} maxLength={100} placeholderTextColor={colors.mutedForeground}
            style={[t.body, { flex: isExpanded ? 1 : undefined, minHeight: HIT_SLOP_MIN, padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card, color: colors.foreground }]} />
          <ProgramButton label="Open schedule" icon="calendar" onPress={() => router.push("/(teacher)/sessions")} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {[["", "All"], ["published", "Published"], ["draft", "Drafts"], ["closed", "Closed"]].map(([value, label]) =>
            <ProgramButton key={value} label={label!} emphasis={status === value ? "secondary" : "quiet"} onPress={() => setStatus(value!)} />)}
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : error ? (
          <ProgramNotice title={error} tone="stopped">
            <ProgramButton label="Try again" onPress={() => void load()} />
          </ProgramNotice>
        ) : items.length ? (
          groupTeachingClasses(items).map((group) => (
            <ProgramCardShell key={group.key} testID={`teaching-class-${group.items[0]!.batch.id}`}>
              <Text style={[t.title3, { color: colors.foreground }]}>
                {group.title}
              </Text>
              <Text style={[t.callout, { color: colors.mutedForeground }]}>
                {group.items[0]!.batch.format === "ongoing"
                  ? "Regular tuition · shared 30-day dates"
                  : "Short course"}
              </Text>
              {(expanded[group.key] ? group.items : group.items.slice(0, 1)).map((item) => (
                <View
                  key={item.batch.id}
                  style={{
                    flexDirection: isExpanded ? "row" : "column",
                    alignItems: isExpanded ? "center" : "stretch",
                    gap: space.sm,
                    paddingTop: space.sm,
                    borderTopWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View style={{ flex: isExpanded ? 1 : undefined, minWidth: 0, gap: space.xs }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
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
                  <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
                    {item.batch.lessons.length} {item.batch.lessons.length === 1 ? "lesson" : "lessons"} · {item.teachingLanguage} · {item.batch.totalTuitionNpr ? `NPR ${item.batch.totalTuitionNpr.toLocaleString("en-NP")} / student` : "Price not set"}
                  </Text>
                  </View>
                  {item.batch.tuitionPeriod ? (
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      {dateLabel(item.batch.tuitionPeriod.startsAt)} until{" "}
                      {dateLabel(item.batch.tuitionPeriod.endsAt)}
                    </Text>
                  ) : item.batch.lessons[0] ? <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Starts {dateLabel(item.batch.lessons[0].startsAt)}</Text> : null}
                  </View>
                  <View style={{ alignSelf: isExpanded ? "center" : "stretch" }}>
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
                  </View>
                </View>
              ))}
              {group.items.length > 1 ? <ProgramButton emphasis="quiet"
                label={expanded[group.key] ? "Collapse date sets" : `More date sets (${group.items.length - 1})`}
                onPress={() => setExpanded((old) => ({ ...old, [group.key]: !old[group.key] }))} /> : null}
            </ProgramCardShell>
          ))
        ) : (
          <ProgramNotice
            title={query || status ? "No matching classes" : "Start with what you know"}
            body={query || status ? "Try a different name or filter. Your other classes are still saved." : "Neighborhood tutoring, exam preparation, languages or a skill — describe who you can help, choose your days and set one clear price."}
          />
        )}
        {nextCursor !== null && !loading && !error ? (
          <ProgramButton label="More classes" busy={moreBusy} onPress={() => void more()} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
