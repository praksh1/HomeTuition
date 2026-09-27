import assert from "node:assert/strict";
import { test } from "node:test";

import { ageOn, completedAccountAt, hasRequiredProfile, validNepalPhone } from "./onboardingRules.ts";

test("a birthday is age eighteen on the birthday and seventeen the day before", () => {
  assert.equal(ageOn("2008-08-30", new Date("2026-08-30T12:00:00Z")), 18);
  assert.equal(ageOn("2008-08-31", new Date("2026-08-30T12:00:00Z")), 17);
});

test("invalid and future dates are refused", () => {
  assert.equal(ageOn("2026-02-30", new Date("2026-08-30T12:00:00Z")), null);
  assert.equal(ageOn("2027-01-01", new Date("2026-08-30T12:00:00Z")), null);
});

test("legacy completion cannot bypass the required profile photo", () => {
  const decided = new Date("2026-01-02T03:04:05Z");
  assert.equal(completedAccountAt({ existingCompletedAt: decided, hasProfilePhoto: false, role: "teacher" }), null);
  assert.equal(completedAccountAt({ existingCompletedAt: decided, hasProfilePhoto: true, role: "teacher" }), decided);
});

test("both roles require photos", () => {
  const now = new Date("2026-09-12T12:00:00Z");
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: false, role: "teacher", now }), null);
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: true, role: "teacher", now }), now);
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: false, role: "student", now }), null);
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: true, role: "student", now }), now);
});

test("stored completion still requires valid contact and uploaded photo evidence", () => {
  const row = { completedAt: new Date(), phone: "9801234567", profilePhotoKey: "owned/photo.jpg" };
  assert.equal(hasRequiredProfile(row), true);
  assert.equal(hasRequiredProfile(undefined), false);
  assert.equal(hasRequiredProfile({ ...row, phone: "" }), false);
  assert.equal(hasRequiredProfile({ ...row, phone: "98012345678" }), false);
  assert.equal(hasRequiredProfile({ ...row, profilePhotoKey: null }), false);
  assert.equal(hasRequiredProfile({ ...row, completedAt: null }), false);
});

test("Nepal contact numbers accept ordinary mobile and landline formats, not eleven local digits", () => {
  assert.equal(validNepalPhone("9801234567"), true);
  assert.equal(validNepalPhone("+977 9801234567"), true);
  assert.equal(validNepalPhone("01-5551234"), true);
  assert.equal(validNepalPhone("+977 1 5551234"), true);
  assert.equal(validNepalPhone("98023445677"), false);
  assert.equal(validNepalPhone("12"), false);
});
