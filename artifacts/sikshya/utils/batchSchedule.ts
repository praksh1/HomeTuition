import type { ProgramBatchLessonDraft } from "./programBatches.ts";

export const BATCH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const BATCH_MAX_LESSONS = 60;

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
