import assert from "node:assert/strict";
import { test } from "node:test";

import { ageOn } from "./onboardingRules.ts";

test("a birthday is age eighteen on the birthday and seventeen the day before", () => {
  assert.equal(ageOn("2008-08-30", new Date("2026-08-30T12:00:00Z")), 18);
  assert.equal(ageOn("2008-08-31", new Date("2026-08-30T12:00:00Z")), 17);
});

test("invalid and future dates are refused", () => {
  assert.equal(ageOn("2026-02-30", new Date("2026-08-30T12:00:00Z")), null);
  assert.equal(ageOn("2027-01-01", new Date("2026-08-30T12:00:00Z")), null);
});
