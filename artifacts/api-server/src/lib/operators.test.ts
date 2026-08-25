import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ONE_TIME_PASSWORD_HOURS,
  checkLoginId,
  checkPassword,
  formatOneTimePassword,
  mayManageOperators,
  normaliseLoginId,
  oneTimePasswordBytes,
  oneTimePasswordExpired,
  signInGate,
} from "./operators.ts";

const HOUR = 60 * 60 * 1000;

test("an operator ID is the same person however it is typed", () => {
  assert.equal(normaliseLoginId("  Bina.Karki "), "bina.karki");
  assert.equal(normaliseLoginId("SUPPORT02"), "support02");
});

test("an ID somebody has to read down a phone line is kept plain", () => {
  assert.equal(checkLoginId("bina.karki").ok, true);
  assert.equal(checkLoginId("support_02").ok, true);
  assert.equal(checkLoginId("op-1").ok, true);

  // Spaces and symbols are where a read-aloud ID goes wrong.
  assert.equal(checkLoginId("bina karki").ok, false);
  assert.equal(checkLoginId("bina@sikshya.np").ok, false);
  assert.equal(checkLoginId("bina/karki").ok, false);
});

test("and cannot be empty, too short, or edged with punctuation", () => {
  assert.equal(checkLoginId("").ok, false);
  assert.equal(checkLoginId("ab").ok, false);
  assert.equal(checkLoginId("a".repeat(33)).ok, false);
  assert.equal(checkLoginId(".bina").ok, false);
  assert.equal(checkLoginId("bina.").ok, false);
  assert.equal(checkLoginId("_bina_").ok, false);
  // The boundary either side, so the length rule is a rule and not a coincidence.
  assert.equal(checkLoginId("abc").ok, true);
  assert.equal(checkLoginId("a".repeat(32)).ok, true);
});

test("a refused ID says what would be accepted", () => {
  const refused = checkLoginId("bina karki");
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /lowercase letters, numbers/i);
});

test("a password is judged on length, not on a character puzzle", () => {
  assert.equal(checkPassword("correct-horse-battery", "bina.karki").ok, true);
  // Ten characters of anything beats Password1! on every desk in the country.
  assert.equal(checkPassword("aaaaaaaaaa", "bina.karki").ok, true);
  assert.equal(checkPassword("short", "bina.karki").ok, false);
  assert.equal(checkPassword("", "bina.karki").ok, false);
});

test("and cannot simply be the operator's own ID", () => {
  const refused = checkPassword("Bina.Karki", "bina.karki");
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /cannot be your operator ID/i);
  // A password that merely contains the ID is still allowed — the rule is equality, and
  // pretending otherwise would refuse a perfectly good passphrase.
  assert.equal(checkPassword("bina.karki-rides-again", "bina.karki").ok, true);
});

test("a one-time password expires, because it travels by being said out loud", () => {
  const issued = Date.now();
  assert.equal(oneTimePasswordExpired(issued, issued + 1 * HOUR), false);
  assert.equal(oneTimePasswordExpired(issued, issued + (ONE_TIME_PASSWORD_HOURS - 1) * HOUR), false);
  assert.equal(oneTimePasswordExpired(issued, issued + (ONE_TIME_PASSWORD_HOURS + 1) * HOUR), true);
  // A date the database could not give us is treated as expired, never as fresh.
  assert.equal(oneTimePasswordExpired(Number.NaN), true);
});

test("a disabled operator is turned away before anything else is considered", () => {
  const gate = signInGate({
    disabledAt: new Date(),
    // Both other conditions are also wrong; the answer must still be about being switched off.
    mustChangePassword: true,
    createdAt: new Date(Date.now() - 100 * HOUR),
  });
  assert.equal(gate.allowed, false);
  if (!gate.allowed) {
    assert.equal(gate.code, "operator_disabled");
    assert.equal(gate.status, 403);
  }
});

test("an expired first-use password sends them to the administrator, not to a login loop", () => {
  const gate = signInGate({
    disabledAt: null,
    mustChangePassword: true,
    createdAt: new Date(Date.now() - (ONE_TIME_PASSWORD_HOURS + 2) * HOUR),
  });
  assert.equal(gate.allowed, false);
  if (!gate.allowed) {
    assert.equal(gate.code, "one_time_password_expired");
    assert.match(gate.reason, /administrator/i);
  }
});

test("an operator who has already chosen a password is not caught by that expiry", () => {
  // The account is a year old. Expiry is about the *one-time* password, not about the account.
  const gate = signInGate({
    disabledAt: null,
    mustChangePassword: false,
    createdAt: new Date(Date.now() - 365 * 24 * HOUR),
  });
  assert.equal(gate.allowed, true);
});

test("a fresh operator with an unused one-time password may sign in", () => {
  const gate = signInGate({ disabledAt: null, mustChangePassword: true, createdAt: new Date() });
  assert.equal(gate.allowed, true);
});

test("a spoken password avoids every character that sounds or looks like another", () => {
  // Every byte value, so no reachable index maps to an ambiguous character.
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) all[i] = i;
  for (let start = 0; start < 244; start += 1) {
    const code = formatOneTimePassword(all.slice(start), 3, 4);
    assert.doesNotMatch(code, /[O0Il1S5]/, `ambiguous character from byte ${start}: ${code}`);
  }
});

test("and is grouped so it can be read back without losing your place", () => {
  const code = formatOneTimePassword(new Uint8Array(oneTimePasswordBytes()));
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(oneTimePasswordBytes(3, 4), 12);
});

test("only a live administrator may hand out operator IDs", () => {
  assert.equal(mayManageOperators({ isAdministrator: true, disabledAt: null }), true);
  assert.equal(mayManageOperators({ isAdministrator: false, disabledAt: null }), false);
  // Switched off outranks the flag: an administrator whose own account was withdrawn must not
  // be able to issue themselves a fresh one on the way out.
  assert.equal(mayManageOperators({ isAdministrator: true, disabledAt: new Date() }), false);
});
