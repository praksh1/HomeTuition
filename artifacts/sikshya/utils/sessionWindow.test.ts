import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOORS_OPEN_MINUTES,
  OVERTIME_CUTOFF_MINUTES,
  STUDENT_GRACE_MINUTES,
  callTimeState,
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
  // Not "Session expired". This assertion used to say exactly that, which pinned down the bug
  // rather than the behaviour: a class thirty minutes from opening has not expired, and the
  // owner reported being told it had. The label now names which refusal this is.
  assert.equal(state.label, "Not open yet");
  assert.match(state.reason ?? "", /opens 10 minutes before/);
});

test("a class still days away is never labelled expired, for either of them", () => {
  const days = START - 10 * 24 * 60 * MIN;
  assert.equal(startState(session(), days).label, "Not open yet");
  assert.equal(joinState(session(), days).label, "Not open yet");
});

test("a class held and ended before its slot says so, rather than `not open yet`", () => {
  const held = session({ status: "completed", startedAt: new Date(START - 9 * 24 * 60 * MIN) });
  assert.equal(startState(held, START - 8 * 24 * 60 * MIN).label, "Session held and ended");
});

test("expired means expired: only after the door has actually shut", () => {
  assert.equal(startState(session(), END + (OVERTIME_CUTOFF_MINUTES + 1) * MIN).label, "Session expired");
  assert.equal(joinState(session(), END + (STUDENT_GRACE_MINUTES + 1) * MIN).label, "Session expired");
});

test("the student's button reads Join the Class while the door is open", () => {
  const state = joinState(session(), START + 5 * MIN);
  assert.equal(state.enabled, true);
  assert.equal(state.label, "Join the Class");
});

test("and greys out to Session expired six minutes past the finish", () => {
  const state = joinState(session(), END + (STUDENT_GRACE_MINUTES + 1) * MIN);
  assert.equal(state.enabled, false);
  assert.equal(state.label, "Session expired");
  assert.match(state.reason ?? "", /report it from Support/);
});

test("a cancelled class is greyed out for both", () => {
  assert.equal(startState(session({ status: "cancelled" }), START).label, "Session cancelled");
  assert.equal(joinState(session({ status: "cancelled" }), START).label, "Session cancelled");
  assert.equal(startState(session({ status: "cancelled" }), START).enabled, false);
  assert.equal(joinState(session({ status: "cancelled" }), START).enabled, false);
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

test("a call in the middle of its hour is warned about nothing", () => {
  const state = callTimeState(session(), START + 20 * MIN);
  assert.equal(state.pastWarning, false);
  assert.equal(state.overtime, false);
  assert.equal(state.minutesLeft, 40);
});

test("the warning starts exactly five minutes before the booked finish", () => {
  assert.equal(callTimeState(session(), END - 6 * MIN).pastWarning, false);
  assert.equal(callTimeState(session(), END - 5 * MIN).pastWarning, true);
});

test("the warning says how many minutes are left, rounded up", () => {
  // Four minutes and thirty seconds is "5 minutes left" to a person, not "4".
  assert.equal(callTimeState(session(), END - 4.5 * MIN).minutesLeft, 5);
  assert.equal(callTimeState(session(), END - 60_000).minutesLeft, 1);
});

test("past the booked finish there are no minutes left, not negative ones", () => {
  assert.equal(callTimeState(session(), END + 3 * MIN).minutesLeft, 0);
});

test("the warning stays true through the overtime, and the stop is separate", () => {
  // They are two different facts. A call that has run over is also past its warning; the
  // screen decides which to show, and it must not have to infer one from the other.
  const overrun = callTimeState(session(), END + 3 * MIN);
  assert.equal(overrun.pastWarning, true);
  assert.equal(overrun.overtime, false);
});

test("the call is over one minute past the cutoff and not on it", () => {
  assert.equal(callTimeState(session(), END + OVERTIME_CUTOFF_MINUTES * MIN).overtime, false);
  assert.equal(callTimeState(session(), END + (OVERTIME_CUTOFF_MINUTES + 1) * MIN).overtime, true);
});

test("a late start does not buy more time on the call", () => {
  // Stated as a test because it is the consequence people will be surprised by: the clock is
  // the booked slot's, so a class begun twenty minutes late still stops when it was due to.
  const late = session({ startedAt: new Date(START + 20 * MIN), status: "live" });
  assert.equal(callTimeState(late, END + (OVERTIME_CUTOFF_MINUTES + 1) * MIN).overtime, true);
});

test("an unreadable date never cuts a call off", () => {
  const broken = session({ date: "nonsense" });
  const state = callTimeState(broken, END);
  assert.equal(state.overtime, false);
  assert.equal(state.pastWarning, false);
  assert.equal(state.minutesLeft, 0);
});

test("a class held and ended before its booked slot reads as over, not as not-yet-open", () => {
  // Reported: a teacher opened a class booked for next week, ended it, and tapping it said
  // "Not open yet" — technically true of its calendar entry and nonsense about a lesson they
  // had just taught.
  const future = new Date(START + 7 * 24 * 60 * MIN);
  const held = { date: future, duration: 60, status: "completed", startedAt: new Date(START), endedAt: new Date(START + 30 * MIN) };
  const check = canOpenSession(held, START + 60 * MIN);
  assert.equal(check.ok, false);
  assert.equal(check.ok === false ? check.title : "", "Session held and ended");
  assert.match(check.ok === false ? check.message : "", /opened and ended early/);
});

test("a class still upcoming is not treated as held just because it is in the future", () => {
  const future = new Date(START + 7 * 24 * 60 * MIN);
  const check = canOpenSession({ date: future, duration: 60, status: "upcoming", startedAt: null, endedAt: null }, START);
  assert.equal(check.ok, false);
  assert.equal(check.ok === false ? check.title : "", "Not open yet");
});

test("a completed class inside its reopen window can still be reopened", () => {
  // The recovery case must survive the new check: ended by accident, still within ten minutes.
  const ended = { date: new Date(START), duration: 60, status: "completed", startedAt: new Date(START), endedAt: new Date(START + 50 * MIN) };
  assert.equal(canOpenSession(ended, START + 65 * MIN).ok, true);
});
