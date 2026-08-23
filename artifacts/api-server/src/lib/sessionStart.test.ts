import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOORS_OPEN_MINUTES,
  OVERTIME_CUTOFF_MINUTES,
  STUDENT_GRACE_MINUTES,
  WRAP_UP_WARNING_MINUTES,
  canJoin,
  canStart,
  cutoffAt,
  doorsOpenAt,
  isPastCutoff,
  scheduledEndAt,
  studentDoorClosesAt,
  teacherHasGone,
  wrapUpWarningAt,
  type StartableSession,
} from "./sessionStart.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
/** A class booked 10:00–11:00. Every time below is relative to that. */
const START = new Date("2026-08-22T10:00:00.000Z").getTime();
const END = START + 60 * MIN;

function session(over: Partial<StartableSession> = {}): StartableSession {
  return {
    date: new Date(START),
    duration: 60,
    startedAt: null,
    endedAt: null,
    status: "upcoming",
    ...over,
  };
}

test("the timeline is anchored to the booked slot", () => {
  const s = session();
  assert.equal(doorsOpenAt(s), START - DOORS_OPEN_MINUTES * MIN);
  assert.equal(scheduledEndAt(s), END);
  assert.equal(studentDoorClosesAt(s), END + STUDENT_GRACE_MINUTES * MIN);
  assert.equal(cutoffAt(s), END + OVERTIME_CUTOFF_MINUTES * MIN);
  assert.equal(wrapUpWarningAt(s), END - WRAP_UP_WARNING_MINUTES * MIN);
});

test("a late start does not move the finish", () => {
  // The consequence of anchoring to the booked slot, stated as a test so nobody has to
  // rediscover it: a teacher who begins twenty minutes late does not get twenty extra minutes.
  const late = session({ startedAt: new Date(START + 20 * MIN), status: "live" });
  assert.equal(cutoffAt(late), END + OVERTIME_CUTOFF_MINUTES * MIN);
});

test("a teacher cannot open a class booked for next week", () => {
  // This was possible before, and it pulled anyone already looking at the class into a call.
  const result = canStart(session(), START - 8 * 24 * HOUR);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /opens 10 minutes before it starts/);
});

test("a teacher cannot open it one minute before the doors do", () => {
  assert.equal(canStart(session(), START - (DOORS_OPEN_MINUTES + 1) * MIN).ok, false);
});

test("a teacher can open it the moment the doors do", () => {
  assert.equal(canStart(session(), START - DOORS_OPEN_MINUTES * MIN).ok, true);
});

test("a teacher can still get back in nine minutes past the finish", () => {
  // The class ended by accident and they are walking straight back in.
  const ended = session({ status: "completed", endedAt: new Date(END - 10 * MIN) });
  assert.equal(canStart(ended, END + 9 * MIN).ok, true);
});

test("eleven minutes past the finish, that door is shut", () => {
  const ended = session({ status: "completed", endedAt: new Date(END - 10 * MIN) });
  const result = canStart(ended, END + 11 * MIN);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /can no longer be opened/);
});

test("the three-hour window is gone", () => {
  // It used to be possible to bring a class back to life long after everyone had left.
  const ended = session({ status: "completed", endedAt: new Date(END) });
  assert.equal(canStart(ended, END + 2 * HOUR).ok, false);
});

test("a cancelled class cannot be opened at any time", () => {
  assert.equal(canStart(session({ status: "cancelled" }), START).ok, false);
  assert.equal(canJoin(session({ status: "cancelled" }), START).ok, false);
});

test("a student can go in ten minutes early", () => {
  assert.equal(canJoin(session(), START - DOORS_OPEN_MINUTES * MIN).ok, true);
});

test("a student cannot go in eleven minutes early", () => {
  assert.equal(canJoin(session(), START - (DOORS_OPEN_MINUTES + 1) * MIN).ok, false);
});

test("a student can go in with no teacher there at all", () => {
  // The owner's rule, and the evidence a refund is argued from: a student who sat in an empty
  // room must be able to have sat in an empty room. Nothing here asks after the teacher.
  const nobodyCame = session({ startedAt: null, status: "upcoming" });
  assert.equal(canJoin(nobodyCame, START + 30 * MIN).ok, true);
});

test("a student can still join in the last minute of the booked hour", () => {
  assert.equal(canJoin(session(), END - MIN).ok, true);
});

test("five minutes past the finish the student door is still open", () => {
  assert.equal(canJoin(session(), END + STUDENT_GRACE_MINUTES * MIN).ok, true);
});

test("six minutes past the finish it says the session expired", () => {
  const result = canJoin(session(), END + (STUDENT_GRACE_MINUTES + 1) * MIN);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /Session expired/i);
});

test("the student's door shuts before the teacher's", () => {
  // Deliberate: nobody should still be arriving while the room is closed around them.
  const between = END + (STUDENT_GRACE_MINUTES + 2) * MIN;
  assert.equal(canJoin(session(), between).ok, false);
  assert.equal(canStart(session(), between).ok, true);
});

test("a call is not past the cutoff during the lesson", () => {
  assert.equal(isPastCutoff(session(), END - MIN), false);
});

test("a call is not past the cutoff on the ten-minute mark", () => {
  assert.equal(isPastCutoff(session(), END + OVERTIME_CUTOFF_MINUTES * MIN), false);
});

test("a call one minute past the cutoff is over", () => {
  assert.equal(isPastCutoff(session(), END + (OVERTIME_CUTOFF_MINUTES + 1) * MIN), true);
});

test("an unreadable date locks nobody out", () => {
  const broken = session({ date: "not a date" });
  assert.equal(canStart(broken, START).ok, true);
  assert.equal(canJoin(broken, START).ok, true);
  assert.equal(isPastCutoff(broken, START), false);
  assert.equal(doorsOpenAt(broken), null);
  assert.equal(cutoffAt(broken), null);
});

test("a class that has only just started has not lost its teacher", () => {
  assert.equal(teacherHasGone({ startedAt: new Date(START) }, null, START + 30_000), false);
});

test("a class with no teacher seen for three minutes has lost them", () => {
  assert.equal(
    teacherHasGone({ startedAt: new Date(START) }, new Date(START), START + 3 * MIN),
    true,
  );
});

test("a brief network drop does not end the class", () => {
  assert.equal(
    teacherHasGone({ startedAt: new Date(START) }, new Date(START + 4 * MIN), START + 5 * MIN),
    false,
  );
});

test("a class held and ended before its booked slot reads as over, not as not-yet-open", () => {
  const held = session({
    date: new Date(START + 7 * 24 * 60 * MIN),
    status: "completed",
    startedAt: new Date(START),
    endedAt: new Date(START + 30 * MIN),
  });
  const result = canStart(held, START + 60 * MIN);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /opened and ended early/);
});

test("a class still upcoming is not treated as held just because it is in the future", () => {
  const later = session({ date: new Date(START + 7 * 24 * 60 * MIN) });
  const result = canStart(later, START);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /opens 10 minutes before/);
});

test("a completed class inside its reopen window can still be reopened", () => {
  const ended = session({ status: "completed", startedAt: new Date(START), endedAt: new Date(END - 10 * MIN) });
  assert.equal(canStart(ended, END + 5 * MIN).ok, true);
});
