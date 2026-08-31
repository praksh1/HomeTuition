import assert from "node:assert/strict";
import { test } from "node:test";

import { flaggedTerms } from "./moderationRules.ts";

test("ordinary English and Nepali profile text is not flagged", () => {
  assert.deepEqual(flaggedTerms("I teach mathematics at जनज्योति माध्यमिक विद्यालय."), []);
});

test("an English term is matched as a word rather than inside an innocent word", () => {
  assert.deepEqual(flaggedTerms("Classical studies"), []);
  assert.deepEqual(flaggedTerms("you are a slut"), ["slut"]);
});

test("common Devanagari abusive text is sent to review", () => {
  assert.ok(flaggedTerms("तँ मुजी होस्").includes("मुजी"));
});
