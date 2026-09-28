export type ClassJourneyLesson = {
  position: number;
  sessionId: number;
  startsAt: string;
  durationMinutes: number;
  status?: string;
};

export type ClassJourneyDisplayLesson = ClassJourneyLesson & {
  /** One-based chronological number for people; database positions may start at zero. */
  displayNumber: number;
};

export type ClassLessonJourney = {
  stage: "empty" | "current" | "upcoming" | "finished";
  focusLesson: ClassJourneyLesson | null;
  focusNumber: number | null;
  passedDates: number;
  remainingDates: number;
  visibleLessons: ClassJourneyDisplayLesson[];
  hiddenDates: number;
  upcomingLessons: ClassJourneyDisplayLesson[];
  previousLessons: ClassJourneyDisplayLesson[];
};

const startMs = (lesson: ClassJourneyLesson) =>
  new Date(lesson.startsAt).getTime();

const endMs = (lesson: ClassJourneyLesson) =>
  startMs(lesson) + lesson.durationMinutes * 60_000;

const isTerminal = (lesson: ClassJourneyLesson) =>
  lesson.status === "completed" || lesson.status === "cancelled";

/**
 * Derive the class-home clock from one server-calibrated instant. "Passed" means
 * only that the scheduled time elapsed; it never claims attendance or delivery.
 */
export function classLessonJourney(
  lessons: ClassJourneyLesson[],
  nowMs: number,
): ClassLessonJourney {
  const ordered = [...lessons]
    .filter(
      (lesson) =>
        Number.isFinite(startMs(lesson)) &&
        Number.isFinite(lesson.durationMinutes) &&
        lesson.durationMinutes > 0,
    )
    .sort((a, b) => startMs(a) - startMs(b) || a.position - b.position);

  if (!ordered.length) {
    return {
      stage: "empty",
      focusLesson: null,
      focusNumber: null,
      passedDates: 0,
      remainingDates: 0,
      visibleLessons: [],
      hiddenDates: 0,
      upcomingLessons: [],
      previousLessons: [],
    };
  }

  const displayLessons = ordered.map((lesson, index) => ({
    ...lesson,
    displayNumber: index + 1,
  }));
  const upcomingLessons = displayLessons.filter((lesson) =>
    !isTerminal(lesson) && (endMs(lesson) > nowMs || lesson.status === "live"),
  );
  const previousLessons = displayLessons.filter((lesson) =>
    isTerminal(lesson) || (endMs(lesson) <= nowMs && lesson.status !== "live"),
  ).reverse();
  const passedDates = ordered.filter((lesson) => endMs(lesson) <= nowMs).length;
  const current = ordered.find(
    (lesson) => lesson.status === "live" || (!isTerminal(lesson) && startMs(lesson) <= nowMs && nowMs < endMs(lesson)),
  );
  const upcoming = upcomingLessons.find((lesson) => startMs(lesson) > nowMs);
  const focusLesson = current ?? upcoming ?? ordered.at(-1)!;
  const focusNumber = ordered.findIndex((lesson) => lesson.sessionId === focusLesson.sessionId) + 1;
  const stage = current ? "current" : upcoming ? "upcoming" : "finished";
  const relevant =
    stage === "finished"
      ? [...previousLessons].reverse().slice(-3)
      : upcomingLessons.slice(0, 3);
  const relevantTotal =
    stage === "finished"
      ? previousLessons.length
      : upcomingLessons.length;

  return {
    stage,
    focusLesson,
    focusNumber,
    passedDates,
    remainingDates: upcomingLessons.length,
    visibleLessons: relevant,
    hiddenDates: Math.max(0, relevantTotal - relevant.length),
    upcomingLessons,
    previousLessons,
  };
}
