import { test } from "node:test";
import assert from "node:assert/strict";
import { countdown, humanDuration, serverNow, waitingState } from "./sessionClock.ts";

const MIN = 60_000;
const START = new Date("2026-08-21T10:00:00.000Z").getTime();

test("a handset with a correct clock is left alone", () => {
  assert.equal(serverNow("2026-08-21T10:00:00.000Z", 1000, 1000), START);
});

test("only the offset comes from the server, so elapsed time still counts", () => {
  // Heard the server's time 5 seconds ago; five seconds have passed here too.
  assert.equal(serverNow("2026-08-21T10:00:00.000Z", 1000, 6000), START + 5000);
});

test("a handset half an hour fast is corrected, not trusted", () => {
  // This is the case that matters: the phone believes it is 10:30 and the server says 10:00.
  // Everything on the page has to be measured from 10:00 or the student is shown a teacher
  // who is thirty minutes late for a class that has not started.
  const phoneNow = START + 30 * MIN;
  assert.equal(serverNow("2026-08-21T10:00:00.000Z", phoneNow, phoneNow), START);
});

test("no server time means fall back to the handset rather than showing nothing", () => {
  assert.equal(serverNow(null, 1000, 5000), 5000);
  assert.equal(serverNow("not a time", 1000, 5000), 5000);
});

test("durations read the way somebody would say them", () => {
  assert.equal(humanDuration(30_000), "under a minute");
  assert.equal(humanDuration(1 * MIN), "1 minute");
  assert.equal(humanDuration(12 * MIN), "12 minutes");
  assert.equal(humanDuration(60 * MIN), "1 hour");
  assert.equal(humanDuration(80 * MIN), "1 hour 20 minutes");
  assert.equal(humanDuration(-5), "under a minute");
});

test("the countdown says which side of the start time we are on", () => {
  assert.equal(countdown(new Date(START), START - 12 * MIN), "Starts in 12 minutes");
  assert.equal(countdown(new Date(START), START + 3 * MIN), "Started 3 minutes ago");
});

test("an unreadable date shows nothing rather than 'Invalid Date'", () => {
  assert.equal(countdown("not a date", START), "");
});

test("a student with no teacher yet is told they are waiting, and not yet offered help", () => {
  const state = waitingState({ teacherJoinedAt: null, teacherIsLate: false, teacherLateBy: 3, known: true });
  assert.equal(state.offerHelp, false);
  assert.match(state.message, /Waiting for your teacher/);
});

test("past the line, the student is told how late and offered a way out", () => {
  const state = waitingState({ teacherJoinedAt: null, teacherIsLate: true, teacherLateBy: 14, known: true });
  assert.equal(state.offerHelp, true);
  assert.match(state.message, /14 minutes late/);
});

test("a teacher arriving on time clears the waiting message", () => {
  const state = waitingState({
    teacherJoinedAt: "2026-08-21T10:01:00.000Z", teacherIsLate: false, teacherLateBy: 1, known: true,
  });
  assert.equal(state.offerHelp, false);
  assert.match(state.message, /has joined/);
});

test("a teacher arriving late does not take the student's way out with them", () => {
  const state = waitingState({
    teacherJoinedAt: "2026-08-21T10:15:00.000Z", teacherIsLate: true, teacherLateBy: 15, known: true,
  });
  assert.equal(state.offerHelp, true, "the wait happened and cannot be undone by turning up");
  assert.match(state.message, /15 minutes after/);
});

test("a record we could not read never accuses anybody", () => {
  const state = waitingState({ teacherJoinedAt: null, teacherIsLate: false, teacherLateBy: null, known: false });
  assert.equal(state.offerHelp, false);
  assert.match(state.message, /could not check/);
});
