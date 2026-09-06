import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { roomNameForSession } from "./roomName.ts";

test("a class's room is named for the class", () => {
  assert.equal(roomNameForSession(42), "sikshya42");
  assert.equal(roomNameForSession("42"), "sikshya42");
  assert.equal(roomNameForSession(1), "sikshya1");
});

test("anything that is not a letter or a digit is stripped", () => {
  assert.equal(roomNameForSession("4-2"), "sikshya42");
  assert.equal(roomNameForSession(" 42 "), "sikshya42");
});

test("the name is what the evidence parser expects to see", () => {
  /*
    `lib/sessionProof/providerEvents.ts` maps a provider room back to a class with
    `/^sikshya(\d+)$/`. A room named anything else correlates to no class, and the provider
    evidence for a refund would silently be about nothing.
  */
  for (const id of [1, 7, 42, 733, 999999]) {
    assert.match(roomNameForSession(id), /^sikshya\d+$/);
    assert.equal(roomNameForSession(id).slice("sikshya".length), String(id));
  }
});

test("LiveKit and Daily name the same class the same way", () => {
  /*
    Checked against the *source* of `lib/daily.ts` rather than by importing it.

    Two reasons. Daily is deliberately not being edited during this trial, so the rule could not
    be moved into a shared module without touching it. And `daily.ts` reaches for a logger and the
    network, so it cannot be imported under `--experimental-strip-types` at all.

    A source check is cruder than a behavioural one and it does the job that matters: if somebody
    changes Daily's rule, this fails and names the file, instead of one class quietly getting two
    different room names on two providers and its evidence trail going dark.
  */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const daily = fs.readFileSync(path.resolve(here, "..", "daily.ts"), "utf8");
  const rule = /return\s+"sikshya"\s*\+\s*\w+\.replace\(\/\[\^a-zA-Z0-9\]\/g,\s*""\);/;
  assert.match(
    daily,
    rule,
    "sanitizeRoomName in lib/daily.ts no longer matches roomNameForSession — update lib/video/roomName.ts to agree",
  );
});
