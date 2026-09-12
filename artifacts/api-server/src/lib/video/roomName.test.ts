import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { roomNameForSession, sessionIdForRoom, videoRoomPrefix } from "./roomName.ts";

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

    This is only a structural guard against duplicating the shared naming rule again.
    dailyIsolation.test.ts additionally bundles and executes the actual Daily code with a
    recording HTTP boundary, checking names in room creation, tokens and evidence correlation.
  */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const daily = fs.readFileSync(path.resolve(here, "..", "daily.ts"), "utf8");
  const rule = /export function sanitizeRoomName\(rawId: string\): string \{\s*return roomNameForSession\(rawId\);\s*\}/;
  assert.match(
    daily,
    rule,
    "sanitizeRoomName in lib/daily.ts no longer matches roomNameForSession — update lib/video/roomName.ts to agree",
  );
});

test("preview rooms and their evidence cannot cross database boundaries", () => {
  const preview = roomNameForSession(42, "fadko-preview");
  assert.equal(preview, "fadko-preview-sikshya42");
  assert.equal(sessionIdForRoom(preview, "fadko-preview"), 42);
  assert.equal(sessionIdForRoom(preview, ""), null);
  assert.equal(sessionIdForRoom("sikshya42", "fadko-preview"), null);
  assert.equal(sessionIdForRoom(preview, "other-preview"), null);
  for (const bad of ["fadko-preview-sikshya042", "fadko-preview-sikshya0", "fadko-preview-sikshya42x", "fadko-preview-sikshya9007199254740992"])
    assert.equal(sessionIdForRoom(bad, "fadko-preview"), null);
});

test("invalid namespaces refuse instead of silently using production", () => {
  for (const bad of [" ", "Preview", "../../prod", "a", "x".repeat(33), "a.b", "a_b"])
    assert.throws(() => videoRoomPrefix(bad), /Invalid video room namespace/);
  assert.equal(videoRoomPrefix(""), "sikshya");
});
