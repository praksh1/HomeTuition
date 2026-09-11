/** Shared group periods, not a student's payment anniversary and not legacy Monthly rules. */
export const TUITION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
export interface TuitionPeriod {
  groupId: number;
  index: number;
  startsAt: string;
  endsAt: string;
}

export function tuitionPeriod(groupId: number, index: number, anchor: Date): TuitionPeriod {
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(index) || index < 0 || index > 1200 || !Number.isFinite(anchor.getTime())) {
    throw new Error("Invalid tuition period");
  }
  const start = anchor.getTime() + index * TUITION_PERIOD_MS;
  return { groupId, index, startsAt: new Date(start).toISOString(), endsAt: new Date(start + TUITION_PERIOD_MS).toISOString() };
}

export function readTuitionPeriod(value: unknown): TuitionPeriod | null {
  if (!value || typeof value !== "object") return null;
  const p = value as TuitionPeriod;
  if (!Number.isSafeInteger(p.groupId) || p.groupId < 1 || !Number.isSafeInteger(p.index) || p.index < 0 || p.index > 1200 ||
      typeof p.startsAt !== "string" || typeof p.endsAt !== "string" || !Number.isFinite(Date.parse(p.startsAt)) ||
      Date.parse(p.endsAt) - Date.parse(p.startsAt) !== TUITION_PERIOD_MS) return null;
  return { groupId: p.groupId, index: p.index, startsAt: p.startsAt, endsAt: p.endsAt };
}

export function tuitionPeriodIssues(period: TuitionPeriod, lessons: Array<{ startsAt: Date; durationMinutes: number }>): string[] {
  const start = Date.parse(period.startsAt), end = Date.parse(period.endsAt);
  return lessons.flatMap((lesson, index) => {
    const at = lesson.startsAt.getTime();
    return at < start || at >= end || at + lesson.durationMinutes * 60000 > end
      ? [`Lesson ${index + 1} must start and finish inside this group's 30-day period.`] : [];
  });
}
