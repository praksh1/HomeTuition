import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedRefresh } from "./coalescedRefresh.ts";

test("a burst of socket and recovery nudges shares the read and gets one trailing refresh", async () => {
  let calls = 0;
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const refresh = createCoalescedRefresh(async () => {
    calls++; active++; peak = Math.max(peak, active);
    if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
    active--;
  });
  const first = refresh();
  await Promise.resolve();
  for (let i = 0; i < 50; i++) assert.equal(refresh(), first);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  await refresh();
  assert.equal(calls, 3);
});
test("a refused read does not permanently wedge future recovery", async () => {
  let calls = 0;
  const refresh = createCoalescedRefresh(async () => { if (++calls === 1) throw new Error("offline"); });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(calls, 2);
});
