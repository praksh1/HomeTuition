import assert from "node:assert/strict";
import test from "node:test";

import { listedLocalLevel, validNepalProvinceDistrict } from "./nepalLocationRules.ts";

test("accepts a district only under its real province", () => {
  assert.equal(validNepalProvinceDistrict("Bagmati", "Kathmandu"), true);
  assert.equal(validNepalProvinceDistrict("Koshi", "Kathmandu"), false);
});

test("rejects invented and unspecified provinces or districts", () => {
  assert.equal(validNepalProvinceDistrict("Not specified", "Kathmandu"), false);
  assert.equal(validNepalProvinceDistrict("Bagmati", "Made Up District"), false);
});

test("recognises listed municipalities without preventing a manual fallback", () => {
  assert.equal(listedLocalLevel("Bagmati", "Kathmandu", "Kathmandu"), true);
  assert.equal(listedLocalLevel("Bagmati", "Kathmandu", "A newly formed local level"), false);
});
