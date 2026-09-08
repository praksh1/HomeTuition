import assert from "node:assert/strict";
import { test } from "node:test";
import { cutoffAt, scheduledEndAt } from "../sessionStart.ts";
import {
  DISCUSSION_WINDOW_MINUTES,
  discussionOpensAt,
  discussionOpensIn,
  discussionWindow,
} from "./discussionWindow.ts";

/**
 * When the discussion may open.
 *
 * The point of every test here is that the answer comes from the **booked slot** and the
 * **server's** clock. A window derived from when the teacher actually started would reward
 * lateness; a window derived from the device would be openable by changing a phone's settings.
 */

const NOON = Date.UTC(2026, 8, 7, 12, 0, 0);
const MIN = 60_000;

/** A booked class. `startedAt` and `status` satisfy the type; the window never reads them. */
const session = (durationMinutes: number, startedAt: Date | null = null) => ({
  date: new Date(NOON),
  duration: durationMinutes,
  endedAt: null,
  startedAt,
  status: "upcoming",
});

test("the window is the last twenty minutes of the booked slot", () => {
  const s = session(90);
  const end = scheduledEndAt(s)!;
  assert.equal(discussionOpensAt(s), end - DISCUSSION_WINDOW_MINUTES * MIN);
  // 12:00 + 90 minutes = 13:30, so it opens at 13:10.
  assert.equal(discussionOpensAt(s), Date.UTC(2026, 8, 7, 13, 10, 0));
});

test("26: it cannot be opened before that moment", () => {
  const s = session(90);
  const opensAt = discussionOpensAt(s)!;

  const early = discussionWindow(s, opensAt - 1);
  assert.equal(early.open, false);
  assert.equal(early.open === false && early.code, "too-early");

  assert.equal(discussionWindow(s, opensAt).open, true, "exactly on time is in time");
});

test("27: a wrong device clock cannot open it early, because the caller passes the server's", () => {
  /*
    There is no hidden `Date.now()` in this module — `now` is a parameter, and every caller
    passes the server's time. A phone half an hour fast produces the same refusal as any other
    phone, because its clock never reaches this function.
  */
  const s = session(90);
  const opensAt = discussionOpensAt(s)!;
  const serverTime = opensAt - 30 * MIN;

  const phoneThinksItIsLater = discussionWindow(s, serverTime);
  assert.equal(phoneThinksItIsLater.open, false);
  assert.equal(phoneThinksItIsLater.open === false && phoneThinksItIsLater.code, "too-early");
});

test("28: a teacher who starts late gets a shorter discussion, not a later one", () => {
  const onTime = session(90);
  const twentyMinutesLate = session(90, new Date(NOON + 20 * MIN));
  /*
    The rule the whole class clock rests on, applied once more. A student who booked 12:00 to
    13:30 is free at 13:30 whatever time their teacher arrived.
  */
  assert.equal(discussionOpensAt(onTime), discussionOpensAt(twentyMinutesLate));
  assert.equal(cutoffAt(onTime), cutoffAt(twentyMinutesLate));
});

test("a new discussion cannot be started once the booked class has finished", () => {
  /*
    The correction, and the test that used to encode the bug.

    Its first version asserted the window was still open one millisecond before `cutoffAt` — the
    hard stop *ten minutes past* the booked finish. That passed, and it was wrong: it made the
    twenty-minute window thirty minutes long and let a teacher open a brand-new discussion after
    the slot the student paid for had ended. The owner's rule is the last twenty minutes **before
    the booked end**, so that is what is asserted now.
  */
  const s = session(90);
  const end = scheduledEndAt(s)!;
  assert.equal(discussionWindow(s, end - 1).open, true, "one millisecond before the finish is still inside");

  const atTheBell = discussionWindow(s, end);
  assert.equal(atTheBell.open, false);
  assert.equal(atTheBell.open === false && atTheBell.code, "finished");

  // And nothing about the overtime allowance reopens it.
  const inOvertime = discussionWindow(s, end + 5 * MIN);
  assert.equal(inOvertime.open, false);
  assert.equal(inOvertime.open === false && inOvertime.code, "finished");
  assert.ok(cutoffAt(s)! > end + 5 * MIN, "and that moment is genuinely inside the overtime grace");
});

test("the activation window is exactly twenty minutes long, never thirty", () => {
  const s = session(90);
  const opensAt = discussionOpensAt(s)!;
  const end = scheduledEndAt(s)!;
  assert.equal(end - opensAt, DISCUSSION_WINDOW_MINUTES * MIN);
  // The measurement that would have caught the original defect on its own.
  assert.ok(cutoffAt(s)! - opensAt > DISCUSSION_WINDOW_MINUTES * MIN,
    "the hard cutoff is deliberately later; it must not be what closes activation");
});

test("a short class still gets a window, bounded by its own length", () => {
  // A thirty-minute class: the window is its last twenty minutes, starting ten minutes in.
  const s = session(30);
  assert.equal(discussionOpensAt(s), NOON + 10 * MIN);
  assert.equal(discussionWindow(s, NOON + 9 * MIN).open, false);
  assert.equal(discussionWindow(s, NOON + 10 * MIN).open, true);
});

test("a class shorter than the window opens it immediately rather than never", () => {
  /*
    A fifteen-minute class would otherwise have its discussion open five minutes before it
    began. Arithmetic, not a special case: the window simply starts before the class does, and
    the door-open rules elsewhere are what stop anybody being in the room yet.
  */
  const s = session(15);
  assert.ok(discussionOpensAt(s)! < NOON);
  assert.equal(discussionWindow(s, NOON).open, true);
});

test("a session with no usable time has no window, rather than one at the epoch", () => {
  const broken = { date: new Date(Number.NaN), duration: 90, endedAt: null, startedAt: null, status: "upcoming" };
  assert.equal(discussionOpensAt(broken), null);
  const r = discussionWindow(broken, NOON);
  assert.equal(r.open, false);
  assert.equal(r.open === false && r.code, "no-schedule");
});

test("the countdown never goes negative once the window is open", () => {
  const s = session(90);
  const opensAt = discussionOpensAt(s)!;
  assert.equal(discussionOpensIn(s, opensAt - 5 * MIN), 5 * MIN);
  assert.equal(discussionOpensIn(s, opensAt + 5 * MIN), 0);
});
