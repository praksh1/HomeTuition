import { test } from "node:test";
import assert from "node:assert/strict";
import { applyIdentityRetention, type IdentityRetentionStore, type RetainedIdentity } from "./identityRetention.ts";
const reviewed = new Date("2026-01-01T00:00:00Z");
const now = new Date("2026-05-01T00:00:00Z");
function fixture(patch: Partial<RetainedIdentity> = {}) {
  const row: RetainedIdentity = { id: 1, status: "approved", reviewedAt: reviewed, fileKey: "private-test-file",
    fileDeletedAt: null, detailsDeletedAt: null, holdStartedAt: null, holdReviewedAt: null, ...patch };
  const events: string[] = [];
  const store: IdentityRetentionStore = {
    async withLockedRecord(_id, work) { events.push("lock"); return work(row); },
    async deletePrivateFile() { events.push("delete"); },
    async recordDeletion(_id, result) { events.push(result.eraseDetails ? "erase-details" : "keep-details"); row.fileDeletedAt = result.fileDeletedAt; if (result.eraseDetails) row.detailsDeletedAt = now; },
    async flagHoldReview() { events.push("review-hold"); },
  };
  return { row, store, events };
}
test("approved deletion retains encrypted reference details and is repeat safe", async () => {
  const f = fixture();
  assert.equal(await applyIdentityRetention(f.store, 1, now), "delete_file");
  assert.deepEqual(f.events, ["lock", "delete", "keep-details"]);
  assert.equal(await applyIdentityRetention(f.store, 1, now), "keep");
});
test("rejected submission purges details only after file deletion succeeds", async () => {
  const f = fixture({ status: "rejected" });
  await applyIdentityRetention(f.store, 1, now);
  assert.deepEqual(f.events, ["lock", "delete", "erase-details"]);
});
test("storage failure never writes a false deletion receipt", async () => {
  const f = fixture(); f.store.deletePrivateFile = async () => { throw Error("unavailable"); };
  await assert.rejects(() => applyIdentityRetention(f.store, 1, now));
  assert.deepEqual(f.events, ["lock"]); assert.equal(f.row.fileDeletedAt, null);
});
test("overdue fraud hold requests review, never deletes or releases the hold", async () => {
  const f = fixture({ holdStartedAt: reviewed });
  assert.equal(await applyIdentityRetention(f.store, 1, now), "review_hold");
  assert.deepEqual(f.events, ["lock", "review-hold"]);
  assert.equal(f.row.holdStartedAt, reviewed);
});
test("untraceable file is an error, not a deletion success", async () => {
  const f = fixture({ fileKey: null });
  await assert.rejects(() => applyIdentityRetention(f.store, 1, now));
  assert.deepEqual(f.events, ["lock"]);
});

test("one-year closure removes retained references without re-deleting an already removed file", async () => {
  const f = fixture({ accountClosedAt: new Date("2025-05-01T00:00:00Z"), fileDeletedAt: reviewed, fileKey: null });
  assert.equal(await applyIdentityRetention(f.store, 1, now), "delete_closed_details");
  assert.deepEqual(f.events, ["lock", "erase-details"]);
  assert.equal(await applyIdentityRetention(f.store, 1, now), "keep");
});

test("abandoned preparation is purged, but its failed deletion is retriable", async () => {
  const f = fixture({ status: "pending_upload", reviewedAt: null, createdAt: reviewed });
  assert.equal(await applyIdentityRetention(f.store, 1, now), "delete_abandoned_details");
  assert.deepEqual(f.events, ["lock", "delete", "erase-details"]);
  assert.equal(await applyIdentityRetention(f.store, 1, now), "keep");
});
