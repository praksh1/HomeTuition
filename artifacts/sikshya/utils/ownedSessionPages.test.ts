import assert from "node:assert/strict";
import test from "node:test";
import { readCompleteOwnedSessions, type OwnedSessionPage } from "./ownedSessionPages.ts";
import { studentClassSection, studentSessionSection } from "./studentSessionGroups.ts";

const now = Date.parse("2026-09-30T12:00:00Z");
const day = 86_400_000;
const timetable = Array.from({ length: 230 }, (_, index) => {
  const id = index + 1;
  const continuing = id <= 130;
  return {
    id,
    date: new Date(id === 120 ? now - 60_000 : id === 119 ? now + day : id < 119 ? now + (130 - id) * day : now - (id - 119) * day).toISOString(),
    duration: 60,
    status: id === 120 ? "live" : id <= 120 ? "upcoming" : "completed",
    classGroup: { batchId: continuing ? 11 : 22, lessonCount: continuing ? 130 : 100 },
  };
});
type Row = typeof timetable[number];
const pageOf = <T,>(rows: T[], page: number, limit: number): OwnedSessionPage<T> => ({
  sessions: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit,
});

test("a complete owned read includes nearest/live on page two and history on page three", async () => {
  const requests: number[] = [];
  const rows = await readCompleteOwnedSessions(async (page, limit) => {
    requests.push(page);
    assert.equal(limit, 100);
    return pageOf(timetable, page, limit);
  });
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(rows.length, 230);
  assert.equal(rows.find(row => row.id === 120)?.status, "live");
  assert.equal(rows.find(row => row.id === 230)?.status, "completed");
  const continuing = rows.filter(row => row.classGroup.batchId === 11);
  const nearest = continuing.filter(row => studentSessionSection(row, now) === "upcoming")
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  assert.equal(nearest?.id, 119);
  assert.equal(continuing.length, 130);
  assert.equal(continuing.filter(row => studentSessionSection(row, now) !== "history").length, 120);
  assert.equal(studentClassSection(continuing, now), "live", "One complete continuing class belongs in Live, not also Upcoming or History");
  assert.equal(studentClassSection(rows.filter(row => row.classGroup.batchId === 22), now), "history");
});

test("a second-page failure preserves the last complete result until a full retry succeeds", async () => {
  const previous: Row[] = [timetable[0]!];
  let displayed = previous;
  const requests: number[] = [];
  await assert.rejects(async () => {
    const complete = await readCompleteOwnedSessions<Row>(async (page, limit) => {
      requests.push(page);
      if (page === 2) throw new Error("synthetic network interruption");
      return pageOf(timetable, page, limit);
    });
    displayed = complete;
  }, /network interruption/);
  assert.deepEqual(requests, [1, 2]);
  assert.equal(displayed, previous, "Page one is never committed as if it were the whole class library");
  displayed = await readCompleteOwnedSessions(async (page, limit) => pageOf(timetable, page, limit));
  assert.equal(displayed.length, 230);
});

test("overlapping offset rows are deduplicated by ID without duplicating cards", async () => {
  const rows = await readCompleteOwnedSessions(async (page, limit) => ({
    sessions: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: "2" }, { id: 3 }],
    total: 3, page, limit,
  }), undefined, { pageSize: 2 });
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3]);
});

test("a stale read cannot finish or fetch another page after focus/account changes", async () => {
  let current = true;
  let resolvePage!: (page: OwnedSessionPage<Row>) => void;
  const requests: number[] = [];
  const pending = readCompleteOwnedSessions<Row>(async page => {
    requests.push(page);
    return new Promise(resolve => { resolvePage = resolve; });
  }, () => current);
  current = false;
  resolvePage(pageOf(timetable, 1, 100));
  await assert.rejects(pending, /no longer current/);
  assert.deepEqual(requests, [1]);
  await assert.rejects(readCompleteOwnedSessions(async () => {
    assert.fail("An already stale refresh must make no network requests");
  }, () => false), /no longer current/);
});

test("changed totals and missing unique lessons are rejected rather than silently truncating", async () => {
  await assert.rejects(readCompleteOwnedSessions(async (page, limit) => ({
    sessions: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }], total: page === 1 ? 3 : 4, page, limit,
  }), undefined, { pageSize: 2 }), /changed while loading/);
  await assert.rejects(readCompleteOwnedSessions(async (page, limit) => ({
    sessions: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }], total: 3, page, limit,
  }), undefined, { pageSize: 2 }), /complete class list could not/);
});

test("a page that repeats forever stops immediately instead of exhausting requests", async () => {
  let requests = 0;
  await assert.rejects(readCompleteOwnedSessions(async (page, limit) => {
    requests++;
    return { sessions: [{ id: 1 }, { id: 2 }], total: 5, page, limit };
  }, undefined, { pageSize: 2 }), /complete class list could not/);
  assert.equal(requests, 2);
});

test("page and time budgets bound reads without presenting capped data as complete", async () => {
  let requests = 0;
  await assert.rejects(readCompleteOwnedSessions(async (page, limit) => {
    requests++;
    return { sessions: [{ id: 1 }, { id: 2 }], total: 5, page, limit };
  }, undefined, { pageSize: 2, maxPages: 2 }), /safety limit/);
  assert.equal(requests, 1);
  let clock = 0;
  await assert.rejects(readCompleteOwnedSessions(async (page, limit) => {
    clock = 30_000;
    return pageOf(timetable, page, limit);
  }, undefined, { now: () => clock }), /too long/);
});

test("empty ownership is complete; malformed pagination metadata is not", async () => {
  assert.deepEqual(await readCompleteOwnedSessions(async (page, limit) => ({ sessions: [], total: 0, page, limit })), []);
  for (const response of [
    { sessions: [], total: -1, page: 1, limit: 100 },
    { sessions: [], total: 0, page: 2, limit: 100 },
    { sessions: [], total: 0, page: 1, limit: 20 },
    { sessions: [{ id: 0 }], total: 1, page: 1, limit: 100 },
  ]) await assert.rejects(readCompleteOwnedSessions(async () => response), /incomplete page|valid ID/);
});
