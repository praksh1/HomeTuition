import assert from "node:assert/strict";
import test from "node:test";

import { RequestTimeoutError, withinRequestDeadline } from "./requestDeadline.ts";

test("work that finishes inside the deadline keeps its result", async () => {
  const value = await withinRequestDeadline(async (signal) => {
    assert.equal(signal.aborted, false);
    return "ready";
  }, 100);
  assert.equal(value, "ready");
});

test("a transport that never settles cannot hold the app forever", async () => {
  const started = Date.now();
  let observedAbort = false;
  await assert.rejects(
    withinRequestDeadline(
      (signal) => new Promise<never>(() => {
        signal.addEventListener("abort", () => { observedAbort = true; }, { once: true });
      }),
      25,
    ),
    (error: unknown) => error instanceof RequestTimeoutError && error.code === "REQUEST_TIMEOUT",
  );
  assert.equal(observedAbort, true);
  assert.ok(Date.now() - started < 500, "deadline should settle promptly");
});

test("invalid deadlines fail immediately instead of creating an immortal timer", async () => {
  await assert.rejects(withinRequestDeadline(async () => "no", 0), /positive number/);
});
