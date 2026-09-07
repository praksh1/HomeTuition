import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFloorRequest, readFloorMessage, type FloorContext, type FloorRequest } from "./floorProtocol.ts";
import { emptyFloor, mediaStateOf, type Floor } from "./speakingFloor.ts";
import { studentView, teacherView } from "./floorView.ts";

/**
 * The rules a hand-edited client would go looking for.
 *
 * `speakingFloor.test.ts` proves the classroom's rules are right. This file proves they cannot be
 * reached around: that a student cannot send a teacher's message, that a teacher cannot invent a
 * participant, that a frame missing a field is refused rather than half-applied, and that nothing
 * at all works after the class is over.
 *
 * Every test here is one that would otherwise be checked by opening two browsers and trying it.
 */

const NOW = 1_700_000_000_000;
const TEACHER = 1, STUDENT = 11, OTHER = 22, STRANGER = 999;

/** A room that knows two students and one teacher. */
function ctx(over: Partial<FloorContext> = {}): FloorContext {
  return {
    actorId: STUDENT,
    isTeacher: false,
    now: NOW,
    pastCutoff: false,
    window: { open: true },
    isStudent: (id) => id === STUDENT || id === OTHER,
    inRoom: (id) => id === STUDENT || id === OTHER || id === TEACHER,
    ...over,
  };
}
const asTeacher = (over: Partial<FloorContext> = {}) => ctx({ actorId: TEACHER, isTeacher: true, ...over });

function room(eligible = false): Floor {
  return emptyFloor(eligible);
}

/** Apply and insist it worked, returning the effects. */
function did(floor: Floor, request: FloorRequest, c: FloorContext) {
  const out = applyFloorRequest(floor, request, c);
  assert.ok(out.ok, `expected success, got ${out.ok === false ? out.code : ""}`);
  return out;
}
/** Apply and insist it was refused, returning the code. */
function refused(floor: Floor, request: FloorRequest, c: FloorContext): string {
  const out = applyFloorRequest(floor, request, c);
  assert.equal(out.ok, false, "expected a refusal");
  return out.ok === false ? out.code : "";
}

/* --- reading a frame ------------------------------------------------------ */

test("anything outside the floor namespace is left for the board to handle", () => {
  for (const type of ["chat", "scene_update", "board_clear", "presence", ""]) {
    assert.equal(readFloorMessage({ type }).kind, "other", type);
  }
});

test("a floor message this build does not know is a refusal, not a silence", () => {
  const parsed = readFloorMessage({ type: "floor_launch_rockets" });
  assert.equal(parsed.kind, "malformed");
  assert.equal(parsed.kind === "malformed" && parsed.code, "unknown-action");
});

test("a teacher action with no student named is refused before it can reach the floor", () => {
  for (const type of ["floor_mute", "floor_dismiss", "floor_stop_camera", "floor_return_audience", "floor_cancel_invite"]) {
    const parsed = readFloorMessage({ type });
    assert.equal(parsed.kind, "malformed", type);
    assert.equal(parsed.kind === "malformed" && parsed.code, "bad-user", type);
  }
});

test("a user id that is not a whole positive number is not a user id", () => {
  for (const userId of [0, -3, 1.5, "11", null, {}, Number.NaN, 1e21]) {
    const parsed = readFloorMessage({ type: "floor_mute", userId });
    assert.equal(parsed.kind, "malformed", JSON.stringify(userId));
  }
});

test("a scope outside the two the classroom has is refused", () => {
  for (const scope of ["camera", "everything", "", 1, undefined]) {
    assert.equal(readFloorMessage({ type: "floor_accept", scope }).kind, "malformed", String(scope));
    assert.equal(readFloorMessage({ type: "floor_join_discussion", scope }).kind, "malformed", String(scope));
  }
  assert.equal(readFloorMessage({ type: "floor_accept", scope: "mic" }).kind, "request");
  assert.equal(readFloorMessage({ type: "floor_accept", scope: "mic+camera" }).kind, "request");
});

test("replace is only true when it is literally true", () => {
  const parse = (replace: unknown) => {
    const p = readFloorMessage({ type: "floor_allow", userId: STUDENT, scope: "mic+camera", replace });
    assert.equal(p.kind, "request");
    return p.kind === "request" && p.request.action === "allow" ? p.request.replace : null;
  };
  assert.equal(parse(true), true);
  // Taking a child's camera away mid-sentence must take the word `true`, not a truthy string.
  for (const sloppy of ["true", 1, "yes", {}]) assert.equal(parse(sloppy), false, String(sloppy));
});

test("clearing the spotlight is expressible, because it is the only way back to the grid", () => {
  for (const userId of [null, undefined]) {
    const p = readFloorMessage({ type: "floor_spotlight", userId });
    assert.equal(p.kind, "request");
    assert.equal(p.kind === "request" && p.request.action === "spotlight" && p.request.userId, null);
  }
});

/* --- who may send what ---------------------------------------------------- */

test("a student cannot send a teacher's message, whatever their client says", () => {
  const f = room();
  const teacherOnly: FloorRequest[] = [
    { action: "allow", userId: OTHER, scope: "mic", replace: false },
    { action: "dismiss", userId: OTHER },
    { action: "cancel_invite", userId: OTHER },
    { action: "cancel_invites" },
    { action: "invite_all" },
    { action: "mute", userId: OTHER },
    { action: "mute_all" },
    { action: "stop_camera", userId: OTHER },
    { action: "return_audience", userId: OTHER },
    { action: "start_discussion" },
    { action: "end_discussion" },
    { action: "spotlight", userId: OTHER },
  ];
  for (const request of teacherOnly) {
    assert.equal(refused(f, request, ctx()), "not-yours", request.action);
  }
  assert.equal(f.students.size, 0, "and a refused action writes nothing at all");
});

test("a teacher does not ask to speak — they are already speaking", () => {
  const f = room();
  assert.equal(refused(f, { action: "ask" }, asTeacher()), "teacher-publishes");
  assert.equal(f.students.has(TEACHER), false, "and never gets a student row");
});

test("a teacher cannot moderate somebody who is not in the class", () => {
  const f = room();
  assert.equal(refused(f, { action: "mute", userId: STRANGER }, asTeacher()), "not-a-student");
  assert.equal(f.students.size, 0, "so a stranger never appears in the participant list");
});

test("a teacher cannot moderate themselves into the student list", () => {
  const f = room();
  assert.equal(refused(f, { action: "mute", userId: TEACHER }, asTeacher()), "not-a-student");
  assert.equal(f.students.has(TEACHER), false);
});

test("the refusal for a stranger and for the teacher is word for word the same", () => {
  const f = room();
  const stranger = applyFloorRequest(f, { action: "mute", userId: STRANGER }, asTeacher());
  const self = applyFloorRequest(f, { action: "mute", userId: TEACHER }, asTeacher());
  assert.equal(stranger.ok, false);
  assert.equal(self.ok, false);
  // Otherwise anybody with a socket could find out which account teaches a class by comparing them.
  assert.deepEqual(stranger, self);
});

test("the spotlight may name the teacher, who is in the room but not a student", () => {
  const f = room();
  did(f, { action: "spotlight", userId: TEACHER }, asTeacher());
  assert.equal(f.spotlight, TEACHER);
  assert.equal(refused(f, { action: "spotlight", userId: STRANGER }, asTeacher()), "not-here");
});

/* --- the class being over ------------------------------------------------- */

test("nothing works after the cutoff, for either role", () => {
  const f = room(true);
  const over = { pastCutoff: true };
  assert.equal(refused(f, { action: "ask" }, ctx(over)), "class-over");
  assert.equal(refused(f, { action: "allow", userId: STUDENT, scope: "mic", replace: false }, asTeacher(over)), "class-over");
  assert.equal(refused(f, { action: "start_discussion" }, asTeacher(over)), "class-over");
  assert.equal(refused(f, { action: "mute_all" }, asTeacher(over)), "class-over");
  assert.equal(f.students.size, 0);
});

/* --- the effects, which are derived rather than declared ------------------ */

test("asking to speak tells the room but grants the provider nothing", () => {
  const f = room();
  const out = did(f, { action: "ask" }, ctx());
  assert.deepEqual(out.touched, [STUDENT]);
  assert.deepEqual(out.push, [], "a raised hand is not a permission");
  assert.deepEqual(out.silence, []);
  assert.equal(out.roomChanged, false);
});

test("asking twice is not a second event, so nothing is re-broadcast", () => {
  const f = room();
  did(f, { action: "ask" }, ctx());
  const again = did(f, { action: "ask" }, ctx({ now: NOW + 4000 }));
  assert.deepEqual(again.touched, [], "an impatient second tap changes nothing and says nothing");
});

test("granting a microphone pushes a permission and silences nobody", () => {
  const f = room();
  const out = did(f, { action: "allow", userId: STUDENT, scope: "mic", replace: false }, asTeacher());
  assert.deepEqual(out.push, [STUDENT]);
  assert.deepEqual(out.silence, []);
});

test("accepting changes what everyone sees and nothing the provider is told", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic", replace: false }, asTeacher());
  const out = did(f, { action: "accept", scope: "mic" }, ctx());
  assert.deepEqual(out.touched, [STUDENT]);
  assert.deepEqual(out.push, [], "the permission was already pushed when it was granted");
});

test("a mute both revokes and cuts off, because revoking does not close an open microphone", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic", replace: false }, asTeacher());
  did(f, { action: "accept", scope: "mic" }, ctx());
  const out = did(f, { action: "mute", userId: STUDENT }, asTeacher());
  assert.deepEqual(out.push, [STUDENT], "the right to speak again is withdrawn");
  assert.deepEqual(out.silence, [STUDENT], "and the track that is open right now is stopped");
});

test("a student stepping back to listening is cut off too, not merely believed", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic", replace: false }, asTeacher());
  did(f, { action: "accept", scope: "mic" }, ctx());
  const out = did(f, { action: "listen_only" }, ctx());
  assert.deepEqual(out.silence, [STUDENT],
    "a client that says it stopped and did not would otherwise be heard while the teacher's screen said it was not");
});

test("stopping a camera does not stop a microphone", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic+camera", replace: false }, asTeacher());
  did(f, { action: "accept", scope: "mic+camera" }, ctx());
  const out = did(f, { action: "stop_camera", userId: STUDENT }, asTeacher());
  assert.deepEqual(out.push, [STUDENT]);
  assert.deepEqual(out.silence, [STUDENT]);
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "speaking", "still able to answer");
});

test("replacing the camera student reports both of them", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic+camera", replace: false }, asTeacher());
  did(f, { action: "accept", scope: "mic+camera" }, ctx());
  const out = did(f, { action: "allow", userId: OTHER, scope: "mic+camera", replace: true }, asTeacher());
  assert.deepEqual(out.push.sort(), [STUDENT, OTHER].sort());
  assert.deepEqual(out.silence, [STUDENT], "the student who lost it is cut off, the new one is not");
});

test("taking the camera without saying replace is refused, and changes nothing", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic+camera", replace: false }, asTeacher());
  assert.equal(
    refused(f, { action: "allow", userId: OTHER, scope: "mic+camera", replace: false }, asTeacher()),
    "camera-taken",
  );
  assert.equal(f.students.get(STUDENT)!.allowed.camera, true, "the first student keeps it");
});

test("mute all reaches everybody who could speak and nobody who could not", () => {
  const f = room();
  did(f, { action: "allow", userId: STUDENT, scope: "mic", replace: false }, asTeacher());
  did(f, { action: "accept", scope: "mic" }, ctx());
  did(f, { action: "ask" }, ctx({ actorId: OTHER }));
  const out = did(f, { action: "mute_all" }, asTeacher());
  assert.deepEqual(out.push, [STUDENT]);
  assert.deepEqual(out.silence, [STUDENT]);
  assert.equal(mediaStateOf(f.students.get(OTHER)!), "requested", "a raised hand is not a microphone");
});

test("the spotlight moves the layout and no permission at all", () => {
  const f = room();
  did(f, { action: "ask" }, ctx());
  const out = did(f, { action: "spotlight", userId: STUDENT }, asTeacher());
  assert.equal(out.roomChanged, true);
  assert.deepEqual(out.push, []);
  assert.deepEqual(out.silence, []);
});

/* --- discussion mode ------------------------------------------------------ */

test("a pay-as-you-go class is told it is not on the plan, never that it is too early", () => {
  const f = room(false);
  assert.equal(refused(f, { action: "start_discussion" }, asTeacher()), "not-monthly");
});

test("a monthly class outside the window is told to wait, which is true", () => {
  const f = room(true);
  const shut = asTeacher({ window: { open: false, code: "too-early", reason: "…", opensAt: NOW + 60_000 } });
  assert.equal(refused(f, { action: "start_discussion" }, shut), "too-early");
});

test("a student cannot join a discussion that was never opened", () => {
  const f = room(true);
  assert.equal(refused(f, { action: "join_discussion", scope: "mic" }, ctx()), "not-open");
  assert.equal(f.students.get(STUDENT)?.allowed.mic ?? false, false);
});

test("opening the discussion lets a student grant themselves a microphone, and only then", () => {
  const f = room(true);
  did(f, { action: "start_discussion" }, asTeacher());
  const out = did(f, { action: "join_discussion", scope: "mic+camera" }, ctx());
  assert.deepEqual(out.push, [STUDENT]);
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "allowed-not-accepted",
    "still nothing switched on until they accept on their own device");
});

test("more than one camera is allowed in a discussion and never in a classroom", () => {
  const f = room(true);
  did(f, { action: "start_discussion" }, asTeacher());
  did(f, { action: "join_discussion", scope: "mic+camera" }, ctx());
  did(f, { action: "join_discussion", scope: "mic+camera" }, ctx({ actorId: OTHER }));
  assert.equal(f.students.get(STUDENT)!.allowed.camera, true);
  assert.equal(f.students.get(OTHER)!.allowed.camera, true);
});

test("closing the discussion revokes and cuts off everybody it widened", () => {
  const f = room(true);
  did(f, { action: "start_discussion" }, asTeacher());
  did(f, { action: "join_discussion", scope: "mic+camera" }, ctx());
  did(f, { action: "accept", scope: "mic+camera" }, ctx());
  did(f, { action: "join_discussion", scope: "mic" }, ctx({ actorId: OTHER }));

  const out = did(f, { action: "end_discussion" }, asTeacher());
  assert.equal(out.roomChanged, true);
  assert.deepEqual(out.push.sort(), [STUDENT, OTHER].sort());
  assert.deepEqual(out.silence, [STUDENT], "only the one who actually had something open");
  assert.equal(f.mode, "classroom");
});

test("a student leaving a discussion gives up the permission, not just the track", () => {
  const f = room(true);
  did(f, { action: "start_discussion" }, asTeacher());
  did(f, { action: "join_discussion", scope: "mic" }, ctx());
  did(f, { action: "accept", scope: "mic" }, ctx());
  const out = did(f, { action: "leave_discussion" }, ctx());
  assert.deepEqual(out.push, [STUDENT]);
  assert.deepEqual(out.silence, [STUDENT]);
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "audience",
    "otherwise their microphone is one tap from live again with nothing granted");
});

/* --- what each side is told ----------------------------------------------- */

test("a student is never told anything about another student", () => {
  const f = room(true);
  did(f, { action: "ask" }, ctx({ actorId: OTHER }));
  did(f, { action: "allow", userId: OTHER, scope: "mic+camera", replace: false }, asTeacher());
  did(f, { action: "ask" }, ctx());

  const mine = studentView(f, STUDENT);
  const json = JSON.stringify(mine);
  assert.equal(json.includes(String(OTHER)), false, `another student's id leaked: ${json}`);
  assert.equal(mine.you.state, "requested");
  assert.equal(mine.handsUp, 1, "a count, with no names attached");
  assert.equal(mine.queuePosition, 1);
});

test("a student waiting behind somebody is told where they are, not who is ahead", () => {
  const f = room();
  did(f, { action: "ask" }, ctx({ actorId: OTHER }));
  did(f, { action: "ask" }, ctx({ now: NOW + 1000 }));
  const mine = studentView(f, STUDENT);
  assert.equal(mine.queuePosition, 2);
  assert.equal(mine.handsUp, 2);
});

test("a student who has done nothing gets an honest empty row rather than no answer", () => {
  const view = studentView(room(), STUDENT);
  assert.equal(view.you.state, "audience");
  assert.equal(view.queuePosition, null);
});

test("the teacher's view carries the queue in the server's own order", () => {
  const f = room();
  did(f, { action: "ask" }, ctx({ actorId: OTHER, now: NOW + 5000 }));
  did(f, { action: "ask" }, ctx({ now: NOW }));
  const view = teacherView(f, new Map([[STUDENT, "Sita"], [OTHER, "Ram"]]));
  assert.deepEqual(view.queue, [STUDENT, OTHER], "oldest first, by the server's clock");
  assert.deepEqual(view.students.map((r) => r.name).sort(), ["Ram", "Sita"]);
});

test("a student the room has no name for is still listed, rather than dropped", () => {
  const f = room();
  did(f, { action: "ask" }, ctx());
  const view = teacherView(f, new Map());
  assert.equal(view.students.length, 1);
  assert.equal(view.students[0]!.name, "Student");
});
