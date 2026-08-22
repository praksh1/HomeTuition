import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PREFS, PREF_KINDS, mergePrefs, readPrefs } from "./notificationPrefs.ts";

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
  // Built from PREF_KINDS rather than a list written out by hand. A hand-written list only
  // covers the switches somebody remembered on the day, and silently stops covering the next
  // one added — which is the opposite of what a test called "every switch" should do.
  const off = Object.fromEntries(PREF_KINDS.map((kind) => [kind, false]));
  const allOff = { push: { ...off }, email: { ...off } };
  assert.deepEqual(mergePrefs(DEFAULT_PREFS, allOff), allOff);
});

test("an older app that has never heard of a switch does not turn it off", () => {
  // The app on a phone is always behind the server. A build that sends only the switches it
  // knows about must leave the rest alone, or every new notification would arrive silenced for
  // anyone who had not updated.
  const merged = mergePrefs(DEFAULT_PREFS, { push: { messages: false } });
  assert.equal(merged.push.messages, false, "the switch it did send is honoured");
  for (const kind of PREF_KINDS) {
    if (kind === "messages") continue;
    assert.equal(merged.push[kind], DEFAULT_PREFS.push[kind], `${kind} was left alone`);
  }
});
