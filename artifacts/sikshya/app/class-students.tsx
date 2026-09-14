import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { ProgramNotice } from "@/components/programs/ProgramPieces";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import { rosterPresenceSummary, type RosterAttendance } from "@/utils/classRoster";

interface RosterView {
  title: string;
  lessonCount: number;
  attendanceKnown: boolean;
  students: Array<{
    name: string;
    joinedAt: string;
    attendance: RosterAttendance | null;
  }>;
}

export default function ClassStudentsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const dates = useDates();
  const [view, setView] = useState<RosterView | null>(null);
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    try {
      setView(await apiGet<RosterView>(`/class-groups/${batchId}/students`));
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not load the class roster.");
    }
  }, [batchId]);
  useFocusEffect(useCallback(() => void load(), [load]));

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
          <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Students</Text>
          {view.students.map((student, index) => (
            <View
              key={`${student.name}-${student.joinedAt}-${index}`}
              style={{
                minHeight: 92,
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
              <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSunk }}>
                <Feather name="user" size={20} color={colors.primary} />
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
