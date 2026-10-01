import assert from "node:assert/strict";
import test from "node:test";
import {
  readMoreTeacherSchedule, readTeacherSchedule, teacherScheduleHasMore,
  teacherScheduleRows, teacherScheduleTotal, TeacherScheduleChangedError,
  type TeacherSchedulePage, type TeacherScheduleStatus,
} from "./teacherSchedulePages.ts";

const now = Date.UTC(2026, 9, 1);
const row = (id: number, offset: number, expired = false) => ({ id, date: new Date(now + offset * 60_000).toISOString(), expired });
type Row = ReturnType<typeof row>;
type Source = Partial<Record<TeacherScheduleStatus, Row[]>>;
const sourceReader = (source: Source, calls: string[] = []) => async (status: TeacherScheduleStatus, page: number, limit: number) => {
  calls.push(`${status}:${page}`);
  const rows = source[status] ?? [];
  return { sessions: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
};

for (const mode of ["upcoming", "live"] as const) test(`${mode}: fetch one page and load all 251 only on explicit taps`, async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: 251 }, (_, i) => row(i + 1, i + 1));
  const read = sourceReader({ [mode]: rows }, calls);
  let snapshot = await readTeacherSchedule(mode, read);
  assert.equal(teacherScheduleRows(snapshot).length, 100);
  assert.equal(teacherScheduleTotal(snapshot), 251);
  assert.equal(teacherScheduleHasMore(snapshot), true);
  assert.deepEqual(calls, [`${mode}:1`]);
  snapshot = await readMoreTeacherSchedule(snapshot, read);
  assert.equal(teacherScheduleRows(snapshot).length, 200);
  snapshot = await readMoreTeacherSchedule(snapshot, read);
  assert.equal(teacherScheduleRows(snapshot).length, 251);
  assert.equal(teacherScheduleHasMore(snapshot), false);
  assert.deepEqual(calls, [`${mode}:1`, `${mode}:2`, `${mode}:3`]);
});

test("upcoming is nearest first even if input server order differs", async () => {
  const snapshot = await readTeacherSchedule("upcoming", sourceReader({ upcoming: [row(2, 20), row(1, 10)] }));
  assert.deepEqual(teacherScheduleRows(snapshot).map((r) => r.id), [1, 2]);
});

test("History merges three status streams only through their common frontier", async () => {
  const source: Source = {
    completed: Array.from({ length: 220 }, (_, i) => row(i + 1, -i)),
    cancelled: Array.from({ length: 130 }, (_, i) => row(1000 + i, -500 - i)),
    missed: Array.from({ length: 105 }, (_, i) => row(2000 + i, -1000 - i, true)),
  };
  const calls: string[] = [];
  const read = sourceReader(source, calls);
  let snapshot = await readTeacherSchedule("history", read);
  assert.equal(teacherScheduleRows(snapshot).length, 100);
  assert.equal(teacherScheduleTotal(snapshot), 455);
  assert.deepEqual(calls, ["completed:1", "cancelled:1", "missed:1"]);
  snapshot = await readMoreTeacherSchedule(snapshot, read);
  assert.equal(teacherScheduleRows(snapshot).length, 200);
  snapshot = await readMoreTeacherSchedule(snapshot, read);
  const rows = teacherScheduleRows(snapshot);
  assert.equal(rows.length, 455);
  assert.equal(teacherScheduleHasMore(snapshot), false);
  assert.deepEqual(calls.slice(-1), ["completed:3"]);
  assert.ok(rows.every((r, i) => i === 0 || Date.parse(rows[i - 1].date) >= Date.parse(r.date)));
});

test("quiet refresh rereads loaded depth without fetching the full 10,000-row account", async () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => row(i + 1, i));
  const read = sourceReader({ upcoming: rows });
  let snapshot = await readTeacherSchedule("upcoming", read);
  snapshot = await readMoreTeacherSchedule(snapshot, read);
  const calls: string[] = [];
  const refreshed = await readTeacherSchedule("upcoming", sourceReader({ upcoming: rows }, calls), () => true, snapshot);
  assert.deepEqual(calls, ["upcoming:1", "upcoming:2"]);
  assert.equal(teacherScheduleRows(refreshed).length, 200);
  assert.equal(teacherScheduleTotal(refreshed), 10_000);
});

test("shrinking schedule refresh preserves only the new authoritative rows", async () => {
  const rows = Array.from({ length: 140 }, (_, i) => row(i + 1, i));
  const read = sourceReader({ upcoming: rows });
  const previous = await readMoreTeacherSchedule(await readTeacherSchedule("upcoming", read), read);
  const refreshed = await readTeacherSchedule("upcoming", sourceReader({ upcoming: rows.slice(0, 30) }), () => true, previous);
  assert.equal(teacherScheduleRows(refreshed).length, 30);
  assert.equal(refreshed.buckets[0].pages, 1);
});

test("later-page failure leaves the supplied snapshot unchanged and retry is possible", async () => {
  const read = sourceReader({ upcoming: Array.from({ length: 140 }, (_, i) => row(i + 1, i)) });
  const previous = await readTeacherSchedule("upcoming", read);
  const before = JSON.stringify(previous);
  await assert.rejects(readMoreTeacherSchedule(previous, async () => { throw new Error("offline"); }), /offline/);
  assert.equal(JSON.stringify(previous), before);
  assert.equal(teacherScheduleRows(await readMoreTeacherSchedule(previous, read)).length, 140);
});

test("failure of one History status never commits the other statuses' later page", async () => {
  const source: Source = Object.fromEntries(["completed", "cancelled", "missed"].map((status, n) =>
    [status, Array.from({ length: 130 }, (_, i) => row(1 + n * 1000 + i, -i, status === "missed"))]));
  const read = sourceReader(source);
  const previous = await readTeacherSchedule("history", read);
  const before = JSON.stringify(previous);
  await assert.rejects(readMoreTeacherSchedule(previous, async (status, page, limit) => {
    if (status === "cancelled") throw new Error("offline");
    return read(status, page, limit);
  }), /offline/);
  assert.equal(JSON.stringify(previous), before);
});

test("changed totals fail explicitly rather than claim a complete offset read", async () => {
  const read = sourceReader({ upcoming: Array.from({ length: 140 }, (_, i) => row(i + 1, i)) });
  const previous = await readTeacherSchedule("upcoming", read);
  await assert.rejects(readMoreTeacherSchedule(previous, async (status, page, limit) => ({
    ...await read(status, page, limit), total: 141, sessions: Array.from({ length: 41 }, (_, i) => row(101 + i, i)),
  })), TeacherScheduleChangedError);
});

test("duplicate offset overlap fails rather than remove a lesson invisibly", async () => {
  const read = sourceReader({ upcoming: Array.from({ length: 140 }, (_, i) => row(i + 1, i)) });
  const previous = await readTeacherSchedule("upcoming", read);
  await assert.rejects(readMoreTeacherSchedule(previous, async (status, page, limit) => ({
    ...await read(status, page, limit), sessions: Array.from({ length: 40 }, (_, i) => row(100 + i, i)),
  })), TeacherScheduleChangedError);
});

test("same lesson appearing in two History statuses is a changed schedule", async () => {
  await assert.rejects(readTeacherSchedule("history", sourceReader({ completed: [row(1, -1)], cancelled: [row(1, -1)] })), TeacherScheduleChangedError);
});

test("late filter/account/focus responses cannot commit or fetch another page", async () => {
  let isCurrent = true;
  const calls: string[] = [];
  const read = sourceReader({ upcoming: Array.from({ length: 140 }, (_, i) => row(i + 1, i)) }, calls);
  await assert.rejects(readTeacherSchedule("upcoming", async (...args) => {
    const result = await read(...args); isCurrent = false; return result;
  }, () => isCurrent), /no longer current/);
  assert.deepEqual(calls, ["upcoming:1"]);
});

test("empty authoritative page is complete, not a request for an endless next page", async () => {
  const snapshot = await readTeacherSchedule("history", sourceReader({}));
  assert.equal(teacherScheduleTotal(snapshot), 0);
  assert.equal(teacherScheduleRows(snapshot).length, 0);
  assert.equal(teacherScheduleHasMore(snapshot), false);
});

test("clock-filtered semantics remain: future Upcoming only and expired missed rows only", async () => {
  const upcoming = await readTeacherSchedule("upcoming", sourceReader({ upcoming: [row(1, 10), row(2, -10, true)] }));
  assert.deepEqual(teacherScheduleRows(upcoming).map((r) => r.id), [1]);
  const history = await readTeacherSchedule("history", sourceReader({ missed: [row(3, -10, true), row(4, 10)] }));
  assert.deepEqual(teacherScheduleRows(history).map((r) => r.id), [3]);
});

for (const malformed of [
  { total: -1 }, { total: 1.5 }, { page: 2 }, { limit: 20 }, { sessions: [] },
  { sessions: [row(0, 1)] }, { sessions: [{ ...row(1, 1), date: "invalid" }] },
]) test(`malformed page is rejected: ${JSON.stringify(malformed)}`, async () => {
  await assert.rejects(readTeacherSchedule("upcoming", async () => ({
    sessions: [row(1, 1)], total: 1, page: 1, limit: 100, ...malformed,
  } as TeacherSchedulePage<Row>)));
});
