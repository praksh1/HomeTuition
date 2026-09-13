import assert from "node:assert/strict";
import { test } from "node:test";

import { ageOn, completedAccountAt } from "./onboardingRules.ts";

test("a birthday is age eighteen on the birthday and seventeen the day before", () => {
  assert.equal(ageOn("2008-08-30", new Date("2026-08-30T12:00:00Z")), 18);
  assert.equal(ageOn("2008-08-31", new Date("2026-08-30T12:00:00Z")), 17);
});

test("invalid and future dates are refused", () => {
  assert.equal(ageOn("2026-02-30", new Date("2026-08-30T12:00:00Z")), null);
  assert.equal(ageOn("2027-01-01", new Date("2026-08-30T12:00:00Z")), null);
});

test("editing preserves a completed legacy account without inventing a new decision", () => {
  const decided = new Date("2026-01-02T03:04:05Z");
  assert.equal(completedAccountAt({ existingCompletedAt: decided, hasProfilePhoto: false, role: "teacher" }), decided);
});

test("new teachers still need a photo while students may complete without one", () => {
  const now = new Date("2026-09-12T12:00:00Z");
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: false, role: "teacher", now }), null);
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: true, role: "teacher", now }), now);
  assert.equal(completedAccountAt({ existingCompletedAt: null, hasProfilePhoto: false, role: "student", now }), now);
});
