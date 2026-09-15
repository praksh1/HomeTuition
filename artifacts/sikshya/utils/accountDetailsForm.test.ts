import assert from "node:assert/strict";
import test from "node:test";

import {
  accountDetailsDraft,
  accountDetailsNeedConfirmation,
  completeAccountDetails,
  firstAccountDetailsIssue,
  validNepalPhone,
  type AccountDetailsDraft,
} from "./accountDetailsForm.ts";

const complete: AccountDetailsDraft = {
  phone: "+977 9800000000",
  province: "Bagmati Province",
  district: "Kathmandu",
  localLevel: "Kathmandu Metropolitan City",
  locality: "Baneshwor",
  affiliationStatus: "independent",
  institutionName: "",
};

test("a coherent saved profile is prefilled exactly as the person saved it", () => {
  assert.deepEqual(accountDetailsDraft(complete), complete);
  assert.equal(completeAccountDetails(complete), true);
});

test("an inconsistent legacy row cannot masquerade as a location the person selected", () => {
  const draft = accountDetailsDraft({
    ...complete,
    phone: null,
    province: "Bagmati Province",
    district: "Kathmandu",
    localLevel: "Kathmandu Metropolitan City",
  });
  assert.equal(draft.phone, "");
  assert.equal(draft.province, "");
  assert.equal(draft.district, "");
  assert.equal(draft.localLevel, "");
  assert.equal(draft.affiliationStatus, "unselected");
  assert.equal(completeAccountDetails({ ...complete, phone: null }), false);
  assert.equal(accountDetailsNeedConfirmation({ ...complete, phone: null }), true);
});

test("a phone number cannot make known staging placeholders look person-confirmed", () => {
  const fixture = {
    ...complete,
    phone: "9801234567",
    locality: "Synthetic staging fixture",
    institutionName: "Synthetic Staging School",
    affiliationStatus: "not_specified" as const,
  };
  assert.deepEqual(accountDetailsDraft(fixture), accountDetailsDraft(null));
  assert.equal(completeAccountDetails(fixture), false);
  assert.equal(accountDetailsNeedConfirmation(fixture), true);
});

test("a genuinely complete profile is not asked to reconfirm on every visit", () => {
  assert.equal(accountDetailsNeedConfirmation(complete), false);
  assert.equal(accountDetailsNeedConfirmation(null), false);
});

test("validation gives one useful next action, beginning with the missing phone", () => {
  const blank = accountDetailsDraft(null);
  assert.deepEqual(firstAccountDetailsIssue(blank), {
    field: "phone",
    message: "Enter your phone number.",
  });
});

test("after the phone is fixed, validation advances to the actual next field", () => {
  assert.deepEqual(firstAccountDetailsIssue({ ...accountDetailsDraft(null), phone: "+977 9800000000" }), {
    field: "province",
    message: "Choose your province.",
  });
});

test("an invalid phone does not blame the location", () => {
  assert.deepEqual(firstAccountDetailsIssue({ ...complete, phone: "12" }), {
    field: "phone",
    message: "Enter a valid Nepal mobile or landline number.",
  });
});

test("Nepal phone validation rejects the reported eleven-digit local number", () => {
  assert.equal(validNepalPhone("98023445677"), false);
  assert.equal(validNepalPhone("9801234567"), true);
  assert.equal(validNepalPhone("+977 9801234567"), true);
  assert.equal(validNepalPhone("01-5551234"), true);
  assert.equal(validNepalPhone("+977 1 5551234"), true);
});

test("a fully valid independent profile has nothing to correct", () => {
  assert.equal(firstAccountDetailsIssue(complete), null);
});

test("an affiliated profile names its missing institution only after the location is complete", () => {
  assert.deepEqual(firstAccountDetailsIssue({ ...complete, affiliationStatus: "affiliated", institutionName: "" }), {
    field: "institutionName",
    message: "Choose or enter your school or college.",
  });
});
