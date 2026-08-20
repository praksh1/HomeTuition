import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PREFS, mergePrefs, readPrefs } from "./notificationPrefs.ts";

test("a user who has never set anything gets the defaults", () => {
  assert.deepEqual(readPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(undefined), DEFAULT_PREFS);
});

test("a half-written value does not read as wanting nothing", () => {
  // The regression this guards: a row holding only { push: { messages: false } } must not
  // silence followers and live-class alerts as a side effect.
  const prefs = readPrefs({ push: { messages: false } });
  assert.equal(prefs.push.messages, false);
  assert.equal(prefs.push.followers, true);
  assert.equal(prefs.push.sessionLive, true);
  assert.equal(prefs.email.messages, true);
});

test("junk in the column is ignored rather than trusted", () => {
  const prefs = readPrefs({ push: "yes", email: { messages: "true", followers: 1 } });
  assert.deepEqual(prefs, DEFAULT_PREFS);
});

test("an update changes only the switches it names", () => {
  const stored = { push: { messages: true, followers: true, sessionLive: true, reminders: true } };
  const merged = mergePrefs(stored, { push: { followers: false } });
  assert.equal(merged.push.followers, false);
  assert.equal(merged.push.messages, true);
  assert.equal(merged.push.sessionLive, true);
});

test("an older client cannot clear switches it has never heard of", () => {
  const stored = readPrefs({ email: { followers: true } });
  // A build that only knows about messages sends only messages.
  const merged = mergePrefs(stored, { email: { messages: false } });
  assert.equal(merged.email.messages, false);
  assert.equal(merged.email.followers, true, "a switch the client omitted must survive");
});

test("unknown channels and kinds are dropped, not written", () => {
  const merged = mergePrefs(DEFAULT_PREFS, {
    sms: { messages: true },
    push: { messages: false, somethingElse: true },
  });
  assert.equal(merged.push.messages, false);
  assert.equal("sms" in merged, false);
  assert.equal("somethingElse" in merged.push, false);
});

test("non-boolean values are rejected so the column stays clean", () => {
  const merged = mergePrefs(DEFAULT_PREFS, { push: { messages: "false", followers: 0 } });
  assert.equal(merged.push.messages, true, "a string is not a switch");
  assert.equal(merged.push.followers, true, "a number is not a switch");
});

test("every switch can be turned off explicitly", () => {
  const allOff = {
    push: { messages: false, followers: false, sessionLive: false, reminders: false },
    email: { messages: false, followers: false, sessionLive: false, reminders: false },
  };
  assert.deepEqual(mergePrefs(DEFAULT_PREFS, allOff), allOff);
});
