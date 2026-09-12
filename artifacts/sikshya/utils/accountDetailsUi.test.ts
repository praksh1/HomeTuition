import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(here, "..", relative), "utf8");
const accountCard = read("components/profile/AccountDetailsCard.tsx");
const teacherProfile = read("app/(teacher)/profile.tsx");
const studentProfile = read("app/(student)/profile.tsx");
const onboarding = read("app/onboarding.tsx");
const support = read("app/support.tsx");

test("teacher and student profiles share one editable account-details surface", () => {
  assert.match(teacherProfile, /AccountDetailsCard email=\{teacher\.email\} role="teacher"/);
  assert.match(studentProfile, /AccountDetailsCard email=\{student\.email\} role="student"/);
  assert.match(accountCard, /edit-account-details/);
  assert.match(accountCard, /\/onboarding/);
});

test("the login email is visible but cannot be silently changed", () => {
  assert.match(onboarding, /Login email/);
  assert.match(onboarding, /verified login email is protected/);
  assert.doesNotMatch(onboarding, /onChangeText=\{setEmail\}/);
});

test("the location editor keeps province and district controlled with explicit fallbacks below them", () => {
  assert.doesNotMatch(onboarding, /options=\{\[\.\.\.provinces/);
  assert.match(onboarding, /My municipality is not listed/);
  assert.match(onboarding, /School not listed/);
  assert.match(onboarding, /Independent teacher/);
  assert.match(onboarding, /Not applicable/);
});

test("a refund request explains the original-payment-method rule", () => {
  assert.match(support, /refund-original-payment-notice/);
  assert.match(support, /returned to the original payment method/);
  assert.match(support, /contact Support before the refund is processed/);
});
