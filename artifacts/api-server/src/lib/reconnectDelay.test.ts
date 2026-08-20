import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The reconnect schedule, mirrored from artifacts/sikshya/hooks/useClassroomSocket.ts.
 *
 * The app package has no test runner of its own, and this is the piece of it whose behaviour a
 * user feels most directly — how long a student stares at a frozen class before they are back
 * in it. Kept here, byte for byte, with the properties that matter asserted. If the app's copy
 * changes, change this one and vice versa; the properties below are the contract.
 */
function reconnectDelay(attempt: number, everConnected: boolean): number {
  const base = everConnected
    ? Math.min(8000, 300 * 2 ** (attempt - 1))
    : Math.min(30000, 3000 * 2 ** (attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Worst case over many draws, since the delay is deliberately jittered. */
function worstCase(attempt: number, everConnected: boolean): number {
  let max = 0;
  for (let i = 0; i < 2000; i += 1) max = Math.max(max, reconnectDelay(attempt, everConnected));
  return max;
}

test("a student who was in the class is retried almost at once", () => {
  // The regression: this used to be a flat 3 seconds for the first retry, whether or not the
  // student had ever been connected. A phone that blinks off costs them a fraction of a
  // second now, not three.
  assert.ok(worstCase(1, true) < 400, `first retry was ${worstCase(1, true)}ms`);
});

test("a patchy connection never leaves a student waiting half a minute", () => {
  // It used to reach 30 seconds, during which their lesson carried on without them.
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    assert.ok(
      worstCase(attempt, true) <= 8000 * 1.2,
      `attempt ${attempt} could wait ${worstCase(attempt, true)}ms`,
    );
  }
});

test("a server that is refusing is still backed off from", () => {
  // The other half of the rule: never having connected is not a blip, and hammering a server
  // that is down helps nobody.
  assert.ok(reconnectDelay(1, false) >= 2000, "first attempt should be seconds, not instant");
  assert.ok(worstCase(6, false) <= 30000 * 1.2, "and still capped");
  assert.ok(worstCase(6, false) > 8000, "but higher than the reconnect ceiling");
});

test("the delay grows, so a persistent failure is not a busy loop", () => {
  const early = reconnectDelay(1, true);
  const later = reconnectDelay(5, true);
  assert.ok(later > early, `expected growth, got ${early} then ${later}`);
});

test("two students disconnected at the same instant do not return in lockstep", () => {
  // A teacher's connection wobbling disconnects the whole class at once. Without jitter they
  // would all reconnect on the same tick.
  const draws = new Set<number>();
  for (let i = 0; i < 200; i += 1) draws.add(reconnectDelay(4, true));
  assert.ok(draws.size > 50, `only ${draws.size} distinct delays in 200 draws`);
});

test("jitter never produces a zero or negative delay", () => {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    for (let i = 0; i < 200; i += 1) {
      const delay = reconnectDelay(attempt, attempt % 2 === 0);
      assert.ok(delay > 0, `attempt ${attempt} produced ${delay}ms`);
    }
  }
});
