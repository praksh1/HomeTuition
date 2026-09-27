import test from "node:test";
import assert from "node:assert/strict";
import { legacyStandaloneCreationOpen, legacyTeacherPlanSalesOpen, teacherBillingPolicy } from "./teacherBilling.ts";

test("the teacher-paid standalone creator is unavailable on any deployed runtime", () => {
  assert.equal(legacyStandaloneCreationOpen({}), false);
  assert.equal(legacyStandaloneCreationOpen({ NODE_ENV: "production", LEGACY_TEACHER_PLAN_SALES: "enabled" }), false);
  assert.equal(legacyStandaloneCreationOpen({ NODE_ENV: "development" }), false);
  assert.equal(legacyStandaloneCreationOpen({ NODE_ENV: "test" }), true);
});

test("legacy sales stay closed in deployed runtimes even with a stale enable switch", () => {
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" }, { LEGACY_TEACHER_PLAN_SALES: "typo" }, { NODE_ENV: "production", LEGACY_TEACHER_PLAN_SALES: "enabled" }]) {
    assert.equal(legacyTeacherPlanSalesOpen(env), false);
  }
});
test("legacy tests do not open new checkout", () => {
  for (const env of [{ NODE_ENV: "test" }, { NODE_ENV: "test", LEGACY_TEACHER_PLAN_SALES: "enabled" }]) {
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
