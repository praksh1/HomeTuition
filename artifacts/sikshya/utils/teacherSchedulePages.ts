export const TEACHER_SCHEDULE_PAGE_SIZE = 100;
export type TeacherScheduleMode = "upcoming" | "live" | "history";
export type TeacherScheduleStatus = "upcoming" | "live" | "completed" | "cancelled" | "missed";

export interface TeacherScheduleRow { id: number | string; date: string; expired?: boolean }
export interface TeacherSchedulePage<T> { sessions: T[]; total: number; page: number; limit: number }
export interface TeacherScheduleBucket<T> {
  status: TeacherScheduleStatus;
  rows: T[];
  total: number;
  pages: number;
}
export interface TeacherScheduleSnapshot<T> {
  mode: TeacherScheduleMode;
  buckets: TeacherScheduleBucket<T>[];
}
type ReadPage<T> = (status: TeacherScheduleStatus, page: number, limit: number) => Promise<TeacherSchedulePage<T>>;

export class TeacherScheduleChangedError extends Error {
  constructor() { super("Your schedule changed while loading. Refresh to see the latest lessons."); }
}

function current(check: () => boolean) {
  if (!check()) throw new Error("This schedule read is no longer current.");
}

function validatePage<T extends TeacherScheduleRow>(
  response: TeacherSchedulePage<T>, page: number, expectedTotal?: number,
): T[] {
  if (!response || !Array.isArray(response.sessions) || !Number.isSafeInteger(response.total) ||
      response.total < 0 || response.page !== page || response.limit !== TEACHER_SCHEDULE_PAGE_SIZE ||
      response.sessions.length !== Math.min(TEACHER_SCHEDULE_PAGE_SIZE,
        Math.max(0, response.total - (page - 1) * TEACHER_SCHEDULE_PAGE_SIZE))) {
    throw new Error("The schedule returned an incomplete page.");
  }
  if (expectedTotal !== undefined && response.total !== expectedTotal) throw new TeacherScheduleChangedError();
  for (const row of response.sessions) {
    if (!row || (typeof row.id !== "number" && typeof row.id !== "string") ||
        (typeof row.id === "number" && (!Number.isSafeInteger(row.id) || row.id <= 0)) ||
        (typeof row.id === "string" && !row.id.trim()) || !Number.isFinite(Date.parse(row.date))) {
      throw new Error("The schedule returned an invalid lesson.");
    }
  }
  return response.sessions;
}

function assertUnique<T extends TeacherScheduleRow>(buckets: TeacherScheduleBucket<T>[]) {
  const ids = new Set<string>();
  for (const bucket of buckets) for (const row of bucket.rows) {
    if (ids.has(String(row.id))) throw new TeacherScheduleChangedError();
    ids.add(String(row.id));
  }
}

const statusesFor = (mode: TeacherScheduleMode): TeacherScheduleStatus[] =>
  mode === "history" ? ["completed", "cancelled", "missed"] : [mode];

/** Refresh only the depth the teacher already requested, not every lesson in the account. */
export async function readTeacherSchedule<T extends TeacherScheduleRow>(
  mode: TeacherScheduleMode, readPage: ReadPage<T>, isCurrent: () => boolean = () => true,
  previous?: TeacherScheduleSnapshot<T>,
): Promise<TeacherScheduleSnapshot<T>> {
  current(isCurrent);
  const buckets = await Promise.all(statusesFor(mode).map(async (status) => {
    const depth = previous?.mode === mode
      ? previous.buckets.find((bucket) => bucket.status === status)?.pages ?? 1 : 1;
    const rows: T[] = [];
    let total = 0;
    let pages = 0;
    for (let page = 1; page <= depth; page++) {
      current(isCurrent);
      const response = await readPage(status, page, TEACHER_SCHEDULE_PAGE_SIZE);
      current(isCurrent);
      rows.push(...validatePage(response, page, page === 1 ? undefined : total));
      total = response.total;
      pages = page;
      if (rows.length >= total) break;
    }
    return { status, rows, total, pages };
  }));
  current(isCurrent);
  assertUnique(buckets);
  return { mode, buckets };
}

/** All buckets commit together: a failed History page cannot erase other loaded outcomes. */
export async function readMoreTeacherSchedule<T extends TeacherScheduleRow>(
  previous: TeacherScheduleSnapshot<T>, readPage: ReadPage<T>, isCurrent: () => boolean = () => true,
): Promise<TeacherScheduleSnapshot<T>> {
  current(isCurrent);
  const buckets = await Promise.all(previous.buckets.map(async (bucket) => {
    if (bucket.rows.length >= bucket.total) return bucket;
    const page = bucket.pages + 1;
    const response = await readPage(bucket.status, page, TEACHER_SCHEDULE_PAGE_SIZE);
    current(isCurrent);
    const rows = validatePage(response, page, bucket.total);
    return { ...bucket, rows: [...bucket.rows, ...rows], pages: page };
  }));
  current(isCurrent);
  assertUnique(buckets);
  return { ...previous, buckets };
}

export function teacherScheduleTotal<T>(snapshot: TeacherScheduleSnapshot<T>): number {
  return snapshot.buckets.reduce((sum, bucket) => sum + bucket.total, 0);
}

export function teacherScheduleHasMore<T>(snapshot: TeacherScheduleSnapshot<T>): boolean {
  return snapshot.buckets.some((bucket) => bucket.rows.length < bucket.total);
}

/**
 * History is three independent newest-first streams. Until all are exhausted, only expose
 * their common time frontier; otherwise old cancelled dates can appear ahead of unseen,
 * newer completed lessons. The next tap advances each unfinished stream by one page.
 */
export function teacherScheduleRows<T extends TeacherScheduleRow>(snapshot: TeacherScheduleSnapshot<T>): T[] {
  const pending = snapshot.buckets.filter((bucket) => bucket.rows.length < bucket.total);
  const frontier = snapshot.mode === "history" && pending.length
    ? Math.max(...pending.map((bucket) => bucket.rows.reduce((oldest, row) => Math.min(oldest, Date.parse(row.date)), Infinity)))
    : -Infinity;
  return snapshot.buckets.flatMap((bucket) => bucket.rows.filter((row) =>
    (snapshot.mode !== "upcoming" || !row.expired) &&
    (bucket.status !== "missed" || row.expired) && Date.parse(row.date) >= frontier,
  )).sort((a, b) => {
    const difference = Date.parse(a.date) - Date.parse(b.date);
    return snapshot.mode === "history" ? -difference : difference;
  });
}
