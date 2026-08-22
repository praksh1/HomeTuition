import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOORS_OPEN_MINUTES,
  OVERTIME_CUTOFF_MINUTES,
  STUDENT_GRACE_MINUTES,
  canJoinSession,
  canOpenSession,
  cutoffAt,
  doorsOpenAt,
  isPastCutoff,
  joinState,
  scheduledEndAt,
  startState,
  studentDoorClosesAt,
  type SessionWindowInput,
} from "./sessionWindow.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
/** A class booked 10:00–11:00. Every time below is relative to that. */
const START = new Date("2026-08-22T10:00:00.000Z").getTime();
const END = START + 60 * MIN;

function session(over: Partial<SessionWindowInput> = {}): SessionWindowInput {
  return { date: new Date(START), duration: 60, status: "upcoming", startedAt: null, endedAt: null, ...over };
}

test("the app measures the same timeline the server does", () => {
  const s = session();
  assert.equal(doorsOpenAt(s), START - DOORS_OPEN_MINUTES * MIN);
  assert.equal(scheduledEndAt(s), END);
  assert.equal(studentDoorClosesAt(s), END + STUDENT_GRACE_MINUTES * MIN);
  assert.equal(cutoffAt(s), END + OVERTIME_CUTOFF_MINUTES * MIN);
});

test("a late start does not move the finish", () => {
  const late = session({ startedAt: new Date(START + 20 * MIN), status: "live" });
  assert.equal(cutoffAt(late), END + OVERTIME_CUTOFF_MINUTES * MIN);
});

test("a teacher cannot open a class booked for next week", () => {
  const result = canOpenSession(session(), START - 7 * 24 * HOUR);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.message : "", /opens 10 minutes before it starts/);
});

test("a teacher can open it the moment the doors do, and not a minute earlier", () => {
  assert.equal(canOpenSession(session(), START - DOORS_OPEN_MINUTES * MIN).ok, true);
  assert.equal(canOpenSession(session(), START - (DOORS_OPEN_MINUTES + 1) * MIN).ok, false);
});

test("a teacher who ended by accident gets back in inside ten minutes", () => {
  const ended = session({ status: "completed", endedAt: new Date(END - 5 * MIN) });
  assert.equal(canOpenSession(ended, END + 9 * MIN).ok, true);
  assert.equal(canOpenSession(ended, END + 11 * MIN).ok, false);
});

test("the three-hour window is gone", () => {
  const ended = session({ status: "completed", endedAt: new Date(END) });
  assert.equal(canOpenSession(ended, END + 2 * HOUR).ok, false);
});

test("a student can join with no teacher there at all", () => {
  // Nothing in this check asks after the teacher. That is the point of it.
  assert.equal(canJoinSession(session({ startedAt: null }), START + 30 * MIN).ok, true);
});

test("a student can still join five minutes past the finish, and not six", () => {
  assert.equal(canJoinSession(session(), END + STUDENT_GRACE_MINUTES * MIN).ok, true);
  assert.equal(canJoinSession(session(), END + (STUDENT_GRACE_MINUTES + 1) * MIN).ok, false);
});

test("the student's door shuts before the teacher's", () => {
  const between = END + (STUDENT_GRACE_MINUTES + 2) * MIN;
  assert.equal(canJoinSession(session(), between).ok, false);
  assert.equal(canOpenSession(session(), between).ok, true);
});

test("a class marked completed does not stop a student joining inside the window", () => {
  // The teacher ended early. The student is still entitled to be in that room, and to be
  // recorded as having been there — that record is what a refund is argued from.
  const endedEarly = session({ status: "completed", endedAt: new Date(START + 10 * MIN) });
  assert.equal(canJoinSession(endedEarly, START + 30 * MIN).ok, true);
});

test("the teacher's button says what it will do", () => {
  assert.equal(startState(session(), START - 5 * MIN).label, "Open the Session");
  assert.equal(startState(session({ status: "live" }), START + 5 * MIN).label, "Rejoin the session");
  assert.equal(
    startState(session({ status: "completed", endedAt: new Date(END - MIN) }), END + 2 * MIN).label,
    "Reopen the session",
  );
});

test("the teacher's button is greyed out before the doors open, with the reason showing", () => {
  const state = startState(session(), START - 30 * MIN);
  assert.equal(state.enabled, false);
  assert.equal(state.label, "Session expired");
  assert.match(state.reason ?? "", /opens 10 minutes before/);
});

test("the student's button reads Join the Class while the door is open", () => {
  const state = joinState(session(), START + 5 * MIN);
  assert.equal(state.enabled, true);
  assert.equal(state.label, "Join the Class");
});

test("and greys out to Session Expired six minutes past the finish", () => {
  const state = joinState(session(), END + (STUDENT_GRACE_MINUTES + 1) * MIN);
  assert.equal(state.enabled, false);
  assert.equal(state.label, "Session Expired");
  assert.match(state.reason ?? "", /report it from Support/);
});

test("a cancelled class is greyed out for both", () => {
  assert.equal(startState(session({ status: "cancelled" }), START).label, "Cancelled");
  assert.equal(joinState(session({ status: "cancelled" }), START).label, "Cancelled");
});

test("a call is over one minute past the cutoff and not before", () => {
  assert.equal(isPastCutoff(session(), END + OVERTIME_CUTOFF_MINUTES * MIN), false);
  assert.equal(isPastCutoff(session(), END + (OVERTIME_CUTOFF_MINUTES + 1) * MIN), true);
});

test("an unreadable date locks nobody out", () => {
  const broken = session({ date: "nonsense" });
  assert.equal(canOpenSession(broken, START).ok, true);
  assert.equal(canJoinSession(broken, START).ok, true);
  assert.equal(isPastCutoff(broken, START), false);
});
