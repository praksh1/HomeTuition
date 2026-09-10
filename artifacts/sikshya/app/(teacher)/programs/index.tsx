import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import ProgramHome from "@/components/programs/ProgramHome";
import { useColors } from "@/hooks/useColors";
import { apiGet, ApiError } from "@/utils/api";
import type { ProgramSummary } from "@/utils/learningProgramUi";

/**
 * The teacher's Learning Programs.
 *
 * Thin on purpose: everything drawn is `ProgramHome`, everything derived is
 * `utils/learningProgramUi.ts`, and this file is the wire between them and the Phase 1 API. That
 * split is what lets the whole screen be rendered and inspected in a browser test without a server.
 *
 * Reloaded on focus rather than once on mount, because a teacher comes back here straight after
 * publishing and a stale list would show the old status of the thing they just changed.
 */
export default function ProgramsScreen() {
  const colors = useColors();
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      /*
        The teacher's own list, every status, biggest page the server allows.

        A teacher has a handful of programs rather than a feed, so one page is the whole list and
        paging would be a control nobody uses. `limit` is sent explicitly because the server refuses
        anything that is not a whole positive number, and the default it would apply is smaller.
      */
      const data = await apiGet<{ programs: ProgramSummary[] }>("/learning-programs?limit=50");
      setPrograms(Array.isArray(data.programs) ? data.programs : []);
    } catch (err) {
      // Said, never drawn as an empty list. A failed load rendered as "no programs yet" tells a
      // teacher their work is gone.
      setFailure(
        err instanceof ApiError
          ? err.message
          : "Fadko could not reach the server. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ProgramHome
        programs={programs}
        loading={loading}
        failure={failure}
        onRetry={() => void load()}
        onOpen={(id) => router.push(`/(teacher)/programs/${id}`)}
        onCreate={() => router.push("/(teacher)/programs/new")}
        onBack={() => router.replace("/(teacher)")}
        onViewStatement={() => router.push("/(teacher)/programs/statement")}
      />
    </SafeAreaView>
  );
}
