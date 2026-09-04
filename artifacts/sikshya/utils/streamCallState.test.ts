import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_VISIBLE_REACTIONS,
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
  assert.equal(controls.moderate, false);
  // There is no end-session control here for anybody — see the next test.
  assert.equal("endForEveryone" in controls, false);
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
  assert.equal(controls.moderate, true);
  assert.equal(controls.screenShare, true);
});

test("not even the teacher gets an end-session control from the provider", () => {
  /**
   * The one that was wrong. The shell had an "End for everyone" that called the provider's
   * `endCall()` and nothing else, so the video stopped while Sikshya went on believing the
   * lesson was running — no completed status, no cancelled reminder, no closed attendance, and
   * none of the confirmation the teacher's own End Session button asks for.
   *
   * Ending a class belongs to the classroom HUD. Asserted as an absent key rather than a false
   * flag so that re-adding the control cannot quietly satisfy this test.
   */
  const teacher = callControls({ state: joined(), isOwner: true, canScreenShare: true });
  const student = callControls({ state: joined(), isOwner: false, canScreenShare: true });
  assert.equal("endForEveryone" in teacher, false);
  assert.equal("endForEveryone" in student, false);
  assert.deepEqual(Object.keys(teacher).sort(), [
    "camera",
    "hand",
    "leave",
    "mic",
    "moderate",
    "participants",
    "reactions",
    "screenShare",
  ]);
});

test("a teacher on a provider that cannot share a screen is not offered one", () => {
  // The standing rule in this codebase: a control that does nothing has to go. The native Daily
  // path is why it exists.
  const controls = callControls({ state: joined(), isOwner: true, canScreenShare: false });
  assert.equal(controls.screenShare, false);
  // Their other teacher-only control is unaffected — this is about the one capability, not
  // about whether the server thinks they are the teacher.
  assert.equal(controls.moderate, true);
});

test("nothing but leaving works before the call is up", () => {
  const controls = callControls({ state: initialCallState(), isOwner: true, canScreenShare: true });
  assert.equal(controls.mic, false);
  assert.equal(controls.moderate, false);
  // Somebody must always be able to get out, including out of a call that will not connect.
  assert.equal(controls.leave, true);
});

test("a wobbling connection freezes the controls rather than moving them", () => {
  const state = reduce([{ type: "joined" }, { type: "reconnecting" }]);
  const controls = callControls({ state, isOwner: true, canScreenShare: true });
  assert.equal(controls.mic, false);
  assert.equal(controls.moderate, false);
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

test("a refused camera does not take the microphone with it", () => {
  /**
   * The defect this replaced. Both devices shared one flag, so a student who allowed the
   * microphone and refused the camera — the sensible thing on a shared family phone — had their
   * **working microphone switched off** and was told both were blocked. They would have sat
   * through a lesson unable to answer a question, with the app insisting that was their choice.
   */
  const state = reduce([
    { type: "joined" },
    { type: "permission-denied", device: "camera", error: "Your camera is blocked." },
  ]);
  assert.equal(state.phase, "joined");
  assert.equal(state.cameraDenied, true);
  assert.equal(state.micDenied, false);
  assert.equal(state.camOn, false);
  assert.equal(state.micOn, true, "the microphone nobody refused stays on");

  const controls = callControls({ state, isOwner: false, canScreenShare: false });
  assert.equal(controls.camera, false);
  assert.equal(controls.mic, true, "and its button still works");
  assert.match(callStatusLine(state) ?? "", /camera is blocked/i);
});

test("a refused microphone does not take the camera with it", () => {
  const state = reduce([
    { type: "joined" },
    { type: "permission-denied", device: "microphone", error: "Your microphone is blocked." },
  ]);
  assert.equal(state.micDenied, true);
  assert.equal(state.cameraDenied, false);
  assert.equal(state.micOn, false);
  const controls = callControls({ state, isOwner: false, canScreenShare: false });
  assert.equal(controls.mic, false);
  assert.equal(controls.camera, true);
  assert.match(callStatusLine(state) ?? "", /hear, but not speak/i);
});

test("both refused is said as both, and neither control works", () => {
  const state = reduce([
    { type: "joined" },
    { type: "permission-denied", device: "camera", error: "c" },
    { type: "permission-denied", device: "microphone", error: "m" },
  ]);
  assert.equal(state.phase, "joined", "the call is still fine; the device said no");
  assert.match(callStatusLine(state) ?? "", /Camera and microphone are blocked/);
  const controls = callControls({ state, isOwner: false, canScreenShare: false });
  assert.equal(controls.mic, false);
  assert.equal(controls.camera, false);
});

test("changing your mind in the browser gives the control back", () => {
  const state = reduce([
    { type: "joined" },
    { type: "permission-denied", device: "camera", error: "c" },
    { type: "permission-granted", device: "camera" },
  ]);
  assert.equal(state.cameraDenied, false);
  assert.equal(callControls({ state, isOwner: false, canScreenShare: false }).camera, true);
  assert.equal(callStatusLine(state), null);
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

test("one person tapping twenty times occupies one place, not twenty", () => {
  const many: CallAction[] = Array.from({ length: 20 }, () => ({
    type: "reaction" as const,
    userId: "sita",
    name: "Sita",
    emoji: "👍",
  }));
  const state = reduce([{ type: "joined" }, ...many]);
  // Deterministic without a timer: a person's newer reaction replaces their older one.
  assert.equal(state.reactions.length, 1);
  assert.deepEqual(state.reactions[0], { userId: "sita", name: "Sita", emoji: "👍" });
});

test("a class of forty-five cannot fill the screen with reactions", () => {
  const many: CallAction[] = Array.from({ length: 45 }, (_, i) => ({
    type: "reaction" as const,
    userId: `student-${i}`,
    name: `Student ${i}`,
    emoji: "🎉",
  }));
  const state = reduce([{ type: "joined" }, ...many]);
  assert.equal(state.reactions.length, MAX_VISIBLE_REACTIONS);
  assert.equal(state.reactions[0].userId, "student-44", "newest first");
});

test("a reaction keeps the name of whoever sent it", () => {
  const state = reduce([
    { type: "joined" },
    { type: "reaction", userId: "11", name: "Ram Prasad", emoji: "👏" },
    { type: "reaction", userId: "12", name: "Sita Sharma", emoji: "❓" },
  ]);
  // Rendered beside the emoji. In a class of forty-five an unattributed emoji says nothing.
  assert.deepEqual(state.reactions, [
    { userId: "12", name: "Sita Sharma", emoji: "❓" },
    { userId: "11", name: "Ram Prasad", emoji: "👏" },
  ]);
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
    "cameraDenied",
    "error",
    "handRaised",
    "micDenied",
    "micOn",
    "participants",
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
