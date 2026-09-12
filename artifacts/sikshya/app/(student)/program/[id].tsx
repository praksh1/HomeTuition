import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Share, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ProgramView from "@/components/programs/ProgramView";
import { ProgramFailure } from "@/components/programs/ProgramPieces";
import { space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, ApiError } from "@/utils/api";
import { notify } from "@/utils/alerts";
import type { PublicProgramDetail } from "@/utils/programDiscovery";
import type { ProgramBatchSnapshot } from "@/utils/programBatches";

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
 *
 * ## Back and invalid id
 *
 * A student arriving here from Discover expects Back to return there, not to blow away the
 * whole navigation stack. If there is a page to go back to, `router.back()` uses it; otherwise
 * the screen falls back to Discover as a safe deep-link landing spot — a link shared with
 * somebody who did not come from anywhere yet still leaves them somewhere they can read.
 *
 * An invalid or missing id ends the loading state and shows an honest "not found" — the earlier
 * version returned early inside the loader without ever calling `setLoading(false)`, so the
 * spinner never went away and a bad link hung the screen.
 */
export default function StudentProgramScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  /**
   * Whether the id in the URL is one the server could ever answer for.
   *
   * `/programs/:id` keys on a positive integer. A blank, `NaN`, negative or "abc" id would take a
   * round trip to the server to be told 404, which is a spinner the student watches for two
   * seconds on a slow connection — and if the round trip fails they see a network error for a
   * URL that was never going to work. Decide it here, up front, and end loading immediately.
   */
  const validId = useMemo(() => /^\d+$/.test(id) && Number(id) > 0, [id]);

  const [program, setProgram] = useState<PublicProgramDetail | null>(null);
  const [testEnrollment, setTestEnrollment] = useState<{
    totalTuitionNpr: number;
    paidLessonCount: number;
    allocations: Array<{ lessonNumber: number; state: string }>;
  } | null>(null);
  const [testEnrollmentUnavailable, setTestEnrollmentUnavailable] = useState(false);
  const [batches, setBatches] = useState<ProgramBatchSnapshot[]>([]);
  const [batchesUnavailable, setBatchesUnavailable] = useState(false);
  const [loading, setLoading] = useState(validId);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * True when the API answered 404 or 410 — the program was withdrawn or archived while the
   * student was reading the list, or the id in the URL never named one. Distinct from a network
   * failure so the copy can be different: one is "it's gone", the other is "try again".
   */
  const [gone, setGone] = useState(!validId);

  const load = useCallback(async () => {
    if (!validId) {
      // Never fire a request the server cannot answer. Show the not-found state instead of
      // spinning forever — the previous version returned without ever ending `loading`.
      setLoading(false);
      setGone(true);
      setFailure(null);
      return;
    }
    setLoading(true);
    setFailure(null);
    setGone(false);
    try {
      const rehearsalRequest = user?.role === "student"
        ? apiGet<{ testEnrollment: { totalTuitionNpr: number; paidLessonCount: number } | null; allocations?: Array<{ lessonNumber: number; state: string }> }>(`/programs/${id}/my-test-enrolment`)
          .then((value) => ({ value, unavailable: false }))
          .catch(() => ({ value: { testEnrollment: null, allocations: [] }, unavailable: true }))
        : Promise.resolve({ value: { testEnrollment: null, allocations: [] }, unavailable: false });
      const [answer, rehearsal, batchAnswer] = await Promise.all([
        apiGet<{ program: PublicProgramDetail }>(`/programs/${id}`),
        rehearsalRequest,
        apiGet<{ batches: ProgramBatchSnapshot[] }>(`/programs/${id}/batches`)
          .then((value) => ({ value, unavailable: false }))
          .catch(() => ({ value: { batches: [] }, unavailable: true })),
      ]);
      setProgram(answer.program);
      setTestEnrollment(rehearsal.value.testEnrollment ? { ...rehearsal.value.testEnrollment, allocations: rehearsal.value.allocations ?? [] } : null);
      setTestEnrollmentUnavailable(rehearsal.unavailable);
      setBatches(Array.isArray(batchAnswer.value.batches) ? batchAnswer.value.batches : []);
      setBatchesUnavailable(batchAnswer.unavailable);
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
  }, [id, user?.role, validId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Back to wherever the student came from, and only Discover as the fallback.
   *
   * `router.replace("/(student)")` used to run unconditionally, so a student who tapped in from
   * a teacher's page, a session card, or an in-app link found themselves back at Discover with
   * no history left — the browser Back button did not even work. `canGoBack()` is Expo Router's
   * question about the current stack; when it says yes, the stack has a real previous page and
   * `back()` returns to it. When it says no (a deep link opened straight to this screen), the
   * replace is the honest fallback.
   */
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(user?.role === "student" ? "/(student)" : "/welcome");
  };
  const openTeacher = (teacherId: number) => router.push(`/(student)/teacher/${teacherId}`);
  const shareProgram = async () => {
    if (!program) return;
    const url = Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/program/${program.id}`
      : `https://hometuition.praksh-dhakal.workers.dev/program/${program.id}`;
    const message = `${program.title} — taught by ${program.teacher.name} on Fadko. ${url}`;
    try {
      if (Platform.OS === "web") {
        const webNavigator = navigator as Navigator & {
          share?: (data: { title: string; text: string; url: string }) => Promise<void>;
          clipboard?: { writeText: (text: string) => Promise<void> };
        };
        if (webNavigator.share) await webNavigator.share({ title: program.title, text: message, url });
        else if (webNavigator.clipboard) {
          await webNavigator.clipboard.writeText(url);
          notify("Class link copied", "You can paste it into Facebook, Instagram or a message.");
        } else notify("Share this class", url);
      } else {
        await Share.share({ title: program.title, message, url });
      }
    } catch {
      // Dismissing the device share sheet is not an error the student needs to resolve.
    }
  };

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
            title={validId ? "Program not found" : "Program link is missing an id"}
            message={
              validId
                ? "This program is not on Fadko any more. The teacher may have taken it down."
                : "This link does not name a program. Return to Discover to find one."
            }
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
      <ProgramView program={program} onBack={back} onShare={() => void shareProgram()} onOpenTeacher={openTeacher} testEnrollment={testEnrollment} testEnrollmentUnavailable={testEnrollmentUnavailable} batches={batches} batchesUnavailable={batchesUnavailable} />
    </SafeAreaView>
  );
}
