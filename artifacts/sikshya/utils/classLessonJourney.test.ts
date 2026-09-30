import assert from "node:assert/strict";
import test from "node:test";
import {
  classLessonJourney,
  type ClassJourneyLesson,
} from "./classLessonJourney.ts";

const lessons: ClassJourneyLesson[] = [
  {
    position: 1,
    sessionId: 11,
    startsAt: "2026-09-13T10:00:00.000Z",
    durationMinutes: 60,
  },
  {
    position: 2,
    sessionId: 12,
    startsAt: "2026-09-14T10:00:00.000Z",
    durationMinutes: 60,
  },
  {
    position: 3,
    sessionId: 13,
    startsAt: "2026-09-15T10:00:00.000Z",
    durationMinutes: 60,
  },
  {
    position: 4,
    sessionId: 14,
    startsAt: "2026-09-16T10:00:00.000Z",
    durationMinutes: 60,
  },
];

test("shows the first future lesson before a class begins", () => {
  const result = classLessonJourney(
    lessons,
    Date.parse("2026-09-13T09:00:00.000Z"),
  );
  assert.equal(result.stage, "upcoming");
  assert.equal(result.focusLesson?.sessionId, 11);
  assert.equal(result.focusNumber, 1);
  assert.equal(result.remainingDates, 4);
  assert.deepEqual(
    result.visibleLessons.map((lesson) => lesson.sessionId),
    [11, 12, 13],
  );
  assert.equal(result.hiddenDates, 1);
  assert.deepEqual(
    result.visibleLessons.map((lesson) => lesson.displayNumber),
    [1, 2, 3],
  );
});

test("display numbers stay one-based when stored positions start at zero", () => {
  const zeroBased = lessons.map((lesson) => ({
    ...lesson,
    position: lesson.position - 1,
  }));
  const result = classLessonJourney(
    zeroBased,
    Date.parse("2026-09-13T09:00:00.000Z"),
  );
  assert.equal(result.focusNumber, 1);
  assert.deepEqual(
    result.visibleLessons.map((lesson) => lesson.displayNumber),
    [1, 2, 3],
  );
});

test("keeps the current lesson in focus instead of skipping to tomorrow", () => {
  const result = classLessonJourney(
    lessons,
    Date.parse("2026-09-14T10:30:00.000Z"),
  );
  assert.equal(result.stage, "current");
  assert.equal(result.focusLesson?.sessionId, 12);
  assert.equal(result.focusNumber, 2);
  assert.equal(result.passedDates, 1);
  assert.equal(result.remainingDates, 3);
  assert.deepEqual(result.previousLessons.map((lesson) => lesson.sessionId), [11]);
  assert.deepEqual(result.upcomingLessons.map((lesson) => lesson.sessionId), [12, 13, 14]);
});

test("previous dates are newest first and keep actual completion status", () => {
  const withStatuses = lessons.map((lesson, index) => ({
    ...lesson,
    status: index === 0 ? "completed" : index === 1 ? "cancelled" : "upcoming",
  }));
  const result = classLessonJourney(withStatuses, Date.parse("2026-09-15T11:00:00.000Z"));
  assert.deepEqual(result.previousLessons.map((lesson) => lesson.displayNumber), [3, 2, 1]);
  assert.deepEqual(result.previousLessons.map((lesson) => lesson.status), ["upcoming", "cancelled", "completed"]);
  assert.deepEqual(result.upcomingLessons.map((lesson) => lesson.displayNumber), [4]);
});

test("completed and cancelled lessons cannot appear as upcoming even before their booked time", () => {
  const withStatuses = lessons.map((lesson, index) => ({
    ...lesson,
    status: index === 0 ? "completed" : index === 1 ? "cancelled" : "upcoming",
  }));
  const result = classLessonJourney(withStatuses, Date.parse("2026-09-13T09:00:00.000Z"));
  assert.equal(result.stage, "upcoming");
  assert.equal(result.focusLesson?.sessionId, 13);
  assert.deepEqual(result.upcomingLessons.map((lesson) => lesson.sessionId), [13, 14]);
  assert.deepEqual(result.previousLessons.map((lesson) => lesson.sessionId), [12, 11]);
});

test("a live lesson remains current if the scheduled end has elapsed", () => {
  const result = classLessonJourney(
    [{ ...lessons[0], status: "live" }],
    Date.parse("2026-09-13T12:00:00.000Z"),
  );
  assert.equal(result.stage, "current");
  assert.equal(result.remainingDates, 1);
  assert.deepEqual(result.previousLessons, []);
});

test("the exact booked start belongs to the current lesson", () => {
  assert.equal(
    classLessonJourney(lessons, Date.parse(lessons[0].startsAt)).stage,
    "current",
  );
});

test("the exact end no longer claims the lesson is current", () => {
  const result = classLessonJourney(
    lessons.slice(0, 1),
    Date.parse("2026-09-13T11:00:00.000Z"),
  );
  assert.equal(result.stage, "finished");
  assert.equal(result.passedDates, 1);
  assert.equal(result.remainingDates, 0);
});

test("a finished schedule never invents a next lesson", () => {
  const result = classLessonJourney(
    lessons,
    Date.parse("2026-09-17T10:00:00.000Z"),
  );
  assert.equal(result.stage, "finished");
  assert.equal(result.focusLesson?.sessionId, 14);
  assert.equal(result.focusNumber, 4);
  assert.deepEqual(
    result.visibleLessons.map((lesson) => lesson.sessionId),
    [12, 13, 14],
  );
  assert.equal(result.hiddenDates, 1);
});

test("an empty or invalid schedule is explicit", () => {
  assert.equal(classLessonJourney([], 0).stage, "empty");
  assert.equal(
    classLessonJourney([{ ...lessons[0], startsAt: "not-a-date" }], Date.now())
      .stage,
    "empty",
  );
});
