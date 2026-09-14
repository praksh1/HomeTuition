export type ClassJourneyLesson = {
  position: number;
  sessionId: number;
  startsAt: string;
  durationMinutes: number;
};

export type ClassLessonJourney = {
  stage: "empty" | "current" | "upcoming" | "finished";
  focusLesson: ClassJourneyLesson | null;
  focusNumber: number | null;
  passedDates: number;
  remainingDates: number;
  visibleLessons: ClassJourneyLesson[];
  hiddenDates: number;
};

const startMs = (lesson: ClassJourneyLesson) =>
  new Date(lesson.startsAt).getTime();

const endMs = (lesson: ClassJourneyLesson) =>
  startMs(lesson) + lesson.durationMinutes * 60_000;

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
    };
  }

  const passedDates = ordered.filter((lesson) => endMs(lesson) <= nowMs).length;
  const current = ordered.find(
    (lesson) => startMs(lesson) <= nowMs && nowMs < endMs(lesson),
  );
  const upcoming = ordered.find((lesson) => startMs(lesson) > nowMs);
  const focusLesson = current ?? upcoming ?? ordered.at(-1)!;
  const focusNumber = ordered.indexOf(focusLesson) + 1;
  const stage = current ? "current" : upcoming ? "upcoming" : "finished";
  const relevant =
    stage === "finished"
      ? ordered.slice(-3)
      : ordered.filter((lesson) => endMs(lesson) > nowMs).slice(0, 3);
  const relevantTotal =
    stage === "finished"
      ? ordered.length
      : ordered.filter((lesson) => endMs(lesson) > nowMs).length;

  return {
    stage,
    focusLesson,
    focusNumber,
    passedDates,
    remainingDates: ordered.length - passedDates,
    visibleLessons: relevant,
    hiddenDates: Math.max(0, relevantTotal - relevant.length),
  };
}
