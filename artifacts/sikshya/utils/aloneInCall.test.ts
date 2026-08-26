import assert from "node:assert/strict";
import { test } from "node:test";
import { aloneMessage, aloneState, NOTICE_MS, QUIET_MS, TOTAL_MS } from "./aloneInCall.ts";

const NOW = new Date("2026-08-26T10:00:00Z").getTime();
const agoMs = (ms: number) => NOW - ms;

test("nobody has left, so there is nothing to say", () => {
  assert.deepEqual(aloneState(null, NOW), { phase: "together" });
});

test("the first five minutes pass without a word", () => {
  // A dropped connection usually comes back. Saying so immediately is what made the app shout
  // "teacher disconnected" the instant a lesson ended normally.
  assert.deepEqual(aloneState(agoMs(1), NOW), { phase: "quiet" });
  assert.deepEqual(aloneState(agoMs(QUIET_MS - 1000), NOW), { phase: "quiet" });
});

test("at five minutes they are told, with ten left", () => {
  const state = aloneState(agoMs(QUIET_MS), NOW);
  assert.equal(state.phase, "warned");
  assert.equal(state.phase === "warned" && state.minutesLeft, NOTICE_MS / 60_000);
});

test("the countdown runs down rather than sitting still", () => {
  const early = aloneState(agoMs(QUIET_MS + 60_000), NOW);
  const late = aloneState(agoMs(QUIET_MS + 8 * 60_000), NOW);
  assert.equal(early.phase === "warned" && early.minutesLeft, 9);
  assert.equal(late.phase === "warned" && late.minutesLeft, 2);
});

test("it never reads zero minutes while the call is still running", () => {
  // The last stretch before the cutoff. A countdown that hits zero and keeps going makes
  // people distrust everything else on the screen.
  for (const ms of [TOTAL_MS - 1000, TOTAL_MS - 30_000, TOTAL_MS - 59_000]) {
    const state = aloneState(agoMs(ms), NOW);
    assert.equal(state.phase, "warned");
    assert.ok(state.phase === "warned" && state.minutesLeft >= 1, `${ms}ms left read 0 minutes`);
  }
});

test("at fifteen minutes the call is over", () => {
  assert.deepEqual(aloneState(agoMs(TOTAL_MS), NOW), { phase: "over" });
  assert.deepEqual(aloneState(agoMs(TOTAL_MS + 60_000), NOW), { phase: "over" });
});

test("the other side coming back cancels a warning already on screen", () => {
  // The screens pass null the moment somebody rejoins, and that has to undo the warning
  // silently — not leave a countdown running under a teacher who is back and teaching.
  const warned = aloneState(agoMs(QUIET_MS + 60_000), NOW);
  assert.equal(warned.phase, "warned");
  assert.deepEqual(aloneState(null, NOW), { phase: "together" });
});

test("the allowance is the fifteen minutes the owner asked for", () => {
  assert.equal(QUIET_MS / 60_000, 5);
  assert.equal(NOTICE_MS / 60_000, 10);
  assert.equal(TOTAL_MS / 60_000, 15);
});

test("each side is told about the side that is missing", () => {
  assert.match(aloneMessage("teacher", 10), /teacher has not come back/i);
  assert.match(aloneMessage("students", 10), /nobody has joined/i);
});

test("the way back in is part of the message", () => {
  // Being told the class is ending without being told how to resume it is half an answer.
  assert.match(aloneMessage("teacher", 10), /Sessions/);
  assert.match(aloneMessage("students", 10), /Sessions/);
});

test("one minute is not one minutes", () => {
  assert.match(aloneMessage("teacher", 1), /in 1 minute\./);
  assert.match(aloneMessage("teacher", 2), /in 2 minutes\./);
});
