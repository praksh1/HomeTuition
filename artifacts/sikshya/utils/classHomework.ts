import { batchDateValue, lessonDraft } from "./programBatches.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Convert a Nepal wall-clock deadline into the one instant sent to the server. */
export function homeworkDeadlineIso(date: string, time: string): string | null {
  if (!DATE.test(date) || !TIME.test(time) || !batchDateValue(date)) return null;
  const value = new Date(`${date}T${time}:00+05:45`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

/** Read a stored instant back as Nepal wall-clock parts, regardless of device timezone. */
export function homeworkDeadlineParts(value: string): { date: string; time: string } | null {
  if (!Number.isFinite(Date.parse(value))) return null;
  const draft = lessonDraft({ startsAt: value, durationMinutes: 0 });
  return draft.date && draft.time ? { date: draft.date, time: draft.time } : null;
}
