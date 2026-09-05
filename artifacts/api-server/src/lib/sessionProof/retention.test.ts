import assert from "node:assert/strict";
import test from "node:test";
import { FINE_GRAINED_RETENTION_DAYS, RETENTION_WINDOW_MS, planRetention } from "./retention.ts";

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

test("the window is thirty fixed days, not a calendar month", () => {
  // Bikram Sambat months run 29-32 days and Gregorian 28-31, so calendar arithmetic gives two
  // different answers to one policy. Same reasoning as the tier window.
  assert.equal(FINE_GRAINED_RETENTION_DAYS, 30);
  assert.equal(RETENTION_WINDOW_MS, 30 * DAY);
});

test("rows older than the window are planned for removal and newer ones are kept", () => {
  const plan = planRetention([
    { id: 1, sessionId: 10, atMs: NOW - 31 * DAY },
    { id: 2, sessionId: 10, atMs: NOW - 29 * DAY },
    { id: 3, sessionId: 11, atMs: NOW - 40 * DAY },
    { id: 4, sessionId: 11, atMs: NOW },
  ], NOW);

  assert.deepEqual(plan.expiredIds, [1, 3]);
  assert.deepEqual(plan.keptIds, [2, 4]);
  assert.equal(plan.cutoffMs, NOW - RETENTION_WINDOW_MS);
});

test("a row exactly on the boundary is kept", () => {
  // Deleting evidence one millisecond early is the error worth avoiding.
  const plan = planRetention([{ id: 1, sessionId: 1, atMs: NOW - RETENTION_WINDOW_MS }], NOW);
  assert.deepEqual(plan.expiredIds, []);
  assert.deepEqual(plan.keptIds, [1]);
});

test("every session losing rows is named, so an aggregate can be written first", () => {
  const plan = planRetention([
    { id: 1, sessionId: 10, atMs: NOW - 40 * DAY },
    { id: 2, sessionId: 10, atMs: NOW - 41 * DAY },
    { id: 3, sessionId: 12, atMs: NOW - 40 * DAY },
    { id: 4, sessionId: 13, atMs: NOW },
    { id: 5, sessionId: null, atMs: NOW - 40 * DAY },
  ], NOW);

  assert.deepEqual(plan.sessionsNeedingAggregate, [10, 12], "deduplicated, sorted, and unmapped rows excluded");
});

test("planning removes nothing by itself", () => {
  // The plan is data. There is no delete in this module, and nothing here can run on a schedule.
  const rows = [{ id: 1, sessionId: 1, atMs: NOW - 90 * DAY }];
  const before = JSON.stringify(rows);
  planRetention(rows, NOW);
  assert.equal(JSON.stringify(rows), before, "planRetention must not mutate its input");
});

test("an empty table plans nothing rather than failing", () => {
  const plan = planRetention([], NOW);
  assert.deepEqual(plan.expiredIds, []);
  assert.deepEqual(plan.sessionsNeedingAggregate, []);
});

test("the plan is deterministic and sorted, so a dry run is diffable", () => {
  const rows = [
    { id: 9, sessionId: 2, atMs: NOW - 60 * DAY },
    { id: 3, sessionId: 1, atMs: NOW - 60 * DAY },
    { id: 7, sessionId: 2, atMs: NOW - 60 * DAY },
  ];
  const a = planRetention(rows, NOW);
  const b = planRetention([...rows].reverse(), NOW);
  assert.deepEqual(a.expiredIds, [3, 7, 9]);
  assert.deepEqual(a, b, "row order must not change the plan");
});
