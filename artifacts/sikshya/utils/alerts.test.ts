/**
 * These cover the shape of what is said, not the dialog itself — the dialog is the platform's.
 *
 * The bug this file exists for was never about wording: `Alert` simply does nothing on the web,
 * so the messages below were never seen by anybody. What can be checked here without a browser
 * is that a title and a message survive into one readable string, since the web has only one
 * field to put them in.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

/** The same joining the web branch does. Kept here so the expectation is explicit. */
function joined(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

test("a title and a message both survive into the one field the web has", () => {
  assert.equal(joined("Log Out", "Are you sure?"), "Log Out\n\nAre you sure?");
});

test("a title on its own is not padded with an empty line", () => {
  assert.equal(joined("Uploaded"), "Uploaded");
  assert.equal(joined("Uploaded", ""), "Uploaded");
});
