import { test } from "node:test";
import assert from "node:assert/strict";
import { runIdentityRetentionJob, type RetentionJobStore } from "./identityRetentionJob.ts";
function fixture(cursor: number | null = 50) {
  const outcomes: unknown[] = [];
  const store: RetentionJobStore = { async claim() { return cursor; }, async finish(owner, result) { outcomes.push({ owner, ...result }); return true; } };
  return { store, outcomes };
}
test("an occupied or not-yet-due lease performs no deletion", async () => {
  const f = fixture(null);
  assert.equal((await runIdentityRetentionJob(f.store, "worker", async () => { throw Error("must not run"); })).state, "busy");
  assert.equal(f.outcomes.length, 0);
});
test("failed objects are retried even when later records succeeded", async () => {
  const f = fixture();
  assert.equal((await runIdentityRetentionJob(f.store, "worker", async () => ({ counts: { delete_file: 2 }, failedIds: [54, 52], nextCursor: 60 }))).state, "retry");
  assert.deepEqual(f.outcomes, [{ owner: "worker", cursor: 51, failed: true, cycleComplete: false }]);
});
test("a successful final batch resets the cursor and records a completed cycle", async () => {
  const f = fixture();
  await runIdentityRetentionJob(f.store, "worker", async () => ({ counts: {}, failedIds: [], nextCursor: null }));
  assert.deepEqual(f.outcomes, [{ owner: "worker", cursor: 0, failed: false, cycleComplete: true }]);
});
test("a failed batch retains its starting cursor", async () => {
  const f = fixture();
  await runIdentityRetentionJob(f.store, "worker", async () => { throw Error("database unavailable"); });
  assert.deepEqual(f.outcomes, [{ owner: "worker", cursor: 50, failed: true, cycleComplete: false }]);
});
test("a replaced lease cannot report a saved cleanup cycle", async () => {
  const f = fixture(); f.store.finish = async () => false;
  assert.equal((await runIdentityRetentionJob(f.store, "old-worker", async () => ({ counts: {}, failedIds: [], nextCursor: 60 }))).state, "lease_lost");
});
