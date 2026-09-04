import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_REMEMBERED_REACTIONS,
  callControls,
  callReducer,
  callStatusLine,
  initialCallState,
  shouldRenderVideo,
  type CallAction,
  type CallState,
} from "./streamCallState.ts";

/**
 * The rules the call window runs on, checked without a call.
 *
 * Every one of these is something that would otherwise only be found out by two people with two
 * devices and a Stream account — and by then it would be found out by a teacher in front of a
 * class. Written as a reducer precisely so they can be found out here instead.
 */

function reduce(actions: CallAction[], from: CallState = initialCallState()): CallState {
  return actions.reduce(callReducer, from);
}

const joined = () => reduce([{ type: "joined" }]);

test("a call starts with the microphone on and the camera off", () => {
  const state = initialCallState();
  // Matching the server's call settings on purpose. Audio is the lesson; forty-five cameras
  // coming up unasked is forty-five upstreams on connections that cannot carry them.
  assert.equal(state.micOn, true);
  assert.equal(state.camOn, false);
  assert.equal(state.phase, "connecting");
});

test("a student is never shown a control they may not use", () => {
  const controls = callControls({ state: joined(), isOwner: false, canScreenShare: true });
  assert.equal(controls.endForEveryone, false);
  assert.equal(controls.moderate, false);
  // Presenting is the teacher's, the same as it is on Daily today.
  assert.equal(controls.screenShare, false);

  // Everything a student is entitled to is still there.
  assert.equal(controls.mic, true);
  assert.equal(controls.camera, true);
  assert.equal(controls.hand, true);
  assert.equal(controls.reactions, true);
  assert.equal(controls.participants, true);
  assert.equal(controls.leave, true);
});

test("the teacher gets the whole set", () => {
  const controls = callControls({ state: joined(), isOwner: true, canScreenShare: true });
  assert.equal(controls.endForEveryone, true);
  assert.equal(controls.moderate, true);
  assert.equal(controls.screenShare, true);
});

test("a teacher on a provider that cannot share a screen is not offered one", () => {
  // The standing rule in this codebase: a control that does nothing has to go. The native Daily
  // path is why it exists.
  const controls = callControls({ state: joined(), isOwner: true, canScreenShare: false });
  assert.equal(controls.screenShare, false);
  assert.equal(controls.endForEveryone, true);
});

test("nothing but leaving works before the call is up", () => {
  const controls = callControls({ state: initialCallState(), isOwner: true, canScreenShare: true });
  assert.equal(controls.mic, false);
  assert.equal(controls.endForEveryone, false);
  // Somebody must always be able to get out, including out of a call that will not connect.
  assert.equal(controls.leave, true);
});

test("a wobbling connection freezes the controls rather than moving them", () => {
  const state = reduce([{ type: "joined" }, { type: "reconnecting" }]);
  const controls = callControls({ state, isOwner: true, canScreenShare: true });
  assert.equal(controls.mic, false);
  assert.equal(controls.endForEveryone, false);
  assert.equal(controls.leave, true);
  // Still on screen, just not pressable — a bar that reflows every time the network dips is its
  // own small cruelty on a bus.
  assert.equal(controls.participants, true);
});

test("a failed call does not turn itself back into a hopeful one", () => {
  const state = reduce([
    { type: "failed", error: "Stream video is not built into this app." },
    { type: "reconnecting" },
  ]);
  assert.equal(state.phase, "failed");
  // The bug this guards is the shape the Daily web path already carries a flag for: a join that
  // never succeeded emitting an event the shell reads as something else.
  assert.equal(callStatusLine(state), "Stream video is not built into this app.");
});

test("a call that was left stays left", () => {
  const state = reduce([{ type: "joined" }, { type: "left" }, { type: "reconnecting" }]);
  assert.equal(state.phase, "left");
});

test("coming back from a wobble clears the wobble", () => {
  const state = reduce([{ type: "joined" }, { type: "reconnecting" }, { type: "rejoined" }]);
  assert.equal(state.phase, "joined");
  assert.equal(callStatusLine(state), null);
});

test("rejoining something that was not reconnecting changes nothing", () => {
  const failed = reduce([{ type: "failed", error: "no" }, { type: "rejoined" }]);
  assert.equal(failed.phase, "failed");
});

test("leaving puts down the screen share and the raised hand", () => {
  const state = reduce([
    { type: "joined" },
    { type: "screen-share", phase: "sharing" },
    { type: "hand", raised: true },
    { type: "left" },
  ]);
  assert.equal(state.screenShare, "idle");
  assert.equal(state.handRaised, false);
});

test("a refused camera is not a broken call", () => {
  const state = reduce([
    { type: "joined" },
    { type: "permission-denied", error: "Camera and microphone are blocked." },
  ]);
  // The device said no; the call is fine, and the person can still hear the lesson.
  assert.equal(state.phase, "joined");
  assert.equal(state.permissionDenied, true);
  assert.equal(state.micOn, false);
  assert.equal(state.camOn, false);

  const controls = callControls({ state, isOwner: false, canScreenShare: false });
  assert.equal(controls.mic, false);
  assert.equal(controls.camera, false);
  // And they are told why, rather than pressing a dead microphone button.
  assert.match(callStatusLine(state) ?? "", /blocked/i);
});

test("a working call says nothing at all", () => {
  // A permanent status bar over a video window on a phone is screen the whiteboard should have.
  assert.equal(callStatusLine(joined()), null);
});

test("every other state says something a person can read", () => {
  assert.equal(callStatusLine(initialCallState()), "Joining the class…");
  assert.match(callStatusLine(reduce([{ type: "reconnecting" }])) ?? "", /Connection lost/);
  assert.match(callStatusLine(reduce([{ type: "left" }])) ?? "", /left the call/);
  assert.equal(
    callStatusLine(reduce([{ type: "failed", error: "STREAM_API_KEY is not set." }])),
    "STREAM_API_KEY is not set.",
  );
});

test("reactions are remembered but not hoarded", () => {
  const many: CallAction[] = Array.from({ length: 20 }, (_, i) => ({
    type: "reaction" as const,
    id: String(i),
    participantId: "p",
    emoji: "👍",
  }));
  const state = reduce([{ type: "joined" }, ...many]);
  // Forty-five people in a class can send a lot of these, and an unbounded list on a cheap
  // Android is a memory leak with a smiley face on it.
  assert.equal(state.reactions.length, MAX_REMEMBERED_REACTIONS);
  assert.equal(state.reactions[0].id, "19", "newest first");
});

test("the window being hidden stops the video and nothing else", () => {
  assert.equal(shouldRenderVideo("hidden"), false);
  assert.equal(shouldRenderVideo("compact"), true);
  assert.equal(shouldRenderVideo("normal"), true);
  assert.equal(shouldRenderVideo("full"), true);
});

test("hiding and restoring the window does not touch the call's state", () => {
  /**
   * The requirement stated as a test: hidden/compact/normal/full is the classroom's business
   * and the call must survive all four without a rejoin. Nothing in `CallState` mentions the
   * window, which is the strongest form that guarantee can take — there is no field for a
   * resize to corrupt.
   */
  const live = reduce([
    { type: "joined" },
    { type: "mic", on: false },
    { type: "hand", raised: true },
    { type: "participants", participants: [] },
  ]);
  assert.deepEqual(Object.keys(live).sort(), [
    "camOn",
    "error",
    "handRaised",
    "micOn",
    "participants",
    "permissionDenied",
    "phase",
    "reactions",
    "screenShare",
  ]);
  assert.equal(live.phase, "joined");
  assert.equal(live.micOn, false);
  assert.equal(live.handRaised, true);
});

test("a screen share that is being started cannot be started twice", () => {
  const state = reduce([{ type: "joined" }, { type: "screen-share", phase: "starting" }]);
  assert.equal(state.screenShare, "starting");
  // The OS consent dialog is up. The button holds until the provider reports back.
});
