import assert from "node:assert/strict";
import { test } from "node:test";
import type { FloorRow, StudentFloorView, TeacherFloorView } from "@/hooks/useClassroomSocket";
import {
  discussionControl,
  floorSummary,
  mediaChip,
  ordinal,
  studentOffer,
  teacherRowButtons,
} from "./classroomFloorUi.ts";

/**
 * What each person is offered, at every state the floor can be in.
 *
 * These are the branches that would otherwise be checked by putting two people in a live class and
 * trying things — which is how the wrong ones stay wrong. The one that matters most is the first:
 * an invitation reads as `allowed-not-accepted`, so a screen that switched on the state alone
 * would show "you can speak" to a child who has no idea their teacher just asked them a question.
 */

const NOW = 1_700_000_000_000;

function student(over: Partial<StudentFloorView["you"]> = {}, view: Partial<StudentFloorView> = {}): StudentFloorView {
  return {
    scope: "student",
    mode: "classroom",
    discussionEligible: false,
    discussionStartedAt: null,
    spotlight: null,
    handsUp: 0,
    queuePosition: null,
    ...view,
    you: {
      state: "audience",
      requestedAt: null,
      invitedAt: null,
      invitationScope: null,
      allowedMic: false,
      allowedCamera: false,
      acceptedMic: false,
      acceptedCamera: false,
      ...over,
    },
  };
}

function row(over: Partial<FloorRow> = {}): FloorRow {
  return {
    userId: 11,
    name: "Sita",
    state: "audience",
    requestedAt: null,
    invitedAt: null,
    invitationScope: null,
    connected: true,
    allowedMic: false,
    allowedCamera: false,
    ...over,
  };
}

function teacher(over: Partial<TeacherFloorView> = {}): TeacherFloorView {
  return {
    scope: "teacher",
    mode: "classroom",
    discussionEligible: false,
    discussionStartedAt: null,
    spotlight: null,
    students: [],
    queue: [],
    ...over,
  };
}

const ids = (bs: { id: string }[]) => bs.map((b) => b.id);

/* --- the student's own screen --------------------------------------------- */

test("a listening student is offered one thing: to put their hand up", () => {
  const offer = studentOffer(student());
  assert.deepEqual(ids(offer.buttons), ["ask"]);
  assert.equal(offer.title, null, "nothing has happened, so there is nothing to announce");
});

test("an invitation interrupts, and is not mistaken for a standing permission", () => {
  const offer = studentOffer(student({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true }));
  assert.equal(offer.urgent, true);
  assert.match(offer.title ?? "", /asked you to speak/);
  assert.deepEqual(ids(offer.buttons), ["accept-mic", "decline"]);
});

test("an invitation that carries a camera offers the camera, and one that does not never mentions it", () => {
  const withCam = studentOffer(
    student({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true, allowedCamera: true }),
  );
  assert.deepEqual(ids(withCam.buttons), ["accept-mic", "accept-camera", "decline"]);
  const micOnly = studentOffer(student({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true }));
  assert.equal(JSON.stringify(micOnly).toLowerCase().includes("camera"), false);
});

test("a standing permission is offered calmly, and says nothing is on yet", () => {
  const offer = studentOffer(student({ state: "allowed-not-accepted", allowedMic: true }));
  assert.equal(offer.urgent, false, "nobody asked them anything — this is not an interruption");
  assert.match(offer.body ?? "", /Nothing is on until you tap/);
});

test("a student who was turned off is told who did it, and that they may ask again", () => {
  const offer = studentOffer(student({ state: "muted-by-teacher", allowedMic: true }));
  assert.equal(offer.urgent, true);
  assert.match(offer.title ?? "", /Your teacher turned your microphone off/);
  assert.match(offer.body ?? "", /hand up again/);
  assert.deepEqual(ids(offer.buttons), ["ask"]);
});

test("a speaking student can turn their camera off without giving up their turn", () => {
  const offer = studentOffer(
    student({ state: "camera-active", allowedMic: true, allowedCamera: true, acceptedMic: true, acceptedCamera: true }),
  );
  const camera = offer.buttons.find((b) => b.id === "camera");
  assert.deepEqual(camera?.intent, { do: "setCamera", on: false });
  assert.ok(offer.buttons.some((b) => b.id === "stop"), "and can still stop entirely");
});

test("a speaking student with no camera permission is not offered a camera button", () => {
  const offer = studentOffer(student({ state: "speaking", allowedMic: true, acceptedMic: true }));
  assert.deepEqual(ids(offer.buttons), ["stop"]);
});

test("stopping means different things in the two modes, and sends the right one", () => {
  const inClass = studentOffer(student({ state: "speaking", allowedMic: true, acceptedMic: true }));
  assert.deepEqual(inClass.buttons.find((b) => b.id === "stop")?.intent, { do: "listenOnly" });

  const inDiscussion = studentOffer(
    student({ state: "speaking", allowedMic: true, acceptedMic: true }, { mode: "discussion" }),
  );
  assert.deepEqual(inDiscussion.buttons.find((b) => b.id === "stop")?.intent, { do: "leaveDiscussion" },
    "otherwise their microphone stays one tap from live with nothing granted");
});

test("a waiting student is told where they are, and can put their hand down", () => {
  const first = studentOffer(student({ state: "requested", requestedAt: NOW }, { queuePosition: 1, handsUp: 3 }));
  assert.match(first.body ?? "", /You're next/);
  const third = studentOffer(student({ state: "requested", requestedAt: NOW }, { queuePosition: 3, handsUp: 3 }));
  assert.match(third.body ?? "", /3rd in line/);
  assert.deepEqual(ids(third.buttons), ["cancel"]);
});

test("an open discussion offers three ways in, and listening is one of them", () => {
  const offer = studentOffer(student({}, { mode: "discussion", discussionEligible: true }));
  assert.deepEqual(ids(offer.buttons), ["discussion-mic", "discussion-camera", "discussion-listen"]);
  assert.match(offer.body ?? "", /carry on listening/);
});

test("a pay-as-you-go student is never shown a discussion they cannot have", () => {
  const offer = studentOffer(student({}, { discussionEligible: false }));
  assert.equal(JSON.stringify(offer).toLowerCase().includes("discussion"), false);
});

test("ordinals are right past ten, because a monthly class holds forty-five", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  // The three every implementation gets wrong first.
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(13), "13th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(22), "22nd");
  assert.equal(ordinal(23), "23rd");
  assert.equal(ordinal(42), "42nd");
  assert.equal(ordinal(45), "45th");
});

/* --- the labels ----------------------------------------------------------- */

test("the nine states each read differently, and never as one another", () => {
  const mine = [
    "audience", "requested", "invited", "allowed-not-accepted", "speaking",
    "camera-active", "muted-by-self", "muted-by-teacher", "disconnected",
  ] as const;
  const labels = mine.map((s) => mediaChip(s, true).label);
  assert.equal(new Set(labels).size, labels.length, `two states read the same: ${labels.join(" | ")}`);
});

test("being turned off by a teacher never reads the same as muting yourself", () => {
  assert.notEqual(mediaChip("muted-by-teacher", true).label, mediaChip("muted-by-self", true).label);
  assert.equal(mediaChip("muted-by-teacher", true).tone, "stopped");
});

test("a teacher's list and your own screen use different words for the same state", () => {
  assert.notEqual(mediaChip("speaking", true).label, mediaChip("speaking", false).label);
});

/* --- the teacher's list --------------------------------------------------- */

test("a raised hand offers the three answers a teacher actually has", () => {
  const view = teacher({ students: [row({ state: "requested", requestedAt: NOW })], queue: [11] });
  assert.deepEqual(ids(teacherRowButtons(view.students[0]!, view)), ["allow-mic", "allow-camera", "dismiss"]);
});

test("the camera button says it is taking somebody's camera away, before it does", () => {
  const holder = row({ userId: 22, name: "Ram", state: "camera-active", allowedMic: true, allowedCamera: true });
  const asking = row({ state: "requested", requestedAt: NOW });
  const view = teacher({ students: [holder, asking], queue: [11] });
  const button = teacherRowButtons(asking, view).find((b) => b.id === "allow-camera");
  assert.match(button?.label ?? "", /Take the camera/);
  assert.equal(button?.intent.do === "allow" && button.intent.replace, true);
});

test("in a discussion the camera is not one seat, so the button stops threatening to take it", () => {
  const holder = row({ userId: 22, name: "Ram", state: "camera-active", allowedMic: true, allowedCamera: true });
  const asking = row({ state: "requested", requestedAt: NOW });
  const view = teacher({ mode: "discussion", students: [holder, asking], queue: [11] });
  const button = teacherRowButtons(asking, view).find((b) => b.id === "allow-camera");
  assert.equal(button?.intent.do === "allow" && button.intent.replace, false);
});

test("a speaking student can be turned off, featured, or sent back", () => {
  const speaking = row({ state: "speaking", allowedMic: true });
  const view = teacher({ students: [speaking] });
  const buttons = ids(teacherRowButtons(speaking, view));
  assert.ok(buttons.includes("mute"));
  assert.ok(buttons.includes("spotlight"));
  assert.ok(buttons.includes("return"));
});

test("featuring somebody already featured offers to stop", () => {
  const speaking = row({ state: "speaking", allowedMic: true });
  const view = teacher({ students: [speaking], spotlight: 11 });
  assert.match(teacherRowButtons(speaking, view).find((b) => b.id === "spotlight")?.label ?? "", /Stop featuring/);
});

test("a student whose connection dropped is shown, and offered nothing", () => {
  const gone = row({ connected: false, state: "disconnected" });
  assert.deepEqual(teacherRowButtons(gone, teacher({ students: [gone] })), [],
    "a button that visibly does nothing teaches a teacher to distrust the whole panel");
});

test("an unanswered invitation can be withdrawn from that one person", () => {
  const invited = row({ state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true });
  assert.deepEqual(ids(teacherRowButtons(invited, teacher({ students: [invited] }))), ["cancel-invite"]);
});

test("a muted student can be let back in", () => {
  const muted = row({ state: "muted-by-teacher", allowedMic: true });
  const buttons = ids(teacherRowButtons(muted, teacher({ students: [muted] })));
  assert.ok(buttons.includes("allow-mic"));
});

test("the summary counts what a teacher glances at, and separates present from away", () => {
  const view = teacher({
    students: [
      row({ userId: 11, state: "speaking", allowedMic: true }),
      row({ userId: 22, state: "camera-active", allowedMic: true, allowedCamera: true }),
      row({ userId: 33, state: "requested", requestedAt: NOW }),
      row({ userId: 44, state: "allowed-not-accepted", invitedAt: NOW, allowedMic: true }),
      row({ userId: 55, state: "disconnected", connected: false }),
    ],
    queue: [33],
  });
  assert.deepEqual(floorSummary(view), {
    handsUp: 1, speaking: 1, onCamera: 1, waitingToAnswer: 1, connected: 4, away: 1,
  });
});

/* --- the discussion control ----------------------------------------------- */

test("a class with no discussion never draws the control at all", () => {
  assert.equal(discussionControl(teacher(), null, NOW).show, false,
    "a permanently greyed button is a promise the product does not keep");
});

test("before the window it is drawn, disabled, and says when", () => {
  const c = discussionControl(teacher({ discussionEligible: true }), NOW + 12 * 60_000, NOW);
  assert.equal(c.show, true);
  assert.equal(c.enabled, false);
  assert.match(c.hint ?? "", /Opens in 12 minutes/);
});

test("one minute out says minute, not minutes", () => {
  const c = discussionControl(teacher({ discussionEligible: true }), NOW + 40_000, NOW);
  assert.match(c.hint ?? "", /Opens in 1 minute\./);
});

test("inside the window it is live", () => {
  const c = discussionControl(teacher({ discussionEligible: true }), NOW - 60_000, NOW);
  assert.equal(c.enabled, true);
  assert.match(c.label, /Start discussion/);
});

test("once open it offers to end, and says what ending does", () => {
  const c = discussionControl(teacher({ discussionEligible: true, mode: "discussion" }), NOW - 60_000, NOW);
  assert.equal(c.ending, true);
  assert.match(c.label, /End discussion/);
  assert.match(c.hint ?? "", /back to listening/);
});
