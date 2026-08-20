import assert from "node:assert/strict";
import { test } from "node:test";
import { GRACE_MINUTES, isLeftOver } from "./sessionStaleness.ts";

const NOW = new Date("2026-08-20T10:00:00Z").getTime();
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

test("a class that has just started is running, not left over", () => {
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(2), startedAt: minutesAgo(2), duration: 60 }, NOW),
    false,
  );
});

test("a class part-way through its hour is running", () => {
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(45), startedAt: minutesAgo(45), duration: 60 }, NOW),
    false,
  );
});

test("a lesson running over is given grace, not ended under the teacher", () => {
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(70), startedAt: minutesAgo(70), duration: 60 }, NOW),
    false,
    `a 60 minute class ${GRACE_MINUTES > 10 ? "10" : "1"} minutes over should still be live`,
  );
});

test("a class long past its end is left over", () => {
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(200), startedAt: minutesAgo(200), duration: 60 }, NOW),
    true,
  );
});

/**
 * The regression that made this rule worth isolating.
 *
 * A class scheduled for the morning and actually started now is *running*. Judging it by the
 * scheduled slot marked it expired immediately, so the next client to load the live list ended
 * it and told the room to leave — a student opening their own Sessions tab was enough to kill
 * their teacher's lesson.
 */
test("a class scheduled hours ago but started just now is running", () => {
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(300), startedAt: minutesAgo(1), duration: 60 }, NOW),
    false,
  );
});

test("without startedAt it falls back to the scheduled time", () => {
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(300), startedAt: null, duration: 60 }, NOW),
    true,
  );
  assert.equal(
    isLeftOver({ id: 1, date: minutesAgo(5), startedAt: null, duration: 60 }, NOW),
    false,
  );
});

test("an unparseable date is never treated as expired", () => {
  // Ending a real class because a timestamp was malformed is the worse of the two failures.
  assert.equal(isLeftOver({ id: 1, date: "not-a-date", startedAt: null, duration: 60 }, NOW), false);
});

test("the boundary is inclusive of the grace period", () => {
  const exactly = { id: 1, date: minutesAgo(75), startedAt: minutesAgo(75), duration: 60 };
  assert.equal(isLeftOver(exactly, NOW), false, "at exactly duration + grace, still live");
  assert.equal(isLeftOver(exactly, NOW + 1000), true, "a second later, left over");
});
