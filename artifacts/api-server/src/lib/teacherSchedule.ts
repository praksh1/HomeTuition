import { and, eq, inArray } from "drizzle-orm";
import { db, sessionsTable, recurringDaysTable, recurringSessionsTable, learningProgramBatchesTable, learningProgramsTable } from "@workspace/db";
import { readBatchSnapshot } from "./programBatches";
import { classInstants, localDayKey } from "./monthlySchedule";
import { lockScheduleQuota } from "./scheduleChanges";
import { conflictMessages, ScheduleConflictError, type TeachingSlot } from "./scheduleIntervals";

type Reader = Pick<typeof db, "select">;
export { lockScheduleQuota as lockTeacherSchedule };
interface Exclusions { batchId?: number; sessionId?: number; recurringId?: number }

/** The published promise reserves time, not an owner's unsaved/unpublished replacement draft.
 * Suspended/unlisted Programs retain their reservation until the Batch is explicitly closed.
 * No new table: Monthly days and their materialised sessions remain the existing sources of truth.
 */
async function recordedSchedule(reader: Reader, teacherId: number, exclude: Exclusions) {
  const sessions = await reader.select().from(sessionsTable).where(and(eq(sessionsTable.teacherId, teacherId), inArray(sessionsTable.status, ["upcoming", "live"])));
  const days = await reader.select({ day: recurringDaysTable, course: recurringSessionsTable }).from(recurringDaysTable)
    .innerJoin(recurringSessionsTable, eq(recurringSessionsTable.id, recurringDaysTable.recurringId))
    .where(eq(recurringSessionsTable.teacherId, teacherId));
  const courses = await reader.select().from(recurringSessionsTable).where(and(eq(recurringSessionsTable.teacherId, teacherId), eq(recurringSessionsTable.status, "active")));
  const batches = await reader.select({ id: learningProgramBatchesTable.id, snapshot: learningProgramBatchesTable.publishedSnapshot })
    .from(learningProgramBatchesTable).innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramBatchesTable.programId))
    .where(and(eq(learningProgramsTable.teacherId, teacherId), eq(learningProgramBatchesTable.status, "published")));
  const ignoredSessions = new Set(days.filter(({ day }) => day.recurringId === exclude.recurringId).map(({ day }) => day.sessionId));
  const slots: TeachingSlot[] = sessions.filter((row) => row.id !== exclude.sessionId && !ignoredSessions.has(row.id))
    .map((row) => ({ startsAt: row.date, durationMinutes: row.duration, label: `class “${row.topic}”` }));
  for (const { day, course } of days) {
    // A materialised session is authoritative and already included above.
    if (day.sessionId !== null || course.id === exclude.recurringId || course.status !== "active" || day.status !== "planned") continue;
    slots.push({ startsAt: day.scheduledFor, durationMinutes: course.durationMinutes, label: `${day.kind === "makeup" ? "make-up" : "Monthly class"} “${course.topic}”` });
  }
  for (const row of batches) {
    if (row.id === exclude.batchId) continue;
    const snapshot = readBatchSnapshot(row.snapshot);
    // Corrupt stored offers must never be interpreted as an empty calendar.
    if (!snapshot) throw new Error("Published Batch schedule is unreadable");
    for (const lesson of snapshot.lessons) slots.push({ startsAt: new Date(lesson.startsAt), durationMinutes: lesson.durationMinutes, label: `“${snapshot.programTitle}”, Batch ${row.id}, lesson ${lesson.position + 1}` });
  }
  return { slots, courses, days };
}

export async function teacherScheduleIssues(reader: Reader, teacherId: number, proposed: TeachingSlot[], exclude: Exclusions = {}): Promise<string[]> {
  if (!proposed.length) return [];
  const { slots, courses, days } = await recordedSchedule(reader, teacherId, exclude);
  for (const course of courses) {
    if (course.id === exclude.recurringId) continue;
    // Project only around the requested slots, not every day between two distant batch lessons.
    const recordedDates = new Set(days.filter(({ day }) => day.recurringId === course.id && day.kind === "regular")
      .map(({ day }) => localDayKey(day.scheduledFor.getTime(), course.timeZone)));
    const seen = new Set<number>();
    for (const candidate of proposed) {
      const from = Math.max(course.createdAt.getTime(), candidate.startsAt.getTime() - course.durationMinutes * 60_000);
      const to = candidate.startsAt.getTime() + candidate.durationMinutes * 60_000;
      for (const at of classInstants(from, to, course.startMinute, course.timeZone)) {
        if (seen.has(at) || recordedDates.has(localDayKey(at, course.timeZone))) continue;
        seen.add(at);
        slots.push({ startsAt: new Date(at), durationMinutes: course.durationMinutes, label: `Monthly class “${course.topic}”` });
      }
    }
  }
  return conflictMessages(proposed, slots);
}

export async function assertTeacherSchedule(reader: Reader, teacherId: number, proposed: TeachingSlot[], exclude: Exclusions = {}) {
  const issues = await teacherScheduleIssues(reader, teacherId, proposed, exclude);
  if (issues.length) throw new ScheduleConflictError(issues);
}

/** A new/changed daily timetable must respect even distant already-published batches.
 * Probe around every finite commitment as well as the next cycle for another repeating class.
 */
export async function assertDailySchedule(reader: Reader, course: { teacherId: number; startMinute: number; durationMinutes: number; timeZone: string; topic: string }, now: number, exclude: Exclusions = {}) {
  const { slots } = await recordedSchedule(reader, course.teacherId, exclude);
  const times = new Set(classInstants(now, now + 30 * 86400_000, course.startMinute, course.timeZone));
  for (const slot of slots) {
    const end = slot.startsAt.getTime() + slot.durationMinutes * 60_000;
    if (end <= now) continue;
    for (const at of classInstants(Math.max(now, slot.startsAt.getTime() - course.durationMinutes * 60_000), end, course.startMinute, course.timeZone)) times.add(at);
  }
  await assertTeacherSchedule(reader, course.teacherId, [...times].map((at) => ({ startsAt: new Date(at), durationMinutes: course.durationMinutes, label: `Monthly class “${course.topic}”` })), exclude);
}
