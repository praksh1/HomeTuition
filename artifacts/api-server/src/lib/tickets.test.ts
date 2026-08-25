import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TICKETS_PER_DAY,
  canTransition,
  displayStatus,
  isTerminal,
  needsJustification,
  statusLabel,
  ticketAllowance,
  ticketIdFromRef,
  ticketRef,
} from "./tickets.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);

test("a request moves forward, and never back", () => {
  assert.equal(canTransition("open", "opened").ok, true);
  assert.equal(canTransition("opened", "assigned").ok, true);
  assert.equal(canTransition("assigned", "processing").ok, true);
  assert.equal(canTransition("processing", "resolved").ok, true);

  assert.equal(canTransition("processing", "open").ok, false);
  assert.equal(canTransition("assigned", "opened").ok, false);
});

test("nothing happens to a request that is finished", () => {
  /**
   * A ticket that can be reopened is one where the history stops meaning anything: the person
   * reading it cannot tell whether their problem was dealt with once, twice, or not at all.
   */
  for (const done of ["resolved", "denied", "cancelled"]) {
    assert.equal(isTerminal(done), true, done);
    for (const next of ["open", "opened", "assigned", "processing", "resolved", "denied", "cancelled"]) {
      const verdict = canTransition(done, next);
      assert.equal(verdict.ok, false, `${done} -> ${next}`);
      /**
       * And it says *why* — that the request is finished, not merely that the move is not
       * allowed. Two guards refuse this independently, so dropping the one that knows the
       * request is finished still refuses the move, just with a sentence that tells an agent
       * nothing about what they are looking at.
       */
      if (next !== done) {
        assert.match(
          verdict.ok ? "" : verdict.reason,
          /cannot be changed/,
          `${done} -> ${next} refused without saying it is finished: ${verdict.ok ? "" : verdict.reason}`,
        );
      }
    }
  }
});

test("an agent may answer in one step, because most requests are answered in one reading", () => {
  assert.equal(canTransition("open", "resolved").ok, true);
  assert.equal(canTransition("open", "denied").ok, true);
});

test("a request cannot be moved to where it already is", () => {
  assert.equal(canTransition("processing", "processing").ok, false);
  assert.equal(canTransition("open", "open").ok, false);
});

test("a status nobody has heard of is refused", () => {
  assert.equal(canTransition("open", "banana").ok, false);
  assert.equal(canTransition("open", "").ok, false);
});

test("the old in_review is the same state as processing, under one name", () => {
  // Rows already carry it. Two words for one state is how a person ends up asking what the
  // difference is, and there is none.
  assert.equal(displayStatus("in_review"), "processing");
  assert.equal(statusLabel("in_review"), statusLabel("processing"));
  assert.equal(canTransition("in_review", "resolved").ok, true);
  assert.equal(canTransition("in_review", "processing").ok, false, "it is already that state");
});

test("an ending a person will argue with has to carry a reason", () => {
  assert.equal(needsJustification("resolved"), true);
  assert.equal(needsJustification("denied"), true);
  assert.equal(needsJustification("processing"), false);
  assert.equal(needsJustification("opened"), false);
});

test("three requests a day, and the fourth is refused", () => {
  const none = ticketAllowance([], NOW);
  assert.equal(none.ok, true);
  assert.equal(none.remaining, MAX_TICKETS_PER_DAY);

  const two = ticketAllowance([NOW - HOUR, NOW - 2 * HOUR], NOW);
  assert.equal(two.ok, true);
  assert.equal(two.remaining, 1);

  const three = ticketAllowance([NOW - HOUR, NOW - 2 * HOUR, NOW - 3 * HOUR], NOW);
  assert.equal(three.ok, false);
  assert.equal(three.remaining, 0);
  assert.match(three.reason ?? "", /3 requests a day/);
});

test("the wait is the same for everybody, whatever hour they filed at", () => {
  /**
   * A limit that resets at midnight gives somebody who filed at eleven at night three more an
   * hour later, and somebody who filed at nine in the morning a fifteen-hour wait for the same
   * behaviour. The window rolls from each request instead.
   */
  const lateNight = ticketAllowance([NOW - HOUR, NOW - HOUR, NOW - HOUR], NOW);
  assert.equal(lateNight.ok, false);
  const hoursLeft = Math.round(((lateNight.nextAllowedAt ?? NOW) - NOW) / HOUR);
  assert.equal(hoursLeft, 23, "the oldest of the three frees up first");
});

test("a request from yesterday does not count against today", () => {
  const old = ticketAllowance([NOW - 25 * HOUR, NOW - 30 * HOUR, NOW - 40 * HOUR], NOW);
  assert.equal(old.ok, true);
  assert.equal(old.used, 0);
});

test("and the allowance frees up one at a time, not all at once", () => {
  // Filed at 1, 12 and 20 hours ago: the oldest falls out of the window first.
  const spread = ticketAllowance([NOW - HOUR, NOW - 12 * HOUR, NOW - 20 * HOUR], NOW);
  assert.equal(spread.ok, false);
  const hours = Math.round(((spread.nextAllowedAt ?? NOW) - NOW) / HOUR);
  assert.equal(hours, 4, "the one filed twenty hours ago frees up in four");
});

test("somebody already over the limit waits for their third-newest, not their oldest", () => {
  /**
   * The case that separates the right answer from a plausible one.
   *
   * Rows exist from before this limit did, so a person can start out with five inside the
   * window. Waiting for the *oldest* to fall out frees nothing — four would still be there.
   * What frees a slot is the third-newest going, and with exactly three in the window those
   * are the same row, which is why every other test here passes either way.
   */
  const five = ticketAllowance(
    [NOW - 2 * HOUR, NOW - 5 * HOUR, NOW - 9 * HOUR, NOW - 18 * HOUR, NOW - 23 * HOUR],
    NOW,
  );
  assert.equal(five.ok, false);
  assert.equal(five.used, 5);
  const hours = Math.round(((five.nextAllowedAt ?? NOW) - NOW) / HOUR);
  assert.equal(hours, 15, "waiting for the oldest would have said one hour, and freed nothing");
});

test("a request has a number a person can quote", () => {
  assert.equal(ticketRef(1), "HT-000001");
  assert.equal(ticketRef(123), "HT-000123");
  assert.equal(ticketRef(987654), "HT-987654");
});

test("and that number reads back, however somebody types it", () => {
  for (const [text, id] of [
    ["HT-000123", 123],
    ["ht-000123", 123],
    ["  HT-123  ", 123],
    ["123", 123],
    ["000123", 123],
  ] as const) {
    assert.equal(ticketIdFromRef(text), id, text);
  }
  for (const bad of ["", "HT-", "abc", "HT-12a", "-1"]) {
    assert.equal(ticketIdFromRef(bad), null, bad);
  }
});
