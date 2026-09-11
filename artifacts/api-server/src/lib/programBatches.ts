import { instantOfLocalTime } from "./monthlySchedule.ts";

export const PROGRAM_BATCH_TIME_ZONE = "Asia/Kathmandu";
export const PROGRAM_BATCH_DURATIONS = [30, 45, 60, 90] as const;
export const PROGRAM_BATCH_MAX_LESSONS = 60;

export interface ProgramBatchLessonInput {
  date: string;
  time: string;
  durationMinutes: number;
}

export interface ProgramBatchLesson {
  position: number;
  startsAt: Date;
  durationMinutes: number;
}

export interface ProgramBatchSnapshot {
  batchId: number;
  version: number;
  programId: number;
  programVersion: number;
  programTitle: string;
  capacity: number;
  totalTuitionNpr: number;
  timeZone: typeof PROGRAM_BATCH_TIME_ZONE;
  enrollmentClosesAt: string;
  lessons: Array<{ position: number; startsAt: string; durationMinutes: number }>;
}

export type BatchValidation =
  | { ok: true; capacity: number; totalTuitionNpr: number; lessons: ProgramBatchLesson[] }
  | { ok: false; issues: string[] };

/** Publication metadata is not a change to the promise students see. */
export function sameBatchOffer(a: ProgramBatchSnapshot | null, b: ProgramBatchSnapshot): boolean {
  return a !== null && a.batchId === b.batchId && a.programId === b.programId &&
    a.programVersion === b.programVersion && a.programTitle === b.programTitle &&
    a.capacity === b.capacity && a.totalTuitionNpr === b.totalTuitionNpr &&
    a.timeZone === b.timeZone && a.enrollmentClosesAt === b.enrollmentClosesAt &&
    a.lessons.length === b.lessons.length && a.lessons.every((lesson, index) => {
      const other = b.lessons[index]!;
      return lesson.position === other.position && lesson.startsAt === other.startsAt && lesson.durationMinutes === other.durationMinutes;
    });
}

function localInstant(date: string, time: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const dateNumber = Number(day[3]);
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (month < 1 || month > 12 || dateNumber < 1 || dateNumber > 31 || hour > 23 || minute > 59) return null;
  const utcMs = instantOfLocalTime(year, month, dateNumber, hour * 60 + minute, PROGRAM_BATCH_TIME_ZONE);
  const expected = `${day[1]}-${day[2]}-${day[3]}`;
  const actual = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROGRAM_BATCH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(utcMs));
  return actual === expected ? new Date(utcMs) : null;
}

export function validateProgramBatch(
  input: { capacity: unknown; totalTuitionNpr: unknown; lessons: unknown },
  nowMs: number,
): BatchValidation {
  const issues: string[] = [];
  const capacity = Number(input.capacity);
  const totalTuitionNpr = Number(input.totalTuitionNpr);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10) {
    issues.push("Choose a class size from 1 to 10 students.");
  }
  if (!Number.isSafeInteger(totalTuitionNpr) || totalTuitionNpr < 1) {
    issues.push("Enter the full Program price as a positive amount in NPR.");
  }
  if (!Array.isArray(input.lessons) || input.lessons.length < 1) {
    issues.push("Add at least one lesson before publishing this batch.");
  } else if (input.lessons.length > PROGRAM_BATCH_MAX_LESSONS) {
    issues.push(`A batch can have at most ${PROGRAM_BATCH_MAX_LESSONS} lessons.`);
  }

  const lessons: ProgramBatchLesson[] = [];
  if (Array.isArray(input.lessons) && input.lessons.length <= PROGRAM_BATCH_MAX_LESSONS) {
    input.lessons.forEach((raw, position) => {
      if (!raw || typeof raw !== "object") {
        issues.push(`Lesson ${position + 1} needs a date, time and duration.`);
        return;
      }
      const value = raw as Record<string, unknown>;
      const startsAt = localInstant(String(value.date ?? ""), String(value.time ?? ""));
      const durationMinutes = Number(value.durationMinutes);
      if (!startsAt) issues.push(`Lesson ${position + 1} needs a valid Nepal date and time.`);
      if (!PROGRAM_BATCH_DURATIONS.includes(durationMinutes as (typeof PROGRAM_BATCH_DURATIONS)[number])) {
        issues.push(`Lesson ${position + 1} must be 30, 45, 60 or 90 minutes.`);
      }
      if (startsAt && startsAt.getTime() <= nowMs) issues.push(`Lesson ${position + 1} must be in the future.`);
      if (startsAt && PROGRAM_BATCH_DURATIONS.includes(durationMinutes as (typeof PROGRAM_BATCH_DURATIONS)[number])) {
        lessons.push({ position, startsAt, durationMinutes });
      }
    });
  }
  for (let index = 1; index < lessons.length; index += 1) {
    if (lessons[index]!.startsAt.getTime() <= lessons[index - 1]!.startsAt.getTime()) {
      issues.push("Put lessons in date and time order, without duplicate times.");
      break;
    }
  }
  return issues.length > 0
    ? { ok: false, issues: [...new Set(issues)] }
    : { ok: true, capacity, totalTuitionNpr, lessons };
}

export function batchSnapshot(input: {
  batchId: number;
  version: number;
  programId: number;
  programVersion: number;
  programTitle: string;
  capacity: number;
  totalTuitionNpr: number;
  lessons: ProgramBatchLesson[];
}): ProgramBatchSnapshot {
  const lessons = input.lessons.map((lesson) => ({
    position: lesson.position,
    startsAt: lesson.startsAt.toISOString(),
    durationMinutes: lesson.durationMinutes,
  }));
  return {
    batchId: input.batchId,
    version: input.version,
    programId: input.programId,
    programVersion: input.programVersion,
    programTitle: input.programTitle,
    capacity: input.capacity,
    totalTuitionNpr: input.totalTuitionNpr,
    timeZone: PROGRAM_BATCH_TIME_ZONE,
    enrollmentClosesAt: lessons[0]!.startsAt,
    lessons,
  };
}

export function readBatchSnapshot(value: unknown): ProgramBatchSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ProgramBatchSnapshot>;
  if (
    !Number.isInteger(row.batchId) || !Number.isInteger(row.version) || !Number.isInteger(row.programId) ||
    !Number.isInteger(row.programVersion) || typeof row.programTitle !== "string" ||
    !Number.isInteger(row.capacity) || row.capacity! < 1 || row.capacity! > 10 ||
    !Number.isSafeInteger(row.totalTuitionNpr) || row.totalTuitionNpr! < 1 ||
    row.timeZone !== PROGRAM_BATCH_TIME_ZONE || typeof row.enrollmentClosesAt !== "string" ||
    !Array.isArray(row.lessons) || row.lessons.length < 1
  ) return null;
  let previous = -Infinity;
  for (let index = 0; index < row.lessons.length; index += 1) {
    const lesson = row.lessons[index];
    if (!lesson || typeof lesson !== "object") return null;
    const startsAt = Date.parse(lesson.startsAt);
    if (
      lesson.position !== index || !Number.isFinite(startsAt) || startsAt <= previous ||
      !PROGRAM_BATCH_DURATIONS.includes(lesson.durationMinutes as (typeof PROGRAM_BATCH_DURATIONS)[number])
    ) return null;
    previous = startsAt;
  }
  if (row.enrollmentClosesAt !== row.lessons[0]!.startsAt) return null;
  return row as ProgramBatchSnapshot;
}
