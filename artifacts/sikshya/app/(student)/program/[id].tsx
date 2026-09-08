import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ProgramView from "@/components/programs/ProgramView";
import { ProgramFailure } from "@/components/programs/ProgramPieces";
import { space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { apiGet, ApiError } from "@/utils/api";
import type { PublicProgramDetail } from "@/utils/programDiscovery";

/**
 * One published program, read by a student.
 *
 * ## What it fetches, and what it never asks
 *
 * The public `/programs/:id` endpoint, which serves the immutable published snapshot. A teacher's
 * unpublished edits are invisible here however long they have been saved. A draft, an archived
 * program, and a program whose teacher is not approved answer 404, so this screen only ever draws
 * something a student may legitimately read.
 *
 * ## What it does not do
 *
 * There is no join, buy, enrol, book or pay button. `ProgramView` renders a plain sentence
 * explaining that Fadko has not opened enrolment for Learning Programs yet — a disabled action
 * would be a promise this screen cannot keep, and this project's running fabrications table
 * (`.agents/backlog/ui-upgrade-progress.md`) records what happens the moment one appears.
 */
export default function StudentProgramScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : "";

  const [program, setProgram] = useState<PublicProgramDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * True when the API answered 404 or 410 — the program was withdrawn or archived while the
   * student was reading the list. Distinct from a network failure so the copy can be different:
   * one is "it's gone", the other is "try again".
   */
  const [gone, setGone] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setFailure(null);
    setGone(false);
    try {
      const answer = await apiGet<{ program: PublicProgramDetail }>(`/programs/${id}`);
      setProgram(answer.program);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setGone(true);
      } else {
        setFailure(
          err instanceof ApiError
            ? err.message
            : "Fadko could not reach the server. Check your connection and try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = () => router.replace("/(student)");
  const openTeacher = (teacherId: number) => router.push(`/(student)/teacher/${teacherId}`);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View
          testID="program-view-loading"
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (gone) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", padding: space.md }}>
          <ProgramFailure
            testID="program-view-gone"
            message="This program is not on Fadko any more. The teacher may have taken it down."
            onRetry={back}
            retryLabel="Back to Discover"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (failure || !program) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", padding: space.md }}>
          <ProgramFailure
            testID="program-view-failure"
            message={failure ?? "That program could not be opened."}
            onRetry={() => void load()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ProgramView program={program} onBack={back} onOpenTeacher={openTeacher} />
    </SafeAreaView>
  );
}
