import assert from "node:assert/strict";
import test from "node:test";
import { ageOn } from "../../api-server/src/lib/onboardingRules.ts";
import { registrationAge, registrationErrors, type RegistrationValues } from "./registration.ts";
const values: RegistrationValues = { name: "Test Student", email: "test@example.com", password: "long-test-password", confirmPassword: "long-test-password", subject: "Korean", bio: "Language tutor", grade: "Adult / professional", dateOfBirth: "2000-01-01", guardianName: "", guardianEmail: "", guardianPhone: "", guardianRelationship: "" };
test("birthdays and invalid dates agree with the server", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  for (const birth of ["2008-09-25", "2008-09-26", "2008-09-27", "2026-02-30", "2000-02-29", "2027-01-01", "", "0000-01-01"]) assert.equal(registrationAge(birth, now), ageOn(birth, now));
  assert.equal(registrationAge("2008-09-27", now), 17);
});
test("field errors are specific and a learning level must be explicitly chosen", () => {
  assert.deepEqual(registrationErrors(values, false), {});
  assert.deepEqual(registrationErrors({ ...values, grade: "" }, false), { grade: "Choose your current learning level." });
  assert.deepEqual(Object.keys(registrationErrors({ ...values, email: "bad", password: "short" }, false)), ["email", "password", "confirmPassword"]);
});
test("custom teacher subjects work and missing bio is identified", () => {
  assert.deepEqual(registrationErrors({ ...values, subject: "Woodworking" }, true), {});
  assert.equal(registrationErrors({ ...values, bio: "" }, true).bio, "Tell students about your experience and teaching style.");
});
test("guardian details are required until the exact eighteenth birthday", () => {
  const young = { ...values, dateOfBirth: "2008-09-27" };
  assert.equal(Object.keys(registrationErrors(young, false, new Date("2026-09-26T12:00Z"))).length, 4);
  assert.deepEqual(registrationErrors(young, false, new Date("2026-09-27T12:00Z")), {});
});
