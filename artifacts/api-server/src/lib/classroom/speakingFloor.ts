/**
 * Who may speak, who may be seen, and who decided — as one pure state machine.
 *
 * ## Why this is pure, and why that is the security design
 *
 * Every rule in this file is a rule about *authority*: a student must not be able to publish a
 * microphone because their client asked to, and a teacher's moderation must not depend on which
 * buttons a browser happens to render. Rules like that are worth nothing unless they are
 * exercised, and a rule that can only be exercised against a live LiveKit room and two browsers
 * is a rule nobody runs.
 *
 * So the decisions live here — no database, no network, no clock of its own — and the callers
 * do the effects. `lib/monthly.ts` is pure for the same reason and says so: what people are
 * charged, and what they are allowed, are the two things that must be testable directly.
 *
 * **The client is not the boundary.** Nothing here reads a role, a header or a flag that a
 * client could set. The caller passes `isTeacher`, and that comes from `lib/membership.ts` —
 * this server's single answer to "may this user be in this class?" — never from a request body.
 *
 * ## Permission is not activation
 *
 * The distinction the whole design rests on. A teacher granting a microphone does **not** turn
 * a microphone on: it moves the student to `allowed`, and the student's own device stays shut
 * until they accept. Two reasons, and the second is the one that matters:
 *
 * - A browser will not open a microphone without a user gesture anyway, so a design that
 *   assumed otherwise would be broken as well as rude.
 * - A teacher who can silently open a child's microphone is a surveillance feature. The owner
 *   asked for "invite all to speak", not "unmute everyone", and those are different products.
 *
 * ## The two modes
 *
 * **Classroom** is the default and the only mode a pay-as-you-go class ever has: the teacher
 * publishes, students ask, and at most one student may have a camera at a time.
 *
 * **Discussion** is a Monthly-plan benefit for the last twenty minutes. It widens who *may*
 * opt in — it never opts anybody in. Eligibility is decided by the server from the session's
 * own billing record; this file is only told the answer.
 */

/** What a student is allowed to publish. Granted by a teacher, never taken. */
export interface Allowance {
  mic: boolean;
  camera: boolean;
}

/** What a student has consented to actually switch on. Never set by a teacher. */
export interface Accepted {
  mic: boolean;
  camera: boolean;
}

export type InvitationScope = "mic" | "mic+camera";

export interface StudentFloor {
  /** Their ask-to-speak, if one is outstanding. One at a time, by construction. */
  requestedAt: number | null;
  /** An offer from the teacher awaiting this student's consent. */
  invitedAt: number | null;
  invitationScope: InvitationScope | null;
  /** What the server will permit them to publish. */
  allowed: Allowance;
  /** What they have agreed to switch on. Only ever moves on the student's own action. */
  accepted: Accepted;
  /** A teacher's mute. Distinct from the student muting themselves. */
  mutedByTeacher: boolean;
  /** Whether they are connected right now, as far as the hub knows. */
  connected: boolean;
}

export type Mode = "classroom" | "discussion";

export interface Floor {
  mode: Mode;
  /** Only ever true when the server has confirmed a valid Monthly entitlement. */
  discussionEligible: boolean;
  /** When discussion mode started, for the record. */
  discussionStartedAt: number | null;
  students: Map<number, StudentFloor>;
}

/**
 * What a person is shown about their own or somebody else's media.
 *
 * Nine states rather than a boolean, because "muted" covers three situations a student needs
 * told apart: they muted themselves, the teacher muted them, or they were never allowed to
 * speak in the first place. A single "muted" label makes the third look like the second, and a
 * student who thinks their teacher silenced them behaves differently from one who knows they
 * have not asked yet.
 */
export type MediaState =
  | "audience"
  | "requested"
  | "invited"
  | "allowed-not-accepted"
  | "speaking"
  | "camera-active"
  | "muted-by-self"
  | "muted-by-teacher"
  | "disconnected";

export function emptyStudent(): StudentFloor {
  return {
    requestedAt: null,
    invitedAt: null,
    invitationScope: null,
    allowed: { mic: false, camera: false },
    accepted: { mic: false, camera: false },
    mutedByTeacher: false,
    connected: true,
  };
}

export function emptyFloor(discussionEligible = false): Floor {
  return {
    mode: "classroom",
    discussionEligible,
    discussionStartedAt: null,
    students: new Map(),
  };
}

function studentOf(floor: Floor, userId: number): StudentFloor {
  let s = floor.students.get(userId);
  if (!s) {
    s = emptyStudent();
    floor.students.set(userId, s);
  }
  return s;
}

/**
 * The label for one student, worked out rather than stored.
 *
 * Derived on purpose: a stored label is a second source of truth that drifts from the
 * permissions it is supposed to describe, and the drift always shows up as a student being told
 * they are speaking while nobody can hear them.
 */
export function mediaStateOf(s: StudentFloor): MediaState {
  if (!s.connected) return "disconnected";
  if (s.mutedByTeacher) return "muted-by-teacher";
  if (s.accepted.camera && s.allowed.camera) return "camera-active";
  if (s.accepted.mic && s.allowed.mic) return "speaking";
  if (s.allowed.mic || s.allowed.camera) return "allowed-not-accepted";
  if (s.invitedAt !== null) return "invited";
  if (s.requestedAt !== null) return "requested";
  return "audience";
}

/** How many students hold camera permission right now. */
export function cameraHolders(floor: Floor): number[] {
  const out: number[] = [];
  for (const [id, s] of floor.students) if (s.allowed.camera) out.push(id);
  return out;
}

export type Refusal = { ok: false; reason: string; code: string };
export type Done<T> = { ok: true; value: T };
export type Result<T> = Done<T> | Refusal;

const no = (code: string, reason: string): Refusal => ({ ok: false, reason, code });
const yes = <T,>(value: T): Done<T> => ({ ok: true, value });

/* ------------------------------------------------------------------------- */
/* Student actions                                                            */
/* ------------------------------------------------------------------------- */

/**
 * "Ask to speak."
 *
 * Idempotent by design rather than by a guard in the UI. A student on a slow phone taps twice
 * and the second tap must not produce a second row in the teacher's queue — the teacher would
 * see the same name listed twice and have no way to tell whether that meant anything.
 *
 * The timestamp is the caller's — the server's clock — because a queue ordered by device clocks
 * is ordered by whose phone is wrong.
 */
export function askToSpeak(floor: Floor, userId: number, at: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  if (s.allowed.mic || s.allowed.camera) {
    return no("already-allowed", "You can already speak — your teacher has let you in.");
  }
  // Already asked: keep the original time so a second tap cannot jump the queue either.
  if (s.requestedAt !== null) return yes(s);
  s.requestedAt = at;
  return yes(s);
}

/** "Cancel request." Safe when there is nothing to cancel. */
export function cancelRequest(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.requestedAt = null;
  return yes(s);
}

/**
 * The student consents, and only now does anything switch on.
 *
 * Refused unless the server currently allows what is being accepted — the check that makes a
 * revoked permission stay revoked when a stale client tries to act on it after reconnecting.
 */
export function acceptSpeaking(
  floor: Floor,
  userId: number,
  want: Partial<Accepted>,
): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  if (want.mic && !s.allowed.mic) return no("not-allowed", "Your teacher has not let you speak yet.");
  if (want.camera && !s.allowed.camera) return no("not-allowed", "Your teacher has not allowed your camera.");
  if (want.mic !== undefined) s.accepted.mic = want.mic;
  if (want.camera !== undefined) s.accepted.camera = want.camera;
  // Accepting answers the invitation and the request both.
  s.invitedAt = null;
  s.invitationScope = null;
  s.requestedAt = null;
  return yes(s);
}

/** "Not now." Declining changes no media state at all — that is the whole point of it. */
export function declineInvitation(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.invitedAt = null;
  s.invitationScope = null;
  return yes(s);
}

/** The student steps back to listening. Their own choice, so it clears their acceptance only. */
export function listenOnly(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.accepted = { mic: false, camera: false };
  return yes(s);
}

/* ------------------------------------------------------------------------- */
/* Teacher actions                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Grant a student the floor.
 *
 * `replace` is required rather than assumed when somebody else already holds the only camera
 * slot. Silently taking a student's camera away to give it to another is the kind of thing that
 * happens to a child mid-sentence in front of forty people; the teacher has to mean it.
 */
export function allowStudent(
  floor: Floor,
  userId: number,
  scope: InvitationScope,
  at: number,
  opts: { replace?: boolean } = {},
): Result<{ student: StudentFloor; replaced: number | null }> {
  const s = studentOf(floor, userId);
  let replaced: number | null = null;

  if (scope === "mic+camera" && floor.mode === "classroom") {
    const holders = cameraHolders(floor).filter((id) => id !== userId);
    if (holders.length > 0) {
      if (!opts.replace) {
        return no(
          "camera-taken",
          "Another student has the camera. Replace them to give it to this student instead.",
        );
      }
      for (const id of holders) {
        const other = studentOf(floor, id);
        other.allowed.camera = false;
        other.accepted.camera = false;
      }
      replaced = holders[0]!;
    }
  }

  s.allowed.mic = true;
  s.allowed.camera = scope === "mic+camera";
  s.mutedByTeacher = false;
  s.requestedAt = null;
  // Granting is an offer; the student still has to accept before a device opens.
  s.invitedAt = at;
  s.invitationScope = scope;
  return yes({ student: s, replaced });
}

/** Dismiss a request without granting anything. */
export function dismissRequest(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.requestedAt = null;
  return yes(s);
}

/** Mute one student. Their permission survives; only the live track stops. */
export function muteStudent(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.mutedByTeacher = true;
  s.accepted.mic = false;
  return yes(s);
}

/** Stop one student's camera, leaving their microphone alone. */
export function stopStudentCamera(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.allowed.camera = false;
  s.accepted.camera = false;
  return yes(s);
}

/** Send a student back to listening: every permission withdrawn, nothing else disturbed. */
export function returnToAudience(floor: Floor, userId: number): Result<StudentFloor> {
  const s = studentOf(floor, userId);
  s.allowed = { mic: false, camera: false };
  s.accepted = { mic: false, camera: false };
  s.invitedAt = null;
  s.invitationScope = null;
  s.requestedAt = null;
  s.mutedByTeacher = false;
  return yes(s);
}

/**
 * Mute every student at once.
 *
 * Never the teacher — they are not in `students`, which is the structural reason rather than a
 * check somebody could forget. Cameras are untouched, nobody is disconnected, and the count
 * comes back so the teacher is told what actually happened rather than "done".
 */
export function muteAllStudents(floor: Floor): Result<{ affected: number[] }> {
  const affected: number[] = [];
  for (const [id, s] of floor.students) {
    if (s.accepted.mic || s.allowed.mic) {
      s.mutedByTeacher = true;
      s.accepted.mic = false;
      affected.push(id);
    }
  }
  return yes({ affected });
}

/**
 * Invite every connected student to speak — an offer, not an unmuting.
 *
 * Deliberately does not touch `allowed`: an invitation the student never answers must leave
 * them exactly where they were. Only `acceptSpeaking` opens anything, and it checks `allowed`
 * again at that moment.
 *
 * Re-inviting somebody who is already holding an invitation does not renotify them; a teacher
 * pressing the button twice must not make forty phones buzz twice.
 */
export function inviteAllToSpeak(floor: Floor, at: number): Result<{ invited: number[] }> {
  const invited: number[] = [];
  for (const [id, s] of floor.students) {
    if (!s.connected) continue;
    if (s.invitedAt !== null) continue;
    if (s.allowed.mic) continue;
    s.invitedAt = at;
    s.invitationScope = "mic";
    s.allowed.mic = true;
    s.mutedByTeacher = false;
    invited.push(id);
  }
  return yes({ invited });
}

/** Withdraw outstanding invitations nobody has answered. */
export function cancelInvitations(floor: Floor): Result<{ cancelled: number[] }> {
  const cancelled: number[] = [];
  for (const [id, s] of floor.students) {
    if (s.invitedAt === null) continue;
    s.invitedAt = null;
    s.invitationScope = null;
    // An unanswered invitation grants nothing once withdrawn.
    if (!s.accepted.mic) s.allowed.mic = false;
    cancelled.push(id);
  }
  return yes({ cancelled });
}

/* ------------------------------------------------------------------------- */
/* Discussion mode                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Open the discussion.
 *
 * Refuses on eligibility and on timing separately, so the reason given is the true one. A
 * pay-as-you-go class is not "too early" — it will never be eligible, and telling its teacher
 * to wait would be a lie they would act on.
 */
export function startDiscussion(
  floor: Floor,
  at: number,
  windowOpen: boolean,
): Result<Floor> {
  if (!floor.discussionEligible) {
    return no("not-monthly", "Discussion is part of the monthly plan.");
  }
  if (!windowOpen) {
    return no("too-early", "Discussion opens in the last twenty minutes of the class.");
  }
  if (floor.mode === "discussion") return yes(floor);
  floor.mode = "discussion";
  floor.discussionStartedAt = at;
  return yes(floor);
}

/**
 * Close the discussion, and take back what it widened.
 *
 * Everything granted during discussion is revoked; the class returns to one teacher and an
 * audience. Anyone still holding a track is unpublished by the caller acting on this — the
 * revocation is not advisory.
 */
export function endDiscussion(floor: Floor): Result<{ revoked: number[] }> {
  const revoked: number[] = [];
  if (floor.mode !== "discussion") return yes({ revoked });
  for (const [id, s] of floor.students) {
    if (s.allowed.mic || s.allowed.camera || s.accepted.mic || s.accepted.camera) {
      s.allowed = { mic: false, camera: false };
      s.accepted = { mic: false, camera: false };
      s.invitedAt = null;
      s.invitationScope = null;
      revoked.push(id);
    }
  }
  floor.mode = "classroom";
  floor.discussionStartedAt = null;
  return yes({ revoked });
}

/**
 * A student opting into the discussion.
 *
 * The one place a student may give themselves permission, and only because the teacher has
 * already opened a discussion in a session the server confirmed is Monthly. Still no device
 * opens: `accepted` stays false until they act on their own hardware.
 */
export function joinDiscussion(
  floor: Floor,
  userId: number,
  scope: InvitationScope,
): Result<StudentFloor> {
  if (floor.mode !== "discussion") {
    return no("not-open", "The teacher has not started a discussion.");
  }
  const s = studentOf(floor, userId);
  s.allowed.mic = true;
  s.allowed.camera = scope === "mic+camera";
  s.mutedByTeacher = false;
  s.requestedAt = null;
  s.invitedAt = null;
  s.invitationScope = null;
  return yes(s);
}

/* ------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* ------------------------------------------------------------------------- */

/** Somebody's socket dropped. Their permissions survive; their live tracks do not. */
export function markDisconnected(floor: Floor, userId: number): void {
  const s = studentOf(floor, userId);
  s.connected = false;
  s.accepted = { mic: false, camera: false };
}

/**
 * They are back.
 *
 * Their *permissions* are whatever the server still says they are — which is how a revoked
 * permission stays revoked across a reconnect, rather than a stale client restoring itself by
 * reconnecting with an old view of the world.
 */
export function markReconnected(floor: Floor, userId: number): StudentFloor {
  const s = studentOf(floor, userId);
  s.connected = true;
  return s;
}

/** The student left for good. */
export function removeStudent(floor: Floor, userId: number): void {
  floor.students.delete(userId);
}

/** The class ended. Every request, invitation and temporary permission goes with it. */
export function endSession(floor: Floor): void {
  floor.students.clear();
  floor.mode = "classroom";
  floor.discussionStartedAt = null;
}

/**
 * The queue a teacher sees: who asked, oldest first.
 *
 * Ordered by the server's own timestamp rather than arrival, so a message delayed on a bad
 * connection does not lose its owner their place.
 */
export function requestQueue(floor: Floor): Array<{ userId: number; requestedAt: number; state: MediaState; connected: boolean }> {
  const rows: Array<{ userId: number; requestedAt: number; state: MediaState; connected: boolean }> = [];
  for (const [userId, s] of floor.students) {
    if (s.requestedAt === null) continue;
    rows.push({ userId, requestedAt: s.requestedAt, state: mediaStateOf(s), connected: s.connected });
  }
  return rows.sort((a, b) => a.requestedAt - b.requestedAt);
}

/**
 * What the provider should be told this student may publish.
 *
 * The single translation from "what the classroom has decided" to "what LiveKit is told", so a
 * caller cannot invent a permission the floor never granted. Camera implies microphone;
 * there is no state in this file where a camera is allowed and a microphone is not.
 */
export function publishRightsFor(s: StudentFloor): { canPublish: boolean; camera: boolean; mic: boolean } {
  return {
    canPublish: s.allowed.mic || s.allowed.camera,
    mic: s.allowed.mic && !s.mutedByTeacher,
    camera: s.allowed.camera,
  };
}
