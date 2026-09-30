import type { ProgramBatchLessonDraft, TuitionPeriod } from "./programBatches.ts";

export const BATCH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const BATCH_MAX_LESSONS = 60;
export type ClassFrequency = "daily" | "weekly" | "twice_weekly" | "every_two_weeks" | "alternate" | "weekdays" | "own";

/** A bounded text field, not a huge number that only fails on the next screen. */
export function lessonCountInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 2);
  return digits ? String(Math.min(BATCH_MAX_LESSONS, Number(digits))) : "";
}

/** Keep existing dates; removing an edited row always needs the teacher's consent. */
export function reconcileLessonCount(lessons: ProgramBatchLessonDraft[], count: number, blankTemplates: ProgramBatchLessonDraft[] | null = null): {
  lessons: ProgramBatchLessonDraft[]; removed: number; added: number; needsConfirmation: boolean;
} {
  if (!Number.isInteger(count) || count < 1 || count > BATCH_MAX_LESSONS || !lessons[0])
    throw new Error("Choose 1 to 60 lessons before updating the timetable.");
  const first = lessons[0];
  const removed = lessons.slice(count);
  const added = Math.max(0, count - lessons.length);
  return {
    lessons: [
      ...lessons.slice(0, count).map((lesson) => ({ ...lesson })),
      ...Array.from({ length: added }, () => ({ ...first, date: "" })),
    ],
    removed: removed.length,
    added,
    needsConfirmation: removed.some((lesson, index) => {
      const template = blankTemplates?.[count + index] ?? first;
      return lesson.date !== "" || lesson.time !== template.time || lesson.durationMinutes !== template.durationMinutes;
    }),
  };
}

/** A short course's boundaries come from its actual timetable, never a second calendar. */
export function courseScheduleRange(lessons: ProgramBatchLessonDraft[], expectedCount: number): { startsAt: string; endsAt: string } | null {
  if (!lessons.length || lessons.length !== expectedCount) return null;
  const slots = lessons.map((lesson) => {
    if (!calendarDay(lesson.date) || !validLessonTime(lesson.time) || ![30, 45, 60, 90].includes(lesson.durationMinutes)) return null;
    const start = Date.parse(`${lesson.date}T${lesson.time}:00+05:45`);
    return { start, end: start + lesson.durationMinutes * 60_000 };
  });
  if (slots.some((slot) => !slot)) return null;
  const complete = slots as { start: number; end: number }[];
  return {
    startsAt: new Date(Math.min(...complete.map((slot) => slot.start))).toISOString(),
    endsAt: new Date(Math.max(...complete.map((slot) => slot.end))).toISOString(),
  };
}

/** Calendar arithmetic, not device-local instants: DST abroad must not move Nepal lessons. */
export function calendarDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value ? day : null;
}

export function validLessonTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function repeatLessons(first: ProgramBatchLessonDraft, count: number, weekdays: number[]):
  { ok: true; lessons: ProgramBatchLessonDraft[] } | { ok: false; message: string } {
  const day = calendarDay(first.date);
  if (!day) return { ok: false, message: "Choose the first lesson date from the calendar." };
  if (!validLessonTime(first.time)) return { ok: false, message: "Choose a start time in Nepal time." };
  if (![30, 45, 60, 90].includes(first.durationMinutes)) return { ok: false, message: "Choose a lesson duration." };
  if (!Number.isInteger(count) || count < 1 || count > BATCH_MAX_LESSONS) return { ok: false, message: "Choose 1 to 60 lessons." };
  if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return { ok: false, message: "Select at least one teaching day." };
  if (!weekdays.includes(day.getUTCDay())) return { ok: false, message: "Include the first lesson’s weekday, or choose a different first date." };
  const lessons: ProgramBatchLessonDraft[] = [];
  while (lessons.length < count) {
    if (weekdays.includes(day.getUTCDay())) lessons.push({ ...first, date: day.toISOString().slice(0, 10) });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return { ok: true, lessons };
}

/** Explicit dates inside the period; never silently continue into a second period. */
export function repeatPeriodLessons(first: ProgramBatchLessonDraft, weekdays: number[], period: TuitionPeriod | null): ReturnType<typeof repeatLessons> {
  if (!period) return { ok: false, message: "Choose Lesson 1's date and time to set the period." };
  const repeated = repeatLessons(first, BATCH_MAX_LESSONS, weekdays);
  if (!repeated.ok) return repeated;
  const start = Date.parse(period.startsAt), end = Date.parse(period.endsAt);
  const firstAt = Date.parse(`${first.date}T${first.time}:00+05:45`);
  if (firstAt < start || firstAt + first.durationMinutes * 60000 > end) return { ok: false, message: "Choose a first lesson inside this 30-day period." };
  const lessons = repeated.lessons.filter((lesson) => Date.parse(`${lesson.date}T${lesson.time}:00+05:45`) + lesson.durationMinutes * 60000 <= end);
  return lessons.length ? { ok: true, lessons } : { ok: false, message: "No complete lesson fits inside this period." };
}

/** A class always has the teacher's exact number of lessons; a 30-day period is not a lesson count. */
export function prepareClassLessons(
  first: ProgramBatchLessonDraft,
  count: number,
  frequency: ClassFrequency,
  weekdays: number[],
  period: TuitionPeriod | null,
): ReturnType<typeof repeatLessons> {
  const firstDay = calendarDay(first.date);
  if (!firstDay) return { ok: false, message: "Choose the first lesson date from the calendar." };
  if (!validLessonTime(first.time)) return { ok: false, message: "Choose a start time in Nepal time." };
  if (![30, 45, 60, 90].includes(first.durationMinutes)) return { ok: false, message: "Choose a lesson duration." };
  if (!Number.isInteger(count) || count < 1 || count > BATCH_MAX_LESSONS) return { ok: false, message: "Choose 1 to 60 lessons." };
  if (period && Date.parse(`${first.date}T${first.time}:00+05:45`) < Date.parse(period.startsAt))
    return { ok: false, message: "Start inside this 30-day period." };
  if (frequency === "own") return { ok: true, lessons: [first, ...Array.from({ length: count - 1 }, () => ({ ...first, date: "" }))] };
  if ((frequency === "weekly" || frequency === "every_two_weeks") && (weekdays.length !== 1 || weekdays[0] !== firstDay.getUTCDay()))
    return { ok: false, message: "For weekly or every-two-weeks lessons, select the first lesson's weekday." };
  if (frequency === "twice_weekly" && (weekdays.length !== 2 || !weekdays.includes(firstDay.getUTCDay())))
    return { ok: false, message: "For twice-weekly lessons, select two weekdays including the first lesson's day." };
  if (frequency === "weekdays" && (!weekdays.length || !weekdays.includes(firstDay.getUTCDay())))
    return { ok: false, message: "Choose teaching weekdays that include the first lesson's day." };
  const chosenDays = frequency === "daily" ? [0, 1, 2, 3, 4, 5, 6] : weekdays;
  const lessons: ProgramBatchLessonDraft[] = [];
  const day = new Date(firstDay);
  const end = period ? Date.parse(period.endsAt) : Infinity;
  while (lessons.length < count) {
    const elapsed = Math.round((day.getTime() - firstDay.getTime()) / 86_400_000);
    const matches = frequency === "alternate" ? elapsed % 2 === 0
      : frequency === "every_two_weeks" ? elapsed % 14 === 0 : chosenDays.includes(day.getUTCDay());
    if (matches) {
      const date = day.toISOString().slice(0, 10);
      const startsAt = Date.parse(`${date}T${first.time}:00+05:45`);
      if (startsAt + first.durationMinutes * 60_000 > end)
        return { ok: false, message: frequency === "daily"
          ? `Only ${lessons.length} daily lessons fit in this 30-day period: Daily schedules one lesson per day. Reduce the count, use Pick my own dates for more than one lesson a day, or choose a short course for a longer timetable.`
          : `Only ${lessons.length} ${lessons.length === 1 ? "lesson fits" : "lessons fit"} in these 30 days. Choose fewer lessons, a more frequent pattern, or Pick my own dates.` };
      lessons.push({ ...first, date });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return { ok: true, lessons };
}

export function batchDetailsIssues(capacity: string, price: string): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(Number(capacity)) || Number(capacity) < 1 || Number(capacity) > 10) issues.push("Choose a class size from 1 to 10 students.");
  if (!Number.isSafeInteger(Number(price)) || Number(price) < 1) issues.push("Enter one positive whole-rupee price for all lessons together.");
  return issues;
}

export function batchScheduleIssues(lessons: ProgramBatchLessonDraft[], nowMs: number): string[] {
  if (!lessons.length || lessons.length > BATCH_MAX_LESSONS) return ["Add 1 to 60 lessons."];
  const issues: string[] = [];
  let previous = -Infinity;
  lessons.forEach((lesson, index) => {
    if (!calendarDay(lesson.date) || !validLessonTime(lesson.time)) {
      issues.push(`Lesson ${index + 1}: choose a valid date and start time.`);
      return;
    }
    const instant = Date.parse(`${lesson.date}T${lesson.time}:00+05:45`);
    if (instant <= nowMs) issues.push(`Lesson ${index + 1}: choose a future start time in Nepal.`);
    if (instant < previous) issues.push(`Lesson ${index + 1}: dates must be in order.`);
    if (![30, 45, 60, 90].includes(lesson.durationMinutes)) issues.push(`Lesson ${index + 1}: choose 30, 45, 60 or 90 minutes.`);
    previous = instant;
  });
  return issues;
}
