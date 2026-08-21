import assert from "node:assert/strict";
import { test } from "node:test";
import { canOpenSession, finishedAt } from "./sessionWindow.ts";

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
