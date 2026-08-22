import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, PREF_LABELS, PREF_ORDER } from "./notificationPrefs.ts";

/**
 * Every switch the app knows about must be shown, and every one shown must have words.
 *
 * These are not stylistic checks. A kind that exists but is missing from PREF_ORDER is a
 * notification nobody can turn off, and it fails silently — the server sends it, the settings
 * screen simply has no row for it, and the only person who finds out is the user being
 * notified. "New bookings" shipped that way for exactly one commit.
 */

const kinds = Object.keys(DEFAULT_PREFS.push);

test("every switch appears on the settings screen", () => {
  for (const kind of kinds) {
    assert.ok(PREF_ORDER.includes(kind as never), `${kind} has no row on the settings screen`);
  }
});

test("every switch on the screen has a label and an explanation", () => {
  for (const kind of PREF_ORDER) {
    const label = PREF_LABELS[kind];
    assert.ok(label, `${kind} has no wording`);
    assert.ok(label.title.length > 0, `${kind} has no title`);
    assert.ok(label.help.length > 0, `${kind} has no explanation`);
  }
});

test("the screen shows nothing that is not a real switch", () => {
  for (const kind of PREF_ORDER) {
    assert.ok(kinds.includes(kind), `${kind} is on the screen but is not a switch`);
  }
});

test("both channels carry the same set of switches", () => {
  // A kind present in push but not email would read as "off" for email and never be settable.
  assert.deepEqual(Object.keys(DEFAULT_PREFS.email).sort(), kinds.slice().sort());
});
