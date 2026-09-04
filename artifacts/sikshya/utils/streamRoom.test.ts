import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  STREAM_ROOM_URI_PREFIX,
  VISIBLE_PARTICIPANT_CAP,
  incomingVideoFor,
  parseStreamRoom,
  visibleParticipants,
} from "./streamRoom.ts";
import { neutralVideoWindowState } from "./callWindow.ts";

/**
 * The app's half of the Stream locator, and the two policies that decide the bill.
 *
 * Nothing here needs a Stream account, a phone or a network — which is the point. The decisions
 * that cost money or drain a battery are string arithmetic and a lookup table, and they are
 * worth pinning now rather than discovering on a bill.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.resolve(
  here,
  "..",
  "..",
  "api-server",
  "src",
  "lib",
  "video",
  "streamCall.ts",
);

test("the locator format matches the server's, letter for letter", () => {
  /**
   * The mirror check, the same way `timelineMirror.test.ts` does it.
   *
   * The two packages deliberately share no code, so this file is a copy of the server's parser.
   * A copy that drifts is the worst kind of bug here: the server hands out a locator the app
   * cannot read, the classroom says "couldn't set up the video room", and every test on each
   * side goes on passing. So this reads the server's source rather than trusting a comment.
   */
  const source = readFileSync(serverFile, "utf8");
  const match = source.match(/export const STREAM_ROOM_URI_PREFIX = "([^"]+)";/);
  assert.ok(match, `STREAM_ROOM_URI_PREFIX is not declared in ${serverFile} — was it renamed?`);
  assert.equal(STREAM_ROOM_URI_PREFIX, match[1]);
});

test("the app reads the exact string the server's own test says it produces", () => {
  // Pinned as a literal on both sides. The server asserts it builds this; this asserts it can
  // read it. Neither can move without the other going red.
  assert.deepEqual(parseStreamRoom("stream:call/default/sikshya-42?api_key=pubkey123"), {
    callType: "default",
    callId: "sikshya-42",
    apiKey: "pubkey123",
  });
});

test("anything that is not a locator is nothing, not half of one", () => {
  for (const bad of [
    "",
    null,
    undefined,
    "https://sikshya.daily.co/sikshya42",
    "stream:call/default/sikshya-42",
    "stream:call/default?api_key=k",
    "stream:call/a/b/c?api_key=k",
    "stream:call/default/sikshya-42?api_key=",
    // `decodeURIComponent` throws on these rather than returning anything, which is how a
    // documented "returns null" quietly became an exception.
    "stream:call/default/sikshya-42?api_key=%zz",
    "stream:call/default/sikshya-42?api_key=%",
    "stream:call/%E0%A4/sikshya-42?api_key=k",
    "stream:call/default/%?api_key=k",
  ]) {
    assert.equal(parseStreamRoom(bad as string), null, JSON.stringify(bad));
  }
});

test("a hidden window receives no video at all", () => {
  // The requirement, in one assertion: a call nobody can see should not be carrying anybody's
  // camera. On a phone that is battery and heat; on Stream's pricing it is money.
  assert.deepEqual(incomingVideoFor("hidden"), { enabled: false, resolution: null });
});

test("what is received grows with the window and stops at the call's own ceiling", () => {
  const compact = incomingVideoFor("compact");
  const normal = incomingVideoFor("normal");
  const full = incomingVideoFor("full");

  assert.ok(compact.enabled && normal.enabled && full.enabled);
  assert.ok(compact.resolution!.height < normal.resolution!.height);
  assert.ok(normal.resolution!.height < full.resolution!.height);
  // The server creates the call at 640×480. Asking for more than exists would cost the same and
  // deliver the same picture.
  assert.equal(full.resolution!.width, 640);
  assert.equal(full.resolution!.height, 480);
});

test("the number of rendered cameras is bounded, and hardest when the window is smallest", () => {
  // Forty-five decoded videos on a budget Android is a device that gets hot and drops the call.
  assert.equal(VISIBLE_PARTICIPANT_CAP.hidden, 0);
  assert.ok(VISIBLE_PARTICIPANT_CAP.compact < VISIBLE_PARTICIPANT_CAP.normal);
  assert.ok(VISIBLE_PARTICIPANT_CAP.normal < VISIBLE_PARTICIPANT_CAP.full);
  assert.ok(VISIBLE_PARTICIPANT_CAP.full <= 6);
});

const CLASS = [
  { id: "a", isLocal: true, isTeacher: false },
  { id: "b", isLocal: false, isTeacher: false },
  { id: "t", isLocal: false, isTeacher: true },
  { id: "c", isLocal: false, isTeacher: false },
  { id: "d", isLocal: false, isTeacher: false },
  { id: "e", isLocal: false, isTeacher: false },
  { id: "f", isLocal: false, isTeacher: false },
  { id: "g", isLocal: false, isTeacher: false },
];

test("a class of forty-five never renders forty-five tiles", () => {
  const fortyFive = Array.from({ length: 45 }, (_, i) => ({
    id: String(i),
    isLocal: i === 0,
    isTeacher: i === 1,
  }));
  assert.equal(visibleParticipants(fortyFive, "full").length, VISIBLE_PARTICIPANT_CAP.full);
  assert.equal(visibleParticipants(fortyFive, "compact").length, VISIBLE_PARTICIPANT_CAP.compact);
  assert.equal(visibleParticipants(fortyFive, "hidden").length, 0);
});

test("the teacher is always one of the tiles that survives the cut", () => {
  // A student's reason for looking at the window at all is to see the teacher. Being ninth in
  // the list must not be what decides that.
  const shown = visibleParticipants(CLASS, "compact");
  assert.equal(shown.length, VISIBLE_PARTICIPANT_CAP.compact);
  assert.equal(shown[0].id, "t");
});

test("the order does not change when the list does", () => {
  const first = visibleParticipants(CLASS, "normal").map((p) => p.id);
  const second = visibleParticipants([...CLASS], "normal").map((p) => p.id);
  // A strip that reshuffles is a strip nobody can tap.
  assert.deepEqual(first, second);
});

test("the classroom's own window sizes map onto the neutral ones", () => {
  assert.equal(neutralVideoWindowState("hidden"), "hidden");
  assert.equal(neutralVideoWindowState("small"), "compact");
  assert.equal(neutralVideoWindowState("medium"), "normal");
  assert.equal(neutralVideoWindowState("full"), "full");
});
