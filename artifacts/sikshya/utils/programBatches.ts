export interface ProgramBatchLessonDraft {
  date: string;
  time: string;
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
  timeZone: "Asia/Kathmandu";
  enrollmentClosesAt: string;
  lessons: Array<{ position: number; startsAt: string; durationMinutes: number }>;
}

/** A local calendar carrier for the picker, not an instant to serialize to the server. */
export function batchDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  const parts = value.split("-").map(Number);
  return Number.isNaN(date.getTime()) || date.getFullYear() !== parts[0] || date.getMonth() + 1 !== parts[1] || date.getDate() !== parts[2] ? null : date;
}

/** The native picker needs a Date even though the server stores only a Nepal wall-clock time. */
export function batchTimeValue(value: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hours = match ? Number(match[1]) : 9;
  const minutes = match ? Number(match[2]) : 0;
  const safeHours = Number.isInteger(hours) && hours >= 0 && hours <= 23 ? hours : 9;
  const safeMinutes = Number.isInteger(minutes) && minutes >= 0 && minutes <= 59 ? minutes : 0;
  return new Date(2000, 0, 1, safeHours, safeMinutes, 0, 0);
}

export function batchTimeDraft(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export interface OwnerProgramBatch {
  id: number;
  programId: number;
  currentProgramVersion?: number | null;
  scheduleIssues?: string[];
  status: "draft" | "published" | "closed" | string;
  capacity: number | null;
  totalTuitionNpr: number | null;
  version: number;
  publishedAt: string | null;
  published: ProgramBatchSnapshot | null;
  lessons: Array<{ id: number; position: number; startsAt: string; durationMinutes: number }>;
  updatedAt: string;
}

export function batchMatchesPublication(batch: OwnerProgramBatch): boolean {
  const published = batch.published;
  return batch.status === "published" && published !== null &&
    batch.version === published.version && batch.id === published.batchId && batch.programId === published.programId &&
    batch.currentProgramVersion === published.programVersion &&
    batch.capacity === published.capacity && batch.totalTuitionNpr === published.totalTuitionNpr &&
    batch.lessons.length === published.lessons.length && batch.lessons.every((lesson, index) => {
      const other = published.lessons[index]!;
      return lesson.position === other.position && Date.parse(lesson.startsAt) === Date.parse(other.startsAt) && lesson.durationMinutes === other.durationMinutes;
    });
}

/** Copy teaching settings only. Every new run needs fresh dates and its own explicit review. */
export function batchTemplate(batch: OwnerProgramBatch) {
  return {
    capacity: batch.capacity === null ? "" : String(batch.capacity),
    totalTuitionNpr: batch.totalTuitionNpr === null ? "" : String(batch.totalTuitionNpr),
    lessons: batch.lessons.length ? batch.lessons.map((lesson) => ({ ...lessonDraft(lesson), date: "" })) : [{ date: "", time: "", durationMinutes: 60 }],
  };
}

export function nepalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-NP", {
    timeZone: "Asia/Kathmandu",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date) + " Nepal time";
}

export function lessonDraft(value: { startsAt: string; durationMinutes: number }): ProgramBatchLessonDraft {
  const date = new Date(value.startsAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour") === "24" ? "00" : read("hour")}:${read("minute")}`,
    durationMinutes: value.durationMinutes,
  };
}

export function fullBatchPrice(amount: number): string {
  return `NPR ${amount.toLocaleString()} total for the full batch`;
}
