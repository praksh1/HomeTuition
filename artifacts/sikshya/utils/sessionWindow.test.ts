import assert from "node:assert/strict";
import { test } from "node:test";
import { canOpenSession, finishedAt, startState } from "./sessionWindow.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-21T12:00:00Z");

const session = (over: Partial<Parameters<typeof canOpenSession>[0]> = {}) => ({
  date: new Date(NOW).toISOString(),
  duration: 60,
  status: "upcoming",
  startedAt: null,
  endedAt: null,
  ...over,
});

test("a class from three days ago does not open", () => {
  // The reported bug, exactly: a Completed class from Tuesday, tapped on Friday, opened the
  // classroom and set the phone asking for camera and microphone.
  const result = canOpenSession(session({ status: "completed", date: new Date(NOW - 72 * HOUR).toISOString() }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.title, "Session already expired");
    assert.match(result.message, /create a new one/i);
  }
});

test("a class that finished four hours ago does not open", () => {
  const result = canOpenSession(session({ status: "completed", endedAt: new Date(NOW - 4 * HOUR).toISOString() }), NOW);
  assert.equal(result.ok, false);
});

test("a class that has just ended still opens, so an accidental hang-up is recoverable", () => {
  assert.equal(canOpenSession(session({ status: "completed", endedAt: new Date(NOW - 5 * MIN).toISOString() }), NOW).ok, true);
});

test("a class running right now opens", () => {
  assert.equal(
    canOpenSession(session({ status: "live", startedAt: new Date(NOW - 20 * MIN).toISOString() }), NOW).ok,
    true,
  );
});

test("a long class started late is judged from when it began", () => {
  // Scheduled this morning, begun twenty minutes ago: still running, not stale.
  assert.equal(
    canOpenSession(
      session({ status: "live", date: new Date(NOW - 6 * HOUR).toISOString(), startedAt: new Date(NOW - 20 * MIN).toISOString() }),
      NOW,
    ).ok,
    true,
  );
});

test("a class scheduled for later opens", () => {
  assert.equal(canOpenSession(session({ date: new Date(NOW + 2 * HOUR).toISOString() }), NOW).ok, true);
});

test("a cancelled class does not open", () => {
  const result = canOpenSession(session({ status: "cancelled", date: new Date(NOW + HOUR).toISOString() }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.title, "Session cancelled");
});

test("the edge of the window is still open", () => {
  const justInside = new Date(NOW - (3 * HOUR - MIN)).toISOString();
  assert.equal(canOpenSession(session({ status: "completed", endedAt: justInside }), NOW).ok, true);
});

test("an unreadable date does not lock a teacher out", () => {
  assert.equal(canOpenSession(session({ date: "nonsense" }), NOW).ok, true);
  assert.equal(finishedAt(session({ date: "nonsense" })), null);
});

test("when it ended beats when it was scheduled to end", () => {
  const ended = NOW - 10 * MIN;
  assert.equal(
    finishedAt(session({ date: new Date(NOW - 5 * HOUR).toISOString(), endedAt: new Date(ended).toISOString() })),
    ended,
  );
});


const START = new Date("2026-08-21T10:00:00.000Z").getTime();

const upcoming = { date: new Date(START), duration: 60, status: "upcoming", startedAt: null, endedAt: null };

test("an upcoming class can be started", () => {
  const state = startState(upcoming, START - 5 * MIN);
  assert.equal(state.enabled, true);
  assert.equal(state.label, "Start class");
  assert.equal(state.reason, null);
});

test("a live class offers a way back in rather than a way to start it again", () => {
  const state = startState({ ...upcoming, status: "live", startedAt: new Date(START) }, START + 10 * MIN);
  assert.equal(state.enabled, true);
  assert.equal(state.label, "Rejoin class");
});

test("a class ended by accident can be reopened inside the window", () => {
  // The whole reason the three-hour window exists. Named a reopen, not a start.
  const ended = { ...upcoming, status: "completed", startedAt: new Date(START), endedAt: new Date(START + 20 * MIN) };
  const state = startState(ended, START + 40 * MIN);
  assert.equal(state.enabled, true);
  assert.equal(state.label, "Reopen class");
});

test("a class that finished more than three hours ago is greyed out, with the reason showing", () => {
  const ended = { ...upcoming, status: "completed", startedAt: new Date(START), endedAt: new Date(START + 60 * MIN) };
  const state = startState(ended, START + 5 * 60 * MIN);
  assert.equal(state.enabled, false);
  assert.equal(state.label, "Session expired");
  // The reason is carried, not left for a tap to reveal — the owner asked for grey, not for a
  // button that looks fine and then refuses.
  assert.match(state.reason ?? "", /more than 3 hours ago/);
});

test("a cancelled class is greyed out and says so", () => {
  const state = startState({ ...upcoming, status: "cancelled" }, START);
  assert.equal(state.enabled, false);
  assert.equal(state.label, "Cancelled");
  assert.match(state.reason ?? "", /cancelled/i);
});

test("an old class that somehow says it is live is still let back into", () => {
  // A class stuck at "live" is the force-closed-browser case. Locking the teacher out of it is
  // exactly the bug the restart window was added to fix, so live wins over the window.
  const stuck = { ...upcoming, status: "live", startedAt: new Date(START), endedAt: null };
  assert.equal(startState(stuck, START + 10 * 60 * MIN).enabled, true);
});
