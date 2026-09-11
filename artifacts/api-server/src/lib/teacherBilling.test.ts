import test from "node:test";
import assert from "node:assert/strict";
import { legacyTeacherPlanSalesOpen, teacherBillingPolicy } from "./teacherBilling.ts";

test("legacy sales default closed outside isolated tests", () => {
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" }, { LEGACY_TEACHER_PLAN_SALES: "typo" }]) {
    assert.equal(legacyTeacherPlanSalesOpen(env), false);
  }
});
test("legacy tests and explicit restoration do not open new checkout", () => {
  for (const env of [{ NODE_ENV: "test" }, { LEGACY_TEACHER_PLAN_SALES: "enabled" }]) {
    assert.equal(legacyTeacherPlanSalesOpen(env), true);
    assert.equal(teacherBillingPolicy(env).newClassCheckoutOpen, false);
  }
  assert.equal(legacyTeacherPlanSalesOpen({ NODE_ENV: "test", LEGACY_TEACHER_PLAN_SALES: "paused" }), false);
});
test("the planned split is the existing approved contract, not new pricing", () => {
  const policy = teacherBillingPolicy({});
  assert.equal(policy.teacherShareBps, 7000);
  assert.equal(policy.platformShareBps, 3000);
  assert.equal(policy.studentFeeNpr, 0);
  assert.equal(policy.status, "preparing");
});
