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

export interface OwnerProgramBatch {
  id: number;
  programId: number;
  status: "draft" | "published" | "closed" | string;
  capacity: number | null;
  totalTuitionNpr: number | null;
  version: number;
  publishedAt: string | null;
  published: ProgramBatchSnapshot | null;
  lessons: Array<{ id: number; position: number; startsAt: string; durationMinutes: number }>;
  updatedAt: string;
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
