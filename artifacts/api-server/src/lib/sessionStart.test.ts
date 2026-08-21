import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESTART_WINDOW_HOURS,
  TEACHER_ABSENCE_MINUTES,
  canStart,
  finishedAt,
  teacherHasGone,
} from "./sessionStart.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-21T12:00:00Z");

const session = (over: Partial<Parameters<typeof canStart>[0]> = {}) => ({
  date: new Date(NOW),
  duration: 60,
  startedAt: null,
  endedAt: null,
  status: "upcoming",
  ...over,
});

test("a class scheduled for later can be started", () => {
  assert.equal(canStart(session({ date: new Date(NOW + 2 * HOUR) }), NOW).ok, true);
});

test("a class running right now can be started", () => {
  assert.equal(canStart(session({ startedAt: new Date(NOW - 10 * MIN), status: "live" }), NOW).ok, true);
});

test("a class that has just finished can be started again", () => {
  // The whole reason the window exists: the teacher hung up by accident.
  const result = canStart(session({ endedAt: new Date(NOW - 5 * MIN), status: "completed" }), NOW);
  assert.equal(result.ok, true);
});

test("a class can still be restarted at the edge of the window", () => {
  const justInside = new Date(NOW - (RESTART_WINDOW_HOURS * HOUR - MIN));
  assert.equal(canStart(session({ endedAt: justInside, status: "completed" }), NOW).ok, true);
});

test("a class finished longer ago than the window cannot be started", () => {
  const result = canStart(session({ endedAt: new Date(NOW - 4 * HOUR), status: "completed" }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /can no longer be started/);
});

test("yesterday's class cannot be started, even if it never ran", () => {
  // The reported bug: scrolling back through past classes and simply starting one.
  const result = canStart(session({ date: new Date(NOW - 30 * HOUR) }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /days ago|hours ago/);
});

test("a cancelled class cannot be started", () => {
  const result = canStart(session({ status: "cancelled", date: new Date(NOW + HOUR) }), NOW);
  assert.equal(result.ok, false);
});

test("a long class started late is still startable, measured from when it began", () => {
  // A 12:30 class begun at 15:00 is not three hours stale — it has not finished at all.
  const result = canStart(
    session({ date: new Date(NOW - 6 * HOUR), startedAt: new Date(NOW - 20 * MIN), status: "live" }),
    NOW,
  );
  assert.equal(result.ok, true);
});

test("an unreadable date never blocks a teacher", () => {
  assert.equal(canStart(session({ date: "not a date" }), NOW).ok, true);
  assert.equal(finishedAt(session({ date: "not a date" })), null);
});

test("when it ended beats when it was scheduled to end", () => {
  const ended = NOW - 10 * MIN;
  assert.equal(finishedAt(session({ date: new Date(NOW - 5 * HOUR), endedAt: new Date(ended) })), ended);
});

test("a class that has only just started has not lost its teacher", () => {
  // Their socket takes a moment; treating that as absence would end every class as it began.
  assert.equal(teacherHasGone({ startedAt: new Date(NOW - 5_000) }, null, NOW), false);
});

test("a teacher seen a moment ago is still there", () => {
  assert.equal(
    teacherHasGone({ startedAt: new Date(NOW - HOUR) }, new Date(NOW - 20_000), NOW),
    false,
  );
});

test("a teacher who force-quit is gone once the window passes", () => {
  // The reported bug: the class stayed live with nobody in it, blocking the next one.
  const lastSeen = new Date(NOW - (TEACHER_ABSENCE_MINUTES * MIN + 30_000));
  assert.equal(teacherHasGone({ startedAt: new Date(NOW - HOUR) }, lastSeen, NOW), true);
});

test("a live class nobody ever joined counts as abandoned", () => {
  assert.equal(teacherHasGone({ startedAt: new Date(NOW - HOUR) }, null, NOW), true);
});

test("a brief network drop does not end the class", () => {
  const lastSeen = new Date(NOW - 45_000);
  assert.equal(teacherHasGone({ startedAt: new Date(NOW - HOUR) }, lastSeen, NOW), false);
});
