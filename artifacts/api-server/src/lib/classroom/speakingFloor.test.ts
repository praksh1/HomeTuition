import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptSpeaking,
  allowStudent,
  askToSpeak,
  cameraHolders,
  cancelInvitations,
  cancelRequest,
  declineInvitation,
  dismissRequest,
  emptyFloor,
  endDiscussion,
  endSession,
  inviteAllToSpeak,
  joinDiscussion,
  listenOnly,
  markDisconnected,
  markReconnected,
  mediaStateOf,
  muteAllStudents,
  muteStudent,
  publishRightsFor,
  requestQueue,
  returnToAudience,
  startDiscussion,
  stopStudentCamera,
  type Floor,
} from "./speakingFloor.ts";

/**
 * The classroom's authority rules.
 *
 * Every assertion here is one the product would otherwise depend on a browser to enforce, which
 * is the same as not enforcing it: a student who can edit their own client is exactly the person
 * these rules exist for. Keeping the decisions pure is what makes them checkable at all.
 *
 * The numbers in the names map to the pilot brief's numbered requirements so a reviewer can find
 * the one they care about without reading the file.
 */

const T = 1_000_000;                       // an arbitrary server timestamp
const STUDENT = 11, OTHER = 22, THIRD = 33;

/** A floor with two connected students and nothing granted. */
function floorWith(ids: number[], eligible = false): Floor {
  const f = emptyFloor(eligible);
  for (const id of ids) askToSpeak(f, id, T), cancelRequest(f, id);
  return f;
}
const ok = <T,>(r: { ok: true; value: T } | { ok: false; reason: string; code: string }): T => {
  assert.ok(r.ok, `expected success, got refusal: ${r.ok === false ? r.code : ""}`);
  return r.value;
};

/* --- 1, 2: nothing is granted by default --------------------------------- */

test("1+2: a student publishes neither microphone nor camera by default", () => {
  const f = floorWith([STUDENT]);
  const s = f.students.get(STUDENT)!;
  assert.deepEqual(s.allowed, { mic: false, camera: false });
  assert.deepEqual(publishRightsFor(s), { canPublish: false, mic: false, camera: false });
  assert.equal(mediaStateOf(s), "audience");
});

/* --- 3, 4, 5: one request, no duplicates, cancellable --------------------- */

test("3: a student can ask to speak", () => {
  const f = emptyFloor();
  ok(askToSpeak(f, STUDENT, T));
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "requested");
  assert.equal(requestQueue(f).length, 1);
});

test("4: tapping twice does not make two requests, and does not move them in the queue", () => {
  const f = emptyFloor();
  ok(askToSpeak(f, OTHER, T));
  ok(askToSpeak(f, STUDENT, T + 100));
  ok(askToSpeak(f, STUDENT, T + 5000));      // an impatient second tap
  const q = requestQueue(f);
  assert.equal(q.length, 2);
  assert.equal(q.filter((r) => r.userId === STUDENT).length, 1);
  // The original time is kept, so a second tap cannot jump the queue either.
  assert.equal(q[0]!.userId, OTHER);
  assert.equal(q[1]!.requestedAt, T + 100);
});

test("5: a student can cancel while waiting", () => {
  const f = emptyFloor();
  ok(askToSpeak(f, STUDENT, T));
  ok(cancelRequest(f, STUDENT));
  assert.equal(requestQueue(f).length, 0);
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "audience");
});

/* --- 6: the teacher decides ---------------------------------------------- */

test("6: a teacher can dismiss a request without granting anything", () => {
  const f = emptyFloor();
  ok(askToSpeak(f, STUDENT, T));
  ok(dismissRequest(f, STUDENT));
  assert.equal(requestQueue(f).length, 0);
  assert.equal(f.students.get(STUDENT)!.allowed.mic, false);
});

/* --- 8..11: permission is an offer, not an activation --------------------- */

test("8+9: granting a microphone does not open one — the student must accept", () => {
  const f = emptyFloor();
  ok(askToSpeak(f, STUDENT, T));
  ok(allowStudent(f, STUDENT, "mic", T + 1));
  const s = f.students.get(STUDENT)!;
  assert.equal(s.allowed.mic, true, "the server now permits it");
  assert.equal(s.accepted.mic, false, "but nothing is switched on");
  assert.equal(mediaStateOf(s), "allowed-not-accepted");

  ok(acceptSpeaking(f, STUDENT, { mic: true }));
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "speaking");
});

test("10+11: the same for a camera", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  assert.equal(f.students.get(STUDENT)!.accepted.camera, false);
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "camera-active");
});

test("a student cannot accept what was never granted", () => {
  const f = emptyFloor();
  const r = acceptSpeaking(f, STUDENT, { mic: true });
  assert.equal(r.ok, false);
  assert.equal(f.students.get(STUDENT)!.accepted.mic, false);
});

/* --- 12, 13: one camera in the ordinary classroom ------------------------- */

test("12: only one student may hold the camera in classroom mode", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  const second = allowStudent(f, OTHER, "mic+camera", T + 1);
  assert.equal(second.ok, false);
  assert.equal(second.ok === false && second.code, "camera-taken");
  assert.deepEqual(cameraHolders(f), [STUDENT]);
});

test("13: replacing the camera student takes an explicit action, and is never silent", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));

  const replaced = ok(allowStudent(f, OTHER, "mic+camera", T + 1, { replace: true }));
  assert.equal(replaced.replaced, STUDENT, "the teacher is told who lost the camera");
  assert.deepEqual(cameraHolders(f), [OTHER]);
  assert.equal(f.students.get(STUDENT)!.accepted.camera, false);
});

test("a microphone grant is not limited to one student", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic", T));
  ok(allowStudent(f, OTHER, "mic", T + 1));
  assert.equal(f.students.get(STUDENT)!.allowed.mic, true);
  assert.equal(f.students.get(OTHER)!.allowed.mic, true);
});

/* --- 14..16: per-student moderation -------------------------------------- */

test("14: muting one student stops their microphone and says who did it", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true }));
  ok(muteStudent(f, STUDENT));
  const s = f.students.get(STUDENT)!;
  assert.equal(mediaStateOf(s), "muted-by-teacher");
  assert.equal(publishRightsFor(s).mic, false);
});

test("15: stopping a camera leaves the microphone alone", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));
  ok(stopStudentCamera(f, STUDENT));
  const s = f.students.get(STUDENT)!;
  assert.equal(s.allowed.camera, false);
  assert.equal(s.allowed.mic, true, "still allowed to speak");
  assert.equal(mediaStateOf(s), "speaking");
});

test("16: returning a student to the audience withdraws everything", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));
  ok(returnToAudience(f, STUDENT));
  const s = f.students.get(STUDENT)!;
  assert.equal(mediaStateOf(s), "audience");
  assert.deepEqual(publishRightsFor(s), { canPublish: false, mic: false, camera: false });
});

/* --- 17: mute all ---------------------------------------------------------- */

test("17: mute all silences students, never the teacher, and disconnects nobody", () => {
  const f = emptyFloor();
  for (const id of [STUDENT, OTHER, THIRD]) {
    ok(allowStudent(f, id, "mic", T));
    ok(acceptSpeaking(f, id, { mic: true }));
  }
  const { affected } = ok(muteAllStudents(f));
  assert.equal(affected.length, 3, "the teacher is told how many were affected");

  for (const id of [STUDENT, OTHER, THIRD]) {
    const s = f.students.get(id)!;
    assert.equal(mediaStateOf(s), "muted-by-teacher");
    assert.equal(s.connected, true, "nobody was disconnected");
  }
  /*
    The teacher is not in `students` at all, which is why they cannot be muted here. Structural
    rather than a check somebody could forget to write.
  */
  assert.equal(f.students.has(0), false);
});

test("mute all leaves cameras running — it is a microphone control", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));
  ok(muteAllStudents(f));
  assert.equal(f.students.get(STUDENT)!.allowed.camera, true);
});

/* --- 18, 19: invite all is an offer -------------------------------------- */

test("18: invite all activates no microphone by itself", () => {
  const f = emptyFloor();
  for (const id of [STUDENT, OTHER]) markReconnected(f, id);
  const { invited } = ok(inviteAllToSpeak(f, T));
  assert.equal(invited.length, 2);
  for (const id of invited) {
    const s = f.students.get(id)!;
    assert.equal(s.accepted.mic, false, "nothing was switched on");
    assert.equal(mediaStateOf(s), "allowed-not-accepted");
  }
});

test("18: inviting twice does not notify the same student twice", () => {
  const f = emptyFloor();
  markReconnected(f, STUDENT);
  assert.equal(ok(inviteAllToSpeak(f, T)).invited.length, 1);
  assert.equal(ok(inviteAllToSpeak(f, T + 1)).invited.length, 0, "already holding an invitation");
});

test("19: declining changes no media state", () => {
  const f = emptyFloor();
  markReconnected(f, STUDENT);
  ok(inviteAllToSpeak(f, T));
  ok(declineInvitation(f, STUDENT));
  const s = f.students.get(STUDENT)!;
  assert.equal(s.accepted.mic, false);
  assert.equal(s.invitedAt, null);
});

test("cancelling invitations takes back what nobody accepted, and keeps what they did", () => {
  const f = emptyFloor();
  for (const id of [STUDENT, OTHER]) markReconnected(f, id);
  ok(inviteAllToSpeak(f, T));
  ok(acceptSpeaking(f, STUDENT, { mic: true }));      // one student said yes
  ok(cancelInvitations(f));
  assert.equal(f.students.get(STUDENT)!.allowed.mic, true, "an accepted invitation is not withdrawn");
  assert.equal(f.students.get(OTHER)!.allowed.mic, false, "an unanswered one is");
});

/* --- 20, 21: reconnection and session end -------------------------------- */

test("20: a revoked permission stays revoked after a reconnect", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic+camera", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));
  ok(returnToAudience(f, STUDENT));

  markDisconnected(f, STUDENT);
  const back = markReconnected(f, STUDENT);
  assert.deepEqual(publishRightsFor(back), { canPublish: false, mic: false, camera: false });
  // And a stale client acting on its old view is refused rather than restored.
  assert.equal(acceptSpeaking(f, STUDENT, { mic: true }).ok, false);
});

test("a disconnect stops live tracks but does not withdraw permission", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic", T));
  ok(acceptSpeaking(f, STUDENT, { mic: true }));
  markDisconnected(f, STUDENT);
  const s = f.students.get(STUDENT)!;
  assert.equal(s.accepted.mic, false, "the track is gone");
  assert.equal(s.allowed.mic, true, "the permission survives, so they can come back");
  assert.equal(mediaStateOf(s), "disconnected");
});

test("21: ending the session clears every request, invitation and permission", () => {
  const f = emptyFloor(true);
  ok(askToSpeak(f, STUDENT, T));
  ok(allowStudent(f, OTHER, "mic+camera", T));
  ok(startDiscussion(f, T, true));
  endSession(f);
  assert.equal(f.students.size, 0);
  assert.equal(f.mode, "classroom");
  assert.equal(f.discussionStartedAt, null);
});

/* --- 24, 25, 29, 30, 31: discussion mode --------------------------------- */

test("24: discussion opens only when the server confirmed the session is Monthly", () => {
  const eligible = emptyFloor(true);
  assert.equal(startDiscussion(eligible, T, true).ok, true);
});

test("25: a pay-as-you-go session can never open a discussion, even inside the window", () => {
  const payg = emptyFloor(false);
  const r = startDiscussion(payg, T, true);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "not-monthly");
  assert.equal(payg.mode, "classroom");
});

test("26: eligible but outside the window is refused, and says so differently", () => {
  const f = emptyFloor(true);
  const r = startDiscussion(f, T, false);
  assert.equal(r.ok, false);
  /*
    "Too early" and "not on this plan" must not collapse into one message. A teacher waits for
    the first and never gets the second — telling a pay-as-you-go teacher to wait is a lie they
    would act on.
  */
  assert.equal(r.ok === false && r.code, "too-early");
});

test("29+30: a discussion invites participation without switching anything on", () => {
  const f = emptyFloor(true);
  ok(startDiscussion(f, T, true));
  ok(joinDiscussion(f, STUDENT, "mic+camera"));
  const s = f.students.get(STUDENT)!;
  assert.equal(s.allowed.camera, true, "they may");
  assert.deepEqual(s.accepted, { mic: false, camera: false }, "but nothing is live yet");
  ok(acceptSpeaking(f, STUDENT, { mic: true }));
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "speaking");
});

test("a student cannot join a discussion that has not started", () => {
  const f = emptyFloor(true);
  const r = joinDiscussion(f, STUDENT, "mic");
  assert.equal(r.ok, false);
  assert.equal(f.students.get(STUDENT)?.allowed.mic ?? false, false);
});

test("31: ending the discussion revokes what it widened", () => {
  const f = emptyFloor(true);
  ok(startDiscussion(f, T, true));
  for (const id of [STUDENT, OTHER, THIRD]) {
    ok(joinDiscussion(f, id, "mic+camera"));
    ok(acceptSpeaking(f, id, { mic: true, camera: true }));
  }
  const { revoked } = ok(endDiscussion(f));
  assert.equal(revoked.length, 3);
  for (const id of [STUDENT, OTHER, THIRD]) {
    assert.deepEqual(publishRightsFor(f.students.get(id)!), { canPublish: false, mic: false, camera: false });
  }
  assert.equal(f.mode, "classroom");
});

test("many students may hold a camera in a discussion, unlike the classroom", () => {
  const f = emptyFloor(true);
  ok(startDiscussion(f, T, true));
  for (const id of [STUDENT, OTHER, THIRD]) ok(joinDiscussion(f, id, "mic+camera"));
  assert.equal(cameraHolders(f).length, 3);
});

test("the teacher keeps control during a discussion", () => {
  const f = emptyFloor(true);
  ok(startDiscussion(f, T, true));
  ok(joinDiscussion(f, STUDENT, "mic+camera"));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));

  ok(muteStudent(f, STUDENT));
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "muted-by-teacher");
  ok(stopStudentCamera(f, STUDENT));
  assert.equal(f.students.get(STUDENT)!.allowed.camera, false);
  ok(returnToAudience(f, STUDENT));
  assert.equal(mediaStateOf(f.students.get(STUDENT)!), "audience");
});

test("a student can step back to listening on their own", () => {
  const f = emptyFloor(true);
  ok(startDiscussion(f, T, true));
  ok(joinDiscussion(f, STUDENT, "mic+camera"));
  ok(acceptSpeaking(f, STUDENT, { mic: true, camera: true }));
  ok(listenOnly(f, STUDENT));
  const s = f.students.get(STUDENT)!;
  assert.deepEqual(s.accepted, { mic: false, camera: false });
  assert.equal(s.allowed.mic, true, "they may come back without asking again");
});

/* --- the label a person reads -------------------------------------------- */

test("the nine media states are distinguishable, so 'muted' never means three things", () => {
  const f = emptyFloor();
  const s = f.students.get(STUDENT) ?? (askToSpeak(f, STUDENT, T), f.students.get(STUDENT)!);

  assert.equal(mediaStateOf({ ...s, requestedAt: null }), "audience");
  assert.equal(mediaStateOf({ ...s, requestedAt: T }), "requested");
  assert.equal(mediaStateOf({ ...s, requestedAt: null, invitedAt: T }), "invited");
  assert.equal(mediaStateOf({ ...s, allowed: { mic: true, camera: false } }), "allowed-not-accepted");
  assert.equal(
    mediaStateOf({ ...s, allowed: { mic: true, camera: false }, accepted: { mic: true, camera: false } }),
    "speaking",
  );
  assert.equal(
    mediaStateOf({ ...s, allowed: { mic: true, camera: true }, accepted: { mic: true, camera: true } }),
    "camera-active",
  );
  assert.equal(mediaStateOf({ ...s, mutedByTeacher: true }), "muted-by-teacher");
  assert.equal(mediaStateOf({ ...s, connected: false }), "disconnected");
});

/* --- what the provider is told ------------------------------------------- */

test("the provider is only ever told what the floor granted", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic", T));
  const rights = publishRightsFor(f.students.get(STUDENT)!);
  assert.equal(rights.canPublish, true);
  assert.equal(rights.camera, false, "a microphone grant never carries a camera with it");
});

test("a teacher's mute reaches the provider, not just the screen", () => {
  const f = emptyFloor();
  ok(allowStudent(f, STUDENT, "mic", T));
  ok(muteStudent(f, STUDENT));
  assert.equal(publishRightsFor(f.students.get(STUDENT)!).mic, false);
});
