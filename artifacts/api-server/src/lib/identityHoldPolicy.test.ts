import { test } from "node:test";
import assert from "node:assert/strict";
import { identityHoldChange, identityHoldSummary, parseIdentityHoldRequest } from "./identityHoldPolicy.ts";
import { identityRetentionAction } from "./identityPolicy.ts";
const now = new Date("2026-09-26T12:00:00Z");
const row = { id: 7, userId: 2, holdVersion: 0, holdStartedAt: null, holdReviewedAt: null, holdCaseId: null, fileDeletedAt: null, detailsDeletedAt: null };
const request = { action: "place" as const, caseId: 3, version: 0 };
const caseInfo = { related: true, status: "processing" };
test("hold mutations require explicit confirmation and strict numeric versions and case ids", () => {
  assert.deepEqual(parseIdentityHoldRequest({ ...request, confirmed: true }), request);
  for (const value of [{ ...request }, { ...request, confirmed: true, version: -1 }, { ...request, confirmed: true, caseId: "3" }, { ...request, confirmed: true, action: "ban" }]) assert.equal(parseIdentityHoldRequest(value), null);
});
test("manual hold placement, periodic review and release preserve audit revisions", () => {
  const placed = identityHoldChange(row, request, 1, caseInfo, now); assert.ok(placed.ok);
  const held = { ...row, ...placed.patch };
  assert.equal(held.holdVersion, 1); assert.equal(held.holdCaseId, 3);
  const reviewed = identityHoldChange(held, { ...request, action: "review", version: 1 }, 1, caseInfo, new Date("2026-12-01T12:00:00Z")); assert.ok(reviewed.ok);
  assert.equal(reviewed.patch.holdStartedAt, now); assert.equal(reviewed.patch.holdVersion, 2);
  const released = identityHoldChange({ ...held, ...reviewed.patch }, { ...request, action: "release", version: 2 }, 1, { ...caseInfo, status: "resolved" }, now); assert.ok(released.ok);
  assert.equal(released.patch.holdStartedAt, null); assert.equal(released.patch.holdCaseId, null);
});
test("self decisions, unrelated or closed cases, stale requests and deleted records fail closed", () => {
  assert.equal(identityHoldChange(row, request, 2, caseInfo).ok, false);
  assert.equal(identityHoldChange(row, request, 1, { ...caseInfo, related: false }).ok, false);
  for (const status of ["resolved", "denied", "cancelled"]) assert.equal(identityHoldChange(row, request, 1, { ...caseInfo, status }).ok, false);
  assert.equal(identityHoldChange(row, { ...request, version: 1 }, 1, caseInfo).ok, false);
  assert.equal(identityHoldChange({ ...row, fileDeletedAt: now, detailsDeletedAt: now }, request, 1, caseInfo).ok, false);
  assert.equal(identityHoldChange(row, { ...request, action: "release" }, 1, caseInfo).ok, false);
  const held = { ...row, holdStartedAt: now, holdCaseId: 3 };
  assert.equal(identityHoldChange(held, request, 1, caseInfo).ok, false);
  assert.equal(identityHoldChange(held, { ...request, action: "release", caseId: 4 }, 1, caseInfo).ok, false);
});
test("overdue holds require manual review, never automatic release or deletion", () => {
  const held = { ...row, holdStartedAt: now, holdCaseId: 3 };
  const future = new Date("2027-09-26T12:00:00Z");
  assert.equal(identityHoldSummary(held, future).overdue, true);
  assert.equal(identityRetentionAction({ ...held, status: "approved", reviewedAt: now, now: future }), "review_hold");
  assert.deepEqual(Object.keys(identityHoldSummary(held)).sort(), ["active", "caseId", "detailsDeleted", "documentDeleted", "id", "overdue", "reviewDueAt", "userId", "version"].sort());
});
