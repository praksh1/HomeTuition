import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DROP_DEADLINE_HOURS,
  RESCHEDULE_LOCK_HOURS,
  SCHEDULE_EDITS_PER_MONTH,
  canDrop,
  canReschedule,
  hasEditsLeft,
  inScheduleChangeWindow,
  isAcceptableNewDate,
  refundSplit,
  scheduleMoved,
} from "./sessionChanges.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A class booked for noon on the 22nd. */
const START = new Date("2026-08-22T12:00:00.000Z").getTime();
const upcoming = { date: new Date(START), status: "upcoming" };

test("a class three days out can be moved", () => {
  assert.equal(canReschedule(upcoming, START - 3 * DAY).ok, true);
});

test("a class inside two days cannot", () => {
  const result = canReschedule(upcoming, START - 47 * HOUR);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /more than 48 hours before/);
});

test("the lock is at exactly forty-eight hours, not a moment later", () => {
  assert.equal(canReschedule(upcoming, START - (RESCHEDULE_LOCK_HOURS * HOUR + 1)).ok, true);
  assert.equal(canReschedule(upcoming, START - RESCHEDULE_LOCK_HOURS * HOUR).ok, false);
});

test("a class that has been held cannot be moved", () => {
  // Moving a lesson that already happened is rewriting history, and the people who attended
  // would be told their class had moved.
  const held = { date: new Date(START), status: "completed" };
  assert.equal(canReschedule(held, START - 5 * DAY).ok, false);
  const live = { date: new Date(START), status: "live" };
  assert.equal(canReschedule(live, START - 5 * DAY).ok, false);
});

test("a class cannot be moved to the day after tomorrow minus an hour", () => {
  // The promise of 24 hours to decide is broken by moving a class *forward*, not only by
  // moving it late.
  const now = START - 5 * DAY;
  const result = isAcceptableNewDate(new Date(now + 47 * HOUR), now);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /at least 48 hours away/);
});

test("but it can be moved to two days out", () => {
  const now = START - 5 * DAY;
  assert.equal(isAcceptableNewDate(new Date(now + 49 * HOUR), now).ok, true);
});

test("a date nobody can read is refused rather than accepted", () => {
  assert.equal(isAcceptableNewDate("not a date", START).ok, false);
});

test("only a different time counts as moving the class", () => {
  assert.equal(scheduleMoved(new Date(START), new Date(START)), false);
  assert.equal(scheduleMoved(new Date(START), new Date(START + HOUR)), true);
  // A different day at the same hour is still a move.
  assert.equal(scheduleMoved(new Date(START), new Date(START + DAY)), true);
});

test("five changes a month, counted per change and not per class", () => {
  assert.equal(hasEditsLeft(0).ok, true);
  assert.equal(hasEditsLeft(SCHEDULE_EDITS_PER_MONTH - 1).ok, true);
  const spent = hasEditsLeft(SCHEDULE_EDITS_PER_MONTH);
  assert.equal(spent.ok, false);
  assert.match(spent.ok === false ? spent.reason : "", /already moved 5 classes this month/);
  assert.match(spent.ok === false ? spent.reason : "", /just not its time/);
});

test("a student can drop two days out", () => {
  assert.equal(canDrop(upcoming, START - 2 * DAY).ok, true);
});

test("and cannot inside a day", () => {
  const result = canDrop(upcoming, START - 23 * HOUR);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /more than 24 hours before/);
  // Still pointed somewhere useful rather than left at a dead end.
  assert.match(result.ok === false ? result.reason : "", /Support/);
});

test("the drop deadline is exactly twenty-four hours", () => {
  assert.equal(canDrop(upcoming, START - (DROP_DEADLINE_HOURS * HOUR + 1)).ok, true);
  assert.equal(canDrop(upcoming, START - DROP_DEADLINE_HOURS * HOUR).ok, false);
});

test("a class that was never moved opens no refund window", () => {
  assert.equal(inScheduleChangeWindow(null, START), false);
});

test("a class moved an hour ago is inside its window", () => {
  assert.equal(inScheduleChangeWindow(new Date(START - HOUR), START), true);
});

test("and a class moved yesterday is not", () => {
  assert.equal(inScheduleChangeWindow(new Date(START - 25 * HOUR), START), false);
});

test("a teacher moving the class means the whole price back", () => {
  const split = refundSplit(1000, "schedule_change");
  assert.equal(split.studentRefund, 1000);
  assert.equal(split.teacherShare, 0);
  assert.equal(split.platformShare, 0);
});

test("an agent's discretion is also the whole price", () => {
  assert.equal(refundSplit(1000, "agent_discretion").studentRefund, 1000);
});

test("a student changing their mind gets half, and the rest splits evenly", () => {
  const split = refundSplit(1000, "student_drop");
  assert.equal(split.studentRefund, 500);
  assert.equal(split.teacherShare, 250);
  assert.equal(split.platformShare, 250);
});

test("the three parts always add back to the price", () => {
  // No arithmetic here may invent or lose a rupee, at any price.
  for (const price of [1, 3, 7, 99, 333, 500, 501, 1000, 1234, 9999]) {
    for (const reason of ["schedule_change", "student_drop", "agent_discretion"] as const) {
      const split = refundSplit(price, reason);
      assert.equal(
        split.studentRefund + split.teacherShare + split.platformShare,
        price,
        `${reason} at ${price} did not add up`,
      );
    }
  }
});

test("an odd price rounds in the student's favour", () => {
  // Somebody has to get the stray rupee, and it should not be taken from the person being
  // refunded.
  const split = refundSplit(501, "student_drop");
  assert.equal(split.studentRefund, 251);
  assert.equal(split.teacherShare + split.platformShare, 250);
});

test("a free class refunds nothing and owes nobody anything", () => {
  const split = refundSplit(0, "student_drop");
  assert.deepEqual(
    [split.studentRefund, split.teacherShare, split.platformShare],
    [0, 0, 0],
  );
});

test("a negative price cannot become money owed to anybody", () => {
  const split = refundSplit(-500, "student_drop");
  assert.deepEqual(
    [split.studentRefund, split.teacherShare, split.platformShare],
    [0, 0, 0],
  );
});
