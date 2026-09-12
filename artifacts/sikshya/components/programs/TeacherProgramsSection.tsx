import { router } from "expo-router";
import React from "react";

import { apiGet } from "@/utils/api";
import {
  appendPage,
  type ProgramList,
  type PublicProgramSummary,
} from "@/utils/programDiscovery";
import { TeacherProgramsPanel } from "./TeacherProgramsPanel";

const PROFILE_PAGE_SIZE = 4;

/**
 * The programs a teacher has actually published, shown on their public profile.
 *
 * This section owns its request so the profile's 20-second live-class refresh never downloads
 * the same programs again. A real empty response removes the section; a failed response says it
 * failed and offers a retry, rather than translating a poor connection into "this teacher has no
 * programs". Cards use the same immutable public snapshots as Discover.
 */
export default function TeacherProgramsSection({ teacherProfileId }: { teacherProfileId: string }) {
  const [list, setList] = React.useState<ProgramList>({ rows: [], nextCursor: null });
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const [loadingMore, setLoadingMore] = React.useState(false);
  const generation = React.useRef(0);

  const load = React.useCallback(async (cursor: string | null = null) => {
    const mine = generation.current;
    if (cursor === null) setState("loading");
    else {
      // Keep the successful cards visible while the next-page retry is in flight, and replace
      // the retry label with a single disabled progress control so rapid taps cannot fan out.
      setState("ready");
      setLoadingMore(true);
    }
    try {
      const query = new URLSearchParams({
        teacherProfileId,
        limit: String(PROFILE_PAGE_SIZE),
        presentation: "program",
        ...(cursor ? { cursor } : {}),
      });
      const page = await apiGet<{ programs: PublicProgramSummary[]; nextCursor: string | null }>(
        `/programs?${query.toString()}`,
      );
      if (generation.current !== mine) return;
      setList((current) => cursor === null
        ? { rows: page.programs, nextCursor: page.nextCursor }
        : appendPage(current, { rows: page.programs, nextCursor: page.nextCursor }));
      setState("ready");
    } catch {
      if (generation.current === mine) setState("failed");
    } finally {
      if (generation.current === mine) setLoadingMore(false);
    }
  }, [teacherProfileId]);

  React.useEffect(() => {
    generation.current += 1;
    setList({ rows: [], nextCursor: null });
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return (
    <TeacherProgramsPanel
      list={list}
      state={state}
      loadingMore={loadingMore}
      onRetry={() => void load(list.rows.length > 0 ? list.nextCursor : null)}
      onLoadMore={() => void load(list.nextCursor)}
      onOpen={(programId) => router.push(`/(student)/program/${programId}`)}
    />
  );
}
