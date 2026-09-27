import { test } from "node:test";
import assert from "node:assert/strict";
import { identityAccess, identityFileDeleteAfter, identityDetailsDeleteAfter, identityRetentionAction, identityStatusSummary, validateIdentityDetails } from "./identityPolicy.ts";
import { openIdentity, sealIdentity } from "./identityCrypto.ts";

// Fictional metadata only. No identity documents or real identity values in fixtures.
const details = { holder: "self", documentType: "citizenship", legalName: "Synthetic Test Person",
  documentNumber: "TEST-NOT-A-REAL-ID", dateOfBirth: "1990-01-01", issuingDistrict: "Test district",
  issuingMunicipality: "Test municipality", consent: true };
const now = new Date("2026-09-26T00:00:00Z");
test("citizenship required; school ID alone cannot satisfy policy", () => {
  assert.equal(validateIdentityDetails(details, "student", now).ok, true);
  assert.equal(validateIdentityDetails({ ...details, documentType: "school_id" }, "student", now).ok, false);
});
test("student parent identity is distinct and needs holder consent and relationship", () => {
  assert.equal(validateIdentityDetails({ ...details, holder: "parent" }, "student", now).ok, false);
  const input = { ...details, holder: "parent", parentRelationship: "Mother" };
  const parsed = validateIdentityDetails(input, "student", now);
  assert.ok(parsed.ok);
  assert.equal(parsed.value.holder, "parent");
  assert.equal(validateIdentityDetails({ ...input, consent: false }, "student", now).ok, false);
  assert.equal(validateIdentityDetails(input, "teacher", now).ok, false);
});
test("specific invalid fields and future/impossible birthdays are rejected", () => {
  for (const dateOfBirth of ["2027-01-01", "2000-02-30", "not-a-date"]) {
    const result = validateIdentityDetails({ ...details, dateOfBirth }, "student", now);
    assert.ok(!result.ok); assert.deepEqual(Object.keys(result.errors), ["dateOfBirth"]);
  }
  assert.equal(validateIdentityDetails({ ...details, legalName: "x".repeat(161) }, "student", now).ok, false);
});
test("students need no citizenship submission to book; teachers require operator approval", () => {
  assert.equal(identityAccess("student", "pending_upload").mayBook, true);
  assert.equal(identityAccess("student", "submitted").mayBook, true);
  assert.equal(identityAccess("student", "approved").mayBook, true);
  assert.equal(identityAccess("student", null).mayBook, true);
  assert.equal(identityAccess("student", "rejected").mayBook, true);
  for (const status of [null, "submitted", "rejected"] as const) assert.equal(identityAccess("teacher", status).mayAcceptBookings, false);
  assert.equal(identityAccess("teacher", "approved").mayAcceptBookings, true);
  assert.equal(identityAccess("student", "approved").mayAcceptBookings, false);
});

test("closure retention is one calendar year, including leap-day anniversaries", () => {
  assert.equal(identityDetailsDeleteAfter(new Date("2028-02-29T12:30:00Z"))?.toISOString(), "2029-02-28T12:30:00.000Z");
  assert.equal(identityDetailsDeleteAfter(new Date("2027-09-26T12:30:00Z"))?.toISOString(), "2028-09-26T12:30:00.000Z");
  assert.equal(identityDetailsDeleteAfter(null), null);
  const row = { status: "approved" as const, reviewedAt: now, fileDeletedAt: now, detailsDeletedAt: null, accountClosedAt: now, holdStartedAt: null, holdReviewedAt: null, now: new Date("2027-09-26T00:00:00Z") };
  assert.equal(identityRetentionAction(row), "delete_closed_details");
  assert.equal(identityRetentionAction({ ...row, now: new Date(row.now.getTime()-1) }), "keep");
  assert.equal(identityRetentionAction({ ...row, detailsDeletedAt: row.now }), "keep");
  assert.equal(identityRetentionAction({ ...row, holdStartedAt: row.now }), "keep");
});

test("abandoned upload details expire after 30 days but live submitted reviews do not", () => {
  const row = { status: "pending_upload" as const, createdAt: now, reviewedAt: null, fileDeletedAt: null, holdStartedAt: null, holdReviewedAt: null, now: new Date("2026-10-26T00:00:00Z") };
  assert.equal(identityRetentionAction(row), "delete_abandoned_details");
  assert.equal(identityRetentionAction({ ...row, now: new Date(row.now.getTime()-1) }), "keep");
  assert.equal(identityRetentionAction({ ...row, status: "submitted" }), "keep");
});
test("90-day approved file and 30-day rejected details deadlines start at review", () => {
  assert.equal(identityFileDeleteAfter("approved", now)?.toISOString(), "2026-12-25T00:00:00.000Z");
  assert.equal(identityFileDeleteAfter("rejected", now)?.toISOString(), "2026-10-26T00:00:00.000Z");
  assert.equal(identityFileDeleteAfter("submitted", now), null);
  assert.equal(identityFileDeleteAfter("approved", null), null);
});
test("retention boundaries, completed deletion, and investigation review do not silently drop evidence", () => {
  const row = { status: "approved" as const, reviewedAt: now, fileDeletedAt: null, holdStartedAt: null, holdReviewedAt: null, now: new Date("2026-12-25T00:00:00Z") };
  assert.equal(identityRetentionAction(row), "delete_file");
  assert.equal(identityRetentionAction({ ...row, now: new Date(row.now.getTime()-1) }), "keep");
  assert.equal(identityRetentionAction({ ...row, fileDeletedAt: row.now }), "keep");
  assert.equal(identityRetentionAction({ ...row, status: "rejected" }), "delete_rejected_details");
  assert.equal(identityRetentionAction({ ...row, holdStartedAt: now }), "review_hold");
  assert.equal(identityRetentionAction({ ...row, holdStartedAt: now, holdReviewedAt: row.now }), "keep");
});
test("status DTO cannot spread legal fields or file keys into profiles", () => {
  const row = { ...details, id: 1, holder: "self" as const, status: "approved" as const, createdAt: now, reviewedAt: now, fileDeletedAt: null, fileKey: "private", detailsCiphertext: "secret" };
  const json = JSON.stringify(identityStatusSummary(row));
  for (const sensitive of [details.legalName, details.documentNumber, details.dateOfBirth, "fileKey", "detailsCiphertext", "issuingDistrict"]) assert.ok(!json.includes(sensitive));
});
test("encrypted records roundtrip with randomized ciphertext; no plaintext in envelope", () => {
  const key = "ab".repeat(32); const text = JSON.stringify(details);
  const a = sealIdentity(text, key, "user:1:record:1");
  const b = sealIdentity(text, key, "user:1:record:1");
  assert.notEqual(a,b); assert.ok(!a.includes(details.documentNumber));
  assert.equal(openIdentity(a, key, "user:1:record:1"), text);
});
test("encryption rejects another account, wrong key, altered ciphertext, and missing key", () => {
  const key = "ab".repeat(32); const a = sealIdentity("private", key, "user:1:record:1");
  assert.throws(() => openIdentity(a, key, "user:2:record:1"));
  assert.throws(() => openIdentity(a, "cd".repeat(32), "user:1:record:1"));
  const parts = a.split("."); parts[3] = Buffer.from("changed").toString("base64url");
  assert.throws(() => openIdentity(parts.join("."), key, "user:1:record:1"));
  assert.throws(() => sealIdentity("private", "", "user:1:record:1"));
  assert.throws(() => openIdentity("v1.invalid.bad.no", key, "user:1:record:1"));
});
