import { test } from "node:test";
import assert from "node:assert/strict";
import { birthDateInput, birthDateLabel, birthDateToAd, isFutureBirthDate } from "./birthDate.ts";
test("BS civil dates convert without timezone shifts", () => {
  assert.equal(birthDateToAd("2000-01-01", "bs"), "1943-04-14");
  assert.equal(birthDateInput("1943-04-14", "bs"), "2000-01-01");
  assert.equal(birthDateLabel("1943-04-14"), "1 Baisakh 2000 BS");
  assert.equal(birthDateToAd("२०००/०१/०१", "bs"), "1943-04-14");
});
test("changing calendars preserves the actual date across months and leap years", () => {
  for (const ad of ["1980-01-01", "1990-12-31", "2000-02-29", "2013-09-26", "2026-04-14"]) {
    const bs = birthDateInput(ad, "bs"); assert.ok(bs); assert.equal(birthDateToAd(bs, "bs"), ad);
  }
});
test("invalid, overflow and unsupported dates are not silently normalized", () => {
  for (const value of ["", "2083-00-01", "2083-13-01", "2083-01-00", "2083-01-33", "1500-01-01", "2083-1-1"]) assert.equal(birthDateToAd(value, "bs"), null);
  assert.equal(birthDateToAd("2001-02-29", "ad"), null);
  assert.equal(birthDateToAd("2000-02-29", "ad"), "2000-02-29");
  assert.equal(birthDateToAd("1930-01-01", "ad"), "1930-01-01");
});
test("future DOB validation uses the Nepal calendar day", () => {
  const now = new Date("2026-09-25T19:00:00Z");
  assert.equal(isFutureBirthDate("2026-09-26", now), false);
  assert.equal(isFutureBirthDate("2026-09-27", now), true);
});
