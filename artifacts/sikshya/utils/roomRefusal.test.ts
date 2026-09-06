import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RETRY_DELAY_MS,
  MIN_RETRY_DELAY_MS,
  RETRY_WITHOUT_OPENS_AT_MS,
  readRoomRefusal,
  retryDelayMs,
} from "./roomRefusal.ts";

/**
 * The difference between "not yet" and "never again".
 *
 * Every one of these is a branch that, when it was missing, put a teacher in front of a screen
 * telling them to abandon a class their students had booked. None of it needs a server.
 */

test("a class that has not opened yet is a wait, not an ending", () => {
  const refusal = readRoomRefusal(409, {
    error: "This class opens 10 minutes before it starts — that is in 1 day.",
    code: "too_early",
    opensAt: 1_800_000_000_000,
    expired: false,
  });
  assert.equal(refusal.kind, "waiting");
  assert.equal(refusal.opensAt, 1_800_000_000_000);
  assert.match(refusal.message, /opens 10 minutes before/);
});

test("a class that has finished is an ending", () => {
  const refusal = readRoomRefusal(409, {
    error: "This class finished 2 hours ago and can no longer be opened.",
    code: "finished",
    expired: true,
  });
  assert.equal(refusal.kind, "over");
  assert.equal(refusal.opensAt, undefined);
});

test("a cancelled class is an ending too", () => {
  assert.equal(readRoomRefusal(409, { error: "This class was cancelled.", code: "cancelled" }).kind, "over");
});

test("anything that is not a timing answer is an error, not an ending", () => {
  // 403, 502, 503 — a provider that is down must not tell somebody their class is over.
  for (const status of [401, 403, 500, 502, 503]) {
    assert.equal(readRoomRefusal(status, { error: "no" }).kind, "error", String(status));
  }
});

test("an older server, which sends only `expired`, is still understood", () => {
  /**
   * The whole reason `code` was added is that `expired: true` was on every timing refusal. A
   * build talking to a server that has not been updated yet must still behave, and the safe
   * reading of an unknown refusal is "over" — a screen that waits forever for a class that
   * finished is worse than one that ends a few minutes early, and the person can reopen it.
   */
  assert.equal(readRoomRefusal(409, { error: "Session expired.", expired: true }).kind, "over");
  assert.equal(readRoomRefusal(409, { error: "no code at all" }).kind, "over");
  // But a server that explicitly says it has not expired is believed.
  assert.equal(readRoomRefusal(409, { error: "not yet", expired: false }).kind, "waiting");
});

test("a code this build has never heard of does not become a wait", () => {
  assert.equal(readRoomRefusal(409, { error: "x", code: "something_new", expired: true }).kind, "over");
});

test("the server's own sentence is preferred, because it is the specific one", () => {
  const refusal = readRoomRefusal(409, { error: "that is in 26 minutes.", code: "too_early" }, "fallback");
  assert.equal(refusal.message, "that is in 26 minutes.");
});

test("and there is always something to say", () => {
  assert.equal(readRoomRefusal(409, {}, "  ").message, "This class cannot be opened just now.");
  assert.equal(readRoomRefusal(409, undefined, "from the error").message, "from the error");
  assert.equal(readRoomRefusal(409, { error: "   " }, "from the error").message, "from the error");
});

test("only a wait is retried", () => {
  const now = 1_000_000;
  assert.equal(retryDelayMs({ kind: "over", message: "x" }, now), null);
  assert.equal(retryDelayMs({ kind: "error", message: "x" }, now), null);
});

test("a wait with a known opening time comes back at it", () => {
  const now = 1_000_000;
  assert.equal(retryDelayMs({ kind: "waiting", message: "x", opensAt: now + 90_000 }, now), 90_000);
});

test("a long wait still wakes up regularly, because a phone will not keep a long timer", () => {
  const now = 1_000_000;
  // A tab that is backgrounded throttles timers and a dozing Android may not run one at all, so
  // "sleep for 26 hours" is a promise this app cannot make. It wakes and checks the clock.
  assert.equal(retryDelayMs({ kind: "waiting", message: "x", opensAt: now + 26 * 3600_000 }, now),
    MAX_RETRY_DELAY_MS);
});

test("a door that has already opened is retried at once, not in the past", () => {
  const now = 1_000_000;
  assert.equal(retryDelayMs({ kind: "waiting", message: "x", opensAt: now - 5_000 }, now), MIN_RETRY_DELAY_MS);
  assert.ok(MIN_RETRY_DELAY_MS > 0, "never a busy loop");
});

test("a wait with no opening time still comes back", () => {
  assert.equal(retryDelayMs({ kind: "waiting", message: "x" }, 0), RETRY_WITHOUT_OPENS_AT_MS);
});

test("a malformed opening time is ignored rather than trusted", () => {
  for (const opensAt of ["soon", null, Number.NaN, Infinity]) {
    const refusal = readRoomRefusal(409, { error: "x", code: "too_early", opensAt });
    assert.equal(refusal.kind, "waiting");
    assert.equal(refusal.opensAt, undefined, String(opensAt));
    assert.equal(retryDelayMs(refusal, 0), RETRY_WITHOUT_OPENS_AT_MS);
  }
});
