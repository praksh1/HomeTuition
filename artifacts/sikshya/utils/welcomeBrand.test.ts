import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve("app/welcome.tsx"), "utf8");

test("welcome keeps the approved Fadko message and artwork native", () => {
  assert.match(source, /<FadkoLogo \/>/);
  assert.match(source, /hero_fadko_live_learning\.jpg/);
  assert.match(source, /Live learning, built around you\./);
  assert.match(source, /Teach, learn and work together on one shared board\./);
  assert.doesNotMatch(source, /Already have an account/i);
});

test("each role keeps its established authentication route", () => {
  assert.match(source, /login\?role=teacher/);
  assert.match(source, /login\?role=student/);
  assert.match(source, /Opens sign in and sign up/);
});

test("the responsive welcome surface remains scrollable on a small phone", () => {
  assert.match(source, /<ScrollView/);
  assert.match(source, /maxWidth: readingWidth/);
  assert.match(source, /minHeight: HIT_SLOP_MIN/);
});
