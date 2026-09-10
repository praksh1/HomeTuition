import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ApiError, apiGet } from "@/utils/api";

interface Allocation {
  id: number;
  lessonNumber: number;
  teacherAmountNpr: number;
  state: string;
}
interface Enrollment {
  id: number;
  programTitle: string | null;
  totalTuitionNpr: number;
  paymentStatus: string;
  allocations: Allocation[];
}
interface Statement {
  mode: "test";
  notice: string;
  totals: Record<string, { grossNpr: number; teacherNpr: number; lessons: number }>;
  enrollments: Enrollment[];
}

const LABELS: Record<string, string> = {
  future: "Future lessons",
  replacement_pending: "Replacement needed",
  delivered_pending: "Complaint window",
  disputed: "In review",
  eligible: "Eligible in rehearsal",
  paid_out: "Marked paid in rehearsal",
  refund_owed: "Refund owed in rehearsal",
  refunded: "Marked refunded in rehearsal",
};

export default function ProgramStatementScreen() {
  const colors = useColors();
  const { t, space, radius, gutter, numeric } = useLayout();
  const [data, setData] = useState<Statement | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(await apiGet<Statement>("/learning-program-earnings"));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "The shadow statement could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", padding: gutter, paddingBottom: space.huge, gap: space.lg }}>
        <TouchableOpacity onPress={() => router.replace("/(teacher)/programs")} style={{ minHeight: space.huge, flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Feather name="chevron-left" size={space.lg} color={colors.primary} />
          <Text style={[t.bodyStrong, { color: colors.primary }]}>Programs</Text>
        </TouchableOpacity>
        <View style={{ gap: space.xxs }}>
          <Text style={[t.title1, { color: colors.foreground }]}>Program money rehearsal</Text>
          <Text style={[t.body, { color: colors.mutedForeground }]}>See how lesson-by-lesson earnings will work before real payments are connected.</Text>
        </View>
        <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warn }}>
          <Text style={[t.bodyStrong, { color: colors.warn }]}>Test figures only</Text>
          <Text style={[t.body, { color: colors.foreground }]}>No student was charged. Nothing here can be paid out.</Text>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {failure ? (
          <View style={{ gap: space.sm }}>
            <Text style={[t.body, { color: colors.destructive }]}>{failure}</Text>
            <TouchableOpacity onPress={() => void load()} style={{ minHeight: space.huge, justifyContent: "center" }}>
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {!loading && !failure && data && data.enrollments.length === 0 ? (
          <View style={{ padding: space.xl, gap: space.sm, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Text style={[t.title3, { color: colors.foreground }]}>No rehearsal enrolments yet</Text>
            <Text style={[t.body, { color: colors.mutedForeground }]}>An operator can add an approved test student to one of your published Programs. It will appear here without moving money.</Text>
          </View>
        ) : null}
        {data && Object.keys(data.totals).length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={[t.title2, { color: colors.foreground }]}>Where the test allocations stand</Text>
            {Object.entries(data.totals).map(([state, total]) => (
              <View key={state} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[t.bodyStrong, { color: colors.foreground }]}>{LABELS[state] ?? "Recorded state"}</Text>
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>{total.lessons} {total.lessons === 1 ? "lesson" : "lessons"}</Text>
                </View>
                <Text style={[t.title3, numeric, { color: colors.foreground }]}>NPR {total.teacherNpr.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {data?.enrollments.map((enrollment) => (
          <View key={enrollment.id} style={{ padding: space.lg, gap: space.sm, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
            <Text style={[t.title3, { color: colors.foreground }]}>{enrollment.programTitle ?? "Program title unavailable"}</Text>
            <Text style={[t.caption, { color: colors.warn }]}>TEST — no payment was processed</Text>
            {enrollment.allocations.map((allocation) => (
              <View key={allocation.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={[t.body, { color: colors.mutedForeground, flex: 1 }]}>Lesson {allocation.lessonNumber} · {LABELS[allocation.state] ?? allocation.state}</Text>
                <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>NPR {allocation.teacherAmountNpr.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
