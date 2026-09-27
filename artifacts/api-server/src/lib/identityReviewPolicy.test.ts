import { test } from "node:test";
import assert from "node:assert/strict";
import { auditedIdentityRead, mayDecideIdentity } from "./identityReviewPolicy.ts";

test("sensitive data is released only after both audit receipts", async () => {
  const actions: string[] = [];
  const value = await auditedIdentityRead("metadata", async action => { actions.push(action); }, async () => { actions.push("decrypt"); return "synthetic"; });
  assert.equal(value, "synthetic");
  assert.deepEqual(actions, ["metadata_access_requested", "decrypt", "metadata_opened"]);
});
test("failed download does not count as document opened", async () => {
  const actions: string[] = [];
  await assert.rejects(auditedIdentityRead("document", async action => { actions.push(action); }, async () => { throw Error("storage offline"); }));
  assert.deepEqual(actions, ["document_access_requested"]);
});
test("failed initial audit prevents storage access", async () => {
  let accessed = false;
  await assert.rejects(auditedIdentityRead("document", async () => { throw Error("audit offline"); }, async () => { accessed = true; return "synthetic"; }));
  assert.equal(accessed, false);
});
test("failed completion audit prevents sensitive data release", async () => {
  await assert.rejects(auditedIdentityRead("document", async action => { if (action.endsWith("_opened")) throw Error("audit offline"); }, async () => "synthetic"));
});
test("approval requires both successful reads by a different reviewer", () => {
  const base = { ownerId: 1, reviewerId: 2, status: "submitted", actions: ["document_opened", "metadata_opened"] };
  assert.equal(mayDecideIdentity(base), true);
  for (const actions of [[], ["document_access_requested", "metadata_opened"], ["document_opened"]]) assert.equal(mayDecideIdentity({ ...base, actions }), false);
  assert.equal(mayDecideIdentity({ ...base, reviewerId: 1 }), false);
  for (const status of ["pending_upload", "approved", "rejected"]) assert.equal(mayDecideIdentity({ ...base, status }), false);
});
