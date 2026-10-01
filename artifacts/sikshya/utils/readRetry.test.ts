import assert from "node:assert/strict";
import test from "node:test";
import { isTransientReadFailure, retryOneTransientRead } from "./readRetry.ts";
import { withinRequestDeadline, RequestTimeoutError } from "./requestDeadline.ts";

const unavailable = (status: number) => Object.assign(new Error("temporary"), { status });
test("a transport failure or gateway interruption gets one safe GET retry", async () => {
  for (const failure of [new TypeError("Failed to fetch"), unavailable(502), unavailable(503), unavailable(504)]) {
    let calls = 0;
    const signal = new AbortController().signal;
    const result = await retryOneTransientRead(async () => { if (++calls === 1) throw failure; return "ready"; }, "GET", signal, async () => {});
    assert.equal(result, "ready");
    assert.equal(calls, 2);
  }
});
test("payments and every mutation are never replayed, including lowercase methods", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    let calls = 0;
    const failure = unavailable(503);
    await assert.rejects(retryOneTransientRead(async () => { calls++; throw failure; }, method, new AbortController().signal), error => error === failure);
    assert.equal(calls, 1);
  }
});
test("auth, validation, missing routes, rate limits and application failures do not retry", async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
    let calls = 0;
    const failure = unavailable(status);
    await assert.rejects(retryOneTransientRead(async () => { calls++; throw failure; }, undefined, new AbortController().signal), error => error === failure);
    assert.equal(calls, 1);
  }
  assert.equal(isTransientReadFailure({ status: 503 }), false);
});
test("a second failure propagates and cannot become an endless loop", async () => {
  let calls = 0;
  await assert.rejects(retryOneTransientRead(async () => { calls++; throw unavailable(503); }, "GET", new AbortController().signal, async () => {}));
  assert.equal(calls, 2);
});
test("retry delay remains inside the original hard request deadline", async () => {
  let calls = 0;
  await assert.rejects(withinRequestDeadline(signal => retryOneTransientRead(async () => { calls++; throw unavailable(503); }, "GET", signal), 20), RequestTimeoutError);
  assert.equal(calls, 1);
});
test("an already-cancelled request is not replayed", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(retryOneTransientRead(async () => { calls++; throw new TypeError("offline"); }, "GET", controller.signal));
  assert.equal(calls, 1);
});
