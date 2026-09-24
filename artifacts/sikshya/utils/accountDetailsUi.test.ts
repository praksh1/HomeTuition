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
const profileHero = read("components/profile/ProfileHero.tsx");
const profileMenu = read("components/profile/ProfileOverflowMenu.tsx");
const appShellHeader = read("components/navigation/AppShellHeader.tsx");
const selectionField = read("components/profile/SearchableSelectionField.tsx");

test("teacher and student profiles share one editable account-details surface", () => {
  assert.match(teacherProfile, /AccountDetailsCard email=\{teacher\.email\} role="teacher"/);
  assert.match(studentProfile, /AccountDetailsCard email=\{student\.email\} role="student"/);
  assert.match(accountCard, /edit-account-details/);
  assert.match(accountCard, /\/onboarding/);
});

test("both roles share the premium identity hero and descriptive action rows", () => {
  assert.match(teacherProfile, /<ProfileHero/);
  assert.match(studentProfile, /<ProfileHero/);
  assert.match(teacherProfile, /<ProfileActionRow/);
  assert.match(studentProfile, /<ProfileActionRow/);
  assert.match(profileHero, /MY FADKO PROFILE|eyebrow/);
  assert.doesNotMatch(studentProfile, /No saved payment method/);
});

test("both roles expose the working support assistant with automation and human-review disclosure", () => {
  assert.match(appShellHeader, /<ProfileOverflowMenu items=\{items\}/);
  assert.match(appShellHeader, /role === "teacher"/);
  assert.match(profileMenu, />Menu</);
  assert.match(appShellHeader, /label: "Ask Fadko"/);
  assert.match(appShellHeader, /go\(`\$\{profilePath\}\?support=1`\)/);
  const assistant = read("components/support/SupportAssistantLauncher.tsx");
  assert.match(assistant, /automated support assistant/);
  assert.match(assistant, /Refunds and account restrictions always need human review/);
});

test("teacher credentials stay compact until the teacher asks to manage them", () => {
  assert.match(teacherProfile, /showDocuments &&/);
  assert.match(teacherProfile, /teacher-credentials-toggle/);
  assert.match(teacherProfile, /Identity & credentials/);
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
  assert.match(onboarding, /affiliationStatus === "affiliated" \|\| affiliationStatus === "not_specified"/);
});

test("long Nepal location lists open as bounded searchable selections", () => {
  assert.match(onboarding, /SearchableSelectionField label="Province/);
  assert.match(onboarding, /SearchableSelectionField label="District/);
  assert.match(onboarding, /disabled=\{!province\}/);
  assert.match(onboarding, /disabled=\{!district\}/);
  assert.match(selectionField, /<Modal/);
  assert.match(selectionField, /<FlatList/);
  assert.match(selectionField, /No match found/);
  assert.match(selectionField, /colors\.destructive/);
  assert.match(selectionField, /accessibilityRole="alert"/);
});

test("account validation stays beside one specific field instead of showing a generic popup", () => {
  assert.match(onboarding, /firstAccountDetailsIssue/);
  assert.match(onboarding, /testID="account-phone"/);
  assert.match(onboarding, /error=\{fieldError\?\.field === "phone"/);
  assert.match(onboarding, /\$\{testID\}-error/);
  assert.match(onboarding, /phoneRef\.current\?\.focus/);
  assert.doesNotMatch(onboarding, /phoneTouchedRef|inheritedSelection/);
  assert.match(onboarding, /accountDetailsNeedConfirmation/);
  assert.match(onboarding, /Please confirm your details/);
  assert.match(onboarding, /left your location and school unselected instead of guessing them/);
  assert.doesNotMatch(onboarding, /Phone, province, district, and municipality/);
});

test("a refund request explains the original-payment-method rule", () => {
  assert.match(support, /refund-original-payment-notice/);
  assert.match(support, /returned to the original payment method/);
  assert.match(support, /contact Support before the refund is processed/);
});
