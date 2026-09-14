import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { ProgramNotice } from "@/components/programs/ProgramPieces";
import { HIT_SLOP_MIN, radius } from "@/constants/layout";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  filterRosterStudents,
  ROSTER_PAGE_SIZE,
  rosterActivityCounts,
  rosterPresenceSummary,
  studentInitials,
  type RosterFilter,
  type RosterStudent,
} from "@/utils/classRoster";

interface RosterView {
  title: string;
  lessonCount: number;
  attendanceKnown: boolean;
  students: RosterStudent[];
}

const FILTERS: Array<{ value: RosterFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "joined", label: "Joined lessons" },
  { value: "not_yet", label: "No activity yet" },
];

export default function ClassStudentsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const [view, setView] = useState<RosterView | null>(null);
  const [problem, setProblem] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [visibleCount, setVisibleCount] = useState(ROSTER_PAGE_SIZE);
  const load = useCallback(async () => {
    try {
      setView(await apiGet<RosterView>(`/class-groups/${batchId}/students`));
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not load the class roster.");
    }
  }, [batchId]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => setVisibleCount(ROSTER_PAGE_SIZE), [query, filter]);

  const filteredStudents = useMemo(
    () => view ? filterRosterStudents(view.students, query, filter, view.attendanceKnown) : [],
    [filter, query, view],
  );
  const counts = useMemo(
    () => view ? rosterActivityCounts(view.students, view.attendanceKnown) : { all: 0, joined: 0, notYet: null },
    [view],
  );

  if (!view && !problem) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!view) {
    return (
      <ClassGroupShell title="Students" eyebrow="Class roster">
        <ProgramNotice tone="stopped" title="Could not open the roster" body={problem} />
      </ClassGroupShell>
    );
  }

  return (
    <ClassGroupShell title={view.title} eyebrow="Class roster">
      <View style={{ padding: space.lg, borderRadius: 16, backgroundColor: colors.primary, gap: space.xxs }}>
        <Text accessibilityRole="header" style={[t.title2, numeric, { color: colors.primaryForeground }]}>
          {view.students.length} {view.students.length === 1 ? "student" : "students"}
        </Text>
        <Text style={[t.caption, { color: colors.primaryForeground }]}>Enrolled in this class</Text>
      </View>
      {!view.students.length ? (
        <ProgramNotice
          tone="neutral"
          title="No students yet"
          body="Students who join this class will appear here."
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.sm }}>
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Class register</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>Search and review lesson presence</Text>
            </View>
            <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{filteredStudents.length} shown</Text>
          </View>

          {view.students.length > 8 ? (
            <View style={{ gap: space.sm }}>
              <View
                style={{
                  minHeight: HIT_SLOP_MIN,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                }}
              >
                <Feather name="search" size={20} color={colors.mutedForeground} />
                <TextInput
                  accessibilityLabel="Search students"
                  testID="roster-search"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search students"
                  placeholderTextColor={colors.inkFaint}
                  autoCapitalize="words"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  style={[t.body, { flex: 1, minHeight: HIT_SLOP_MIN, color: colors.foreground, outlineStyle: "none" } as never]}
                />
              </View>
              {view.attendanceKnown ? (
                <View accessibilityRole="toolbar" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  {FILTERS.map((choice) => {
                    const active = filter === choice.value;
                    const count = choice.value === "all" ? counts.all : choice.value === "joined" ? counts.joined : counts.notYet;
                    return (
                      <TouchableOpacity
                        key={choice.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        testID={`roster-filter-${choice.value}`}
                        onPress={() => setFilter(choice.value)}
                        style={{
                          minHeight: HIT_SLOP_MIN,
                          paddingHorizontal: space.sm,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.actionSoft : colors.card,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={[t.caption, numeric, { color: active ? colors.primary : colors.mutedForeground }]}>
                          {choice.label} {count}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {!filteredStudents.length ? (
            <ProgramNotice
              tone="neutral"
              title="No matching students"
              body="Try another name or choose a different register view."
            />
          ) : filteredStudents.slice(0, visibleCount).map((student, index) => (
            <View
              key={`${student.name}-${student.joinedAt}-${index}`}
              style={{
                minHeight: HIT_SLOP_MIN + space.lg,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
              }}
            >
              <View style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.actionSoft }}>
                <Text style={[t.caption, { color: colors.primary }]}>{studentInitials(student.name)}</Text>
              </View>
              <View style={{ flex: 1, gap: space.xxs }}>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>{student.name}</Text>
                <Text style={[t.caption, { color: colors.mutedForeground }]}>Enrolled {dates.format(student.joinedAt)}</Text>
                <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
                  {rosterPresenceSummary(student.attendance, view.lessonCount, view.attendanceKnown)}
                </Text>
              </View>
            </View>
          ))}
          {filteredStudents.length > visibleCount ? (
            <TouchableOpacity
              accessibilityRole="button"
              testID="roster-show-more"
              onPress={() => setVisibleCount((current) => current + ROSTER_PAGE_SIZE)}
              style={{
                minHeight: HIT_SLOP_MIN,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.primary,
                backgroundColor: colors.card,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: space.md,
              }}
            >
              <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>Show 10 more</Text>
            </TouchableOpacity>
          ) : null}
          {filteredStudents.length > ROSTER_PAGE_SIZE ? (
            <Text style={[t.caption, numeric, { color: colors.mutedForeground, textAlign: "center" }]}>Showing {Math.min(visibleCount, filteredStudents.length)} of {filteredStudents.length}</Text>
          ) : null}
        </View>
      )}
      <ProgramNotice
        tone="neutral"
        title="About attendance"
        body="Presence is recorded when a student opens a lesson. It is supporting information, not a judgement about their work."
      />
    </ClassGroupShell>
  );
}
