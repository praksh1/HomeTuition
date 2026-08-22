import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEACHER_LATE_MINUTES,
  absentMs,
  findingsFor,
  teacherIsLate,
  teacherMinutesLate,
  type PresenceRecord,
  type ScheduledSession,
} from "./sessionEvidence.ts";

const MIN = 60_000;
const START = new Date("2026-08-21T10:00:00.000Z").getTime();

function session(over: Partial<ScheduledSession> = {}): ScheduledSession {
  return { date: new Date(START), duration: 60, startedAt: new Date(START), endedAt: null, ...over };
}

function present(over: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    userId: 1,
    name: "Ram Prasad",
    role: "teacher",
    firstJoinedAt: new Date(START),
    lastSeenAt: new Date(START + 60 * MIN),
    presentMs: 60 * MIN,
    joinCount: 1,
    drawCount: 30,
    messageCount: 2,
    ...over,
  };
}

function codes(list: { code: string }[]): string[] {
  return list.map((f) => f.code);
}

test("a person who stayed connected the whole time was never away", () => {
  assert.equal(absentMs(present()), 0);
});

test("time missing is the gap between the span and the time actually connected", () => {
  assert.equal(absentMs(present({ presentMs: 40 * MIN })), 20 * MIN);
});

test("a clock that runs backwards does not produce negative absence", () => {
  assert.equal(absentMs(present({ presentMs: 90 * MIN })), 0);
});

test("a teacher who arrived on the hour is not late", () => {
  assert.equal(teacherMinutesLate(session(), present()), 0);
});

test("lateness is measured from the booked time, not from when the class went live", () => {
  // The class was booked for 10:00 and the teacher took it live at 10:20. Measuring against
  // startedAt would make every teacher punctual by definition.
  const late = present({ firstJoinedAt: new Date(START + 20 * MIN) });
  assert.equal(teacherMinutesLate(session({ startedAt: new Date(START + 20 * MIN) }), late), 20);
});

test("a teacher who arrived early reads as zero, not as a negative number", () => {
  assert.equal(teacherMinutesLate(session(), present({ firstJoinedAt: new Date(START - 5 * MIN) })), 0);
});

test("no teacher record means we cannot say how late they were", () => {
  assert.equal(teacherMinutesLate(session(), null), null);
});

test("a student waiting past the threshold with nobody there is owed help", () => {
  assert.equal(teacherIsLate(session(), null, START + (TEACHER_LATE_MINUTES + 1) * MIN), true);
});

test("a student waiting inside the threshold is not offered help yet", () => {
  assert.equal(teacherIsLate(session(), null, START + (TEACHER_LATE_MINUTES - 1) * MIN), false);
});

test("a teacher who has since arrived stops the class counting as late", () => {
  const teacher = present({ firstJoinedAt: new Date(START + 2 * MIN) });
  assert.equal(teacherIsLate(session(), teacher, START + 40 * MIN), false);
});

test("a teacher who arrived very late stays late, however long ago it was", () => {
  const teacher = present({ firstJoinedAt: new Date(START + 25 * MIN) });
  assert.equal(teacherIsLate(session(), teacher, START + 90 * MIN), true);
});

test("a class nobody taught says so", () => {
  const found = findingsFor(session({ startedAt: null }), [], [], START + 90 * MIN);
  assert.ok(codes(found).includes("teacher_never_joined"));
  assert.ok(codes(found).includes("class_never_started"));
});

test("a class taught end to end raises nothing", () => {
  assert.deepEqual(findingsFor(session(), [present()], [], START + 90 * MIN), []);
});

test("arriving twenty minutes late is reported with the number", () => {
  const teacher = present({ firstJoinedAt: new Date(START + 20 * MIN) });
  const late = findingsFor(session(), [teacher], [], START + 90 * MIN).find((f) => f.code === "teacher_late");
  assert.ok(late, "expected a lateness finding");
  assert.match(late.detail, /20 minutes/);
});

test("a connection that dropped repeatedly is reported, with how long they were gone", () => {
  const teacher = present({ joinCount: 9, presentMs: 40 * MIN });
  const unstable = findingsFor(session(), [teacher], [], START + 90 * MIN)
    .find((f) => f.code === "teacher_connection_unstable");
  assert.ok(unstable, "expected an unstable-connection finding");
  assert.match(unstable.detail, /9 times/);
  assert.match(unstable.detail, /20 of the 60/);
});

test("one reconnection is ordinary and is not reported as a bad line", () => {
  // A phone changing cell, or a tab reloaded. The gap is large; the count is not.
  const teacher = present({ joinCount: 2, presentMs: 40 * MIN });
  assert.ok(!codes(findingsFor(session(), [teacher], [], START + 90 * MIN)).includes("teacher_connection_unstable"));
});

test("many reconnections that lost no time are not reported either", () => {
  const teacher = present({ joinCount: 9, presentMs: 60 * MIN });
  assert.ok(!codes(findingsFor(session(), [teacher], [], START + 90 * MIN)).includes("teacher_connection_unstable"));
});

test("a lesson cut in half is reported against what was booked", () => {
  const short = session({ endedAt: new Date(START + 20 * MIN) });
  const teacher = present({ lastSeenAt: new Date(START + 20 * MIN), presentMs: 20 * MIN });
  const early = findingsFor(short, [teacher], [], START + 90 * MIN).find((f) => f.code === "teacher_left_early");
  assert.ok(early, "expected an early-finish finding");
  assert.match(early.detail, /20 minutes of a booked 60/);
});

test("a class that ran a few minutes short is normal teaching, not a finding", () => {
  const short = session({ endedAt: new Date(START + 55 * MIN) });
  const teacher = present({ lastSeenAt: new Date(START + 55 * MIN), presentMs: 55 * MIN });
  assert.ok(!codes(findingsFor(short, [teacher], [], START + 90 * MIN)).includes("teacher_left_early"));
});

test("a class still running has not ended early", () => {
  const teacher = present({ presentMs: 10 * MIN, lastSeenAt: new Date(START + 10 * MIN) });
  assert.ok(!codes(findingsFor(session(), [teacher], [], START + 10 * MIN)).includes("teacher_left_early"));
});

test("a whiteboard nobody drew on is worth saying out loud", () => {
  assert.ok(codes(findingsFor(session(), [present({ drawCount: 0 })], [], START + 90 * MIN)).includes("board_never_used"));
});

test("a student who paid and never opened the class is visible only against the paid list", () => {
  // No ledger row exists for them at all, which is exactly why the paid list has to be passed
  // in — this is the teacher's side of most refund arguments.
  const missing = findingsFor(session(), [present()], [{ userId: 7, name: "Sita" }], START + 90 * MIN)
    .find((f) => f.code === "student_never_joined");
  assert.ok(missing, "expected a never-joined finding");
  assert.equal(missing.userId, 7);
});

test("a student who did attend raises nothing about them", () => {
  const student = present({ userId: 7, name: "Sita", role: "student", drawCount: 0 });
  const found = findingsFor(session(), [present(), student], [{ userId: 7, name: "Sita" }], START + 90 * MIN);
  assert.ok(!codes(found).includes("student_never_joined"));
  assert.ok(!codes(found).includes("student_barely_attended"));
});

test("a student who looked in for thirty seconds is not counted as having attended a lesson", () => {
  const student = present({ userId: 7, name: "Sita", role: "student", presentMs: 30_000, drawCount: 0 });
  const found = findingsFor(session(), [present(), student], [{ userId: 7, name: "Sita" }], START + 90 * MIN);
  assert.ok(codes(found).includes("student_barely_attended"));
  assert.ok(!codes(found).includes("student_never_joined"));
});

test("a teacher account enrolled in someone else's class is judged as a student there", () => {
  // The role recorded is the part played in this class, not the account type. A teacher who
  // booked a colleague's lesson must not read as the person who should have turned up to teach.
  const guest = present({ userId: 9, name: "Another Teacher", role: "student", presentMs: 60 * MIN, drawCount: 0 });
  assert.ok(codes(findingsFor(session({ startedAt: null }), [guest], [], START + 90 * MIN)).includes("teacher_never_joined"));
});

test("an unreadable date decides nothing", () => {
  const broken = session({ date: "not a date" });
  assert.equal(teacherMinutesLate(broken, present()), null);
  assert.equal(teacherIsLate(broken, null, START + 90 * MIN), false);
});
