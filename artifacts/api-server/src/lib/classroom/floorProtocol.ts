/**
 * The wire, and the authority check on it.
 *
 * `speakingFloor.ts` decides what the classroom's rules are. This file decides who is allowed to
 * ask for them and what a frame off a socket is permitted to mean — the two questions the state
 * machine deliberately does not answer, because it takes `isTeacher` as an argument and trusts it.
 * Somebody has to earn that trust, and it is here.
 *
 * ## Why it is not inside the hub
 *
 * The same argument `speakingFloor.ts` makes for itself. Twenty-three actions, each with an
 * authority rule and a validation rule, buried inside a WebSocket handler are twenty-three rules
 * that can only be exercised by opening a socket — so nobody exercises them, and the one that is
 * wrong is the one a student finds. Here they are ordinary function calls, and
 * `floorProtocol.test.ts` runs every refusal path in a few milliseconds.
 *
 * ## Three rules that hold for every action
 *
 * **1. Identity is the socket's, never the payload's.** No action reads an actor from the message.
 * `ctx.actorId` comes from the authenticated upgrade, and a message carrying `userId` is naming
 * somebody a *teacher* is acting on — which is why every one of those goes through `ctx.isStudent`.
 *
 * **2. A subject must be somebody the room already knows.** `studentOf` in the state machine
 * creates a row on demand, which is right for a student who has just tapped something and wrong
 * for a teacher naming an arbitrary number: without this guard, `{"type":"floor_mute","userId":
 * 999999}` would put a stranger in the teacher's participant list forever.
 *
 * **3. Nothing works after the cutoff.** The class's hard stop is the same one the room route and
 * the join token already run on. A floor action accepted afterwards would be a microphone granted
 * in a class that is over.
 *
 * ## The effects are derived, not declared
 *
 * A table saying "mute silences, stop_camera silences, end_discussion silences everyone" is a
 * table that drifts from the state machine the first time somebody changes what an action does.
 * So the effects are worked out by *comparing the floor before and after*: whose publishing rights
 * changed, whose live track must therefore stop, whose row a viewer would now see differently.
 * Add an action to `speakingFloor.ts` and its effects come out right without editing this file.
 */
import {
  acceptSpeaking,
  allowStudent,
  askToSpeak,
  cancelInvitation,
  cancelInvitations,
  cancelRequest,
  declineInvitation,
  dismissRequest,
  endDiscussion,
  inviteAllToSpeak,
  joinDiscussion,
  listenOnly,
  mediaStateOf,
  muteAllStudents,
  muteStudent,
  publishRightsFor,
  returnToAudience,
  setSpotlight,
  startDiscussion,
  stopStudentCamera,
  type Floor,
  type InvitationScope,
  type Refusal,
  type StudentFloor,
} from "./speakingFloor.ts";
import type { WindowCheck } from "./discussionWindow.ts";

/** Every floor message starts with this, so nothing here can shadow an existing board message. */
export const FLOOR_PREFIX = "floor_";

/* ------------------------------------------------------------------------- */
/* What a client may ask for                                                  */
/* ------------------------------------------------------------------------- */

/**
 * The nine things a student may do to their own place in the class.
 *
 * `accept` and `join_discussion` each carry a scope, which is how nine message shapes cover the
 * ten behaviours the brief lists — accepting a microphone and accepting a camera are the same
 * consent with a different answer to "to what".
 */
export type StudentAction =
  | { action: "ask" }
  | { action: "cancel_ask" }
  | { action: "accept"; scope: InvitationScope }
  | { action: "decline" }
  | { action: "listen_only" }
  | { action: "join_discussion"; scope: InvitationScope }
  | { action: "leave_discussion" };

/**
 * The fourteen things this class's teacher may do to it.
 *
 * `allow` covers three of the brief's fifteen: accepting a raised hand with a microphone,
 * accepting it with a camera, and inviting somebody who never raised one. They are one operation
 * — "this student may now speak" — reached from two places in the interface, and giving them
 * separate wire messages would mean three code paths that have to stay in step about the camera
 * limit. `replace` is the fourth: taking the one camera slot from whoever holds it.
 */
export type TeacherAction =
  | { action: "allow"; userId: number; scope: InvitationScope; replace: boolean }
  | { action: "dismiss"; userId: number }
  | { action: "cancel_invite"; userId: number }
  | { action: "cancel_invites" }
  | { action: "invite_all" }
  | { action: "mute"; userId: number }
  | { action: "mute_all" }
  | { action: "stop_camera"; userId: number }
  | { action: "return_audience"; userId: number }
  | { action: "start_discussion" }
  | { action: "end_discussion" }
  | { action: "spotlight"; userId: number | null };

export type FloorRequest = StudentAction | TeacherAction;

/** Which actions only this class's teacher may send. Checked by membership, not by a claim. */
const TEACHER_ONLY = new Set<FloorRequest["action"]>([
  "allow",
  "dismiss",
  "cancel_invite",
  "cancel_invites",
  "invite_all",
  "mute",
  "mute_all",
  "stop_camera",
  "return_audience",
  "start_discussion",
  "end_discussion",
  "spotlight",
]);

/* ------------------------------------------------------------------------- */
/* Reading a frame                                                            */
/* ------------------------------------------------------------------------- */

/** A positive, whole, real account id — or nothing. Rejects `1.5`, `-3`, `1e21` and `"7"` alike. */
function userIdOf(raw: unknown): number | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

function scopeOf(raw: unknown): InvitationScope | null {
  return raw === "mic" || raw === "mic+camera" ? raw : null;
}

export type Parsed =
  /** Not a floor message. The hub's own switch should look at it. */
  | { kind: "other" }
  /** A floor message this build does not understand, or one whose fields are wrong. */
  | { kind: "malformed"; code: string; reason: string }
  | { kind: "request"; request: FloorRequest };

const malformed = (code: string, reason: string): Parsed => ({ kind: "malformed", code, reason });

/**
 * Turn a parsed JSON frame into a request, or say why not.
 *
 * A frame outside the `floor_` namespace is `other` and passes through untouched. One inside it
 * that does not parse is `malformed` rather than ignored: a client sending `floor_mute` with no
 * `userId` has a bug, and silence is how that bug reaches production. The distinction is kept to
 * the namespace so an older server never argues with a newer client about board messages.
 */
export function readFloorMessage(msg: Record<string, unknown>): Parsed {
  const type = typeof msg.type === "string" ? msg.type : "";
  if (!type.startsWith(FLOOR_PREFIX)) return { kind: "other" };
  const action = type.slice(FLOOR_PREFIX.length);

  const took = (request: FloorRequest): Parsed => ({ kind: "request", request });
  const noUser = malformed("bad-user", "That message named no student.");
  const noScope = malformed("bad-scope", "That message asked for nothing recognisable.");

  /*
    Written out one literal at a time rather than assembled from the string.

    `{ action } as FloorRequest` would be shorter and would compile whatever nonsense the switch
    let through, because the cast is doing the checking instead of the compiler. Spelled out like
    this, adding a member to `FloorRequest` without handling it here is a type error rather than a
    message that parses into a shape nothing can run.
  */
  switch (action) {
    case "ask": return took({ action: "ask" });
    case "cancel_ask": return took({ action: "cancel_ask" });
    case "decline": return took({ action: "decline" });
    case "listen_only": return took({ action: "listen_only" });
    case "leave_discussion": return took({ action: "leave_discussion" });
    case "cancel_invites": return took({ action: "cancel_invites" });
    case "invite_all": return took({ action: "invite_all" });
    case "mute_all": return took({ action: "mute_all" });
    case "start_discussion": return took({ action: "start_discussion" });
    case "end_discussion": return took({ action: "end_discussion" });

    case "accept": {
      const scope = scopeOf(msg.scope);
      return scope === null ? noScope : took({ action: "accept", scope });
    }
    case "join_discussion": {
      const scope = scopeOf(msg.scope);
      return scope === null ? noScope : took({ action: "join_discussion", scope });
    }

    case "allow": {
      const userId = userIdOf(msg.userId);
      if (userId === null) return noUser;
      const scope = scopeOf(msg.scope);
      if (scope === null) return noScope;
      return took({ action: "allow", userId, scope, replace: msg.replace === true });
    }

    case "dismiss":
    case "cancel_invite":
    case "mute":
    case "stop_camera":
    case "return_audience": {
      const userId = userIdOf(msg.userId);
      return userId === null ? noUser : took({ action, userId });
    }

    case "spotlight": {
      // Null is the whole grid, and is the only way back to it, so it has to be expressible.
      if (msg.userId === null || msg.userId === undefined) return took({ action: "spotlight", userId: null });
      const userId = userIdOf(msg.userId);
      return userId === null
        ? malformed("bad-user", "That message named nobody to feature.")
        : took({ action: "spotlight", userId });
    }

    default:
      return malformed("unknown-action", "This class does not know how to do that.");
  }
}

/* ------------------------------------------------------------------------- */
/* Applying one                                                               */
/* ------------------------------------------------------------------------- */

export interface FloorContext {
  /** From the authenticated socket. Never read from the message. */
  actorId: number;
  /** From `lib/membership.ts`, and specific to *this* class — not "holds a teacher account". */
  isTeacher: boolean;
  /** The server's clock. A queue ordered by device clocks is ordered by whose phone is wrong. */
  now: number;
  /** True once the class is past its hard cutoff, from the one timeline in `sessionStart.ts`. */
  pastCutoff: boolean;
  /** Whether the discussion window is open. Only `start_discussion` consults it. */
  window: WindowCheck;
  /** A student of this class the room knows about. Guards against invented roster rows. */
  isStudent(userId: number): boolean;
  /** Anybody the room knows about, this class's teacher included. Only the spotlight needs it. */
  inRoom(userId: number): boolean;
}

/** What happened, in the terms the caller has to act on. */
export interface FloorEffects {
  ok: true;
  /** Whose visible row changed. These people, and the teacher, need telling. */
  touched: number[];
  /** Whose publishing rights changed. Exactly these need pushing to the provider. */
  push: number[];
  /** Whose live track must stop *now*, because revoking a right does not close an open one. */
  silence: number[];
  /** The mode or the spotlight moved, so everybody's layout is affected rather than one row. */
  roomChanged: boolean;
  /** For the evidence log. `subjects` is empty for a room-level action. */
  note: { action: FloorRequest["action"]; actorId: number; subjects: number[] };
}

export type FloorOutcome = FloorEffects | Refusal;

const no = (code: string, reason: string): Refusal => ({ ok: false, code, reason });

/** Everything about one student that a change would be visible in. */
interface Snapshot {
  state: string;
  requestedAt: number | null;
  invitedAt: number | null;
  scope: InvitationScope | null;
  rights: ReturnType<typeof publishRightsFor>;
  /**
   * Whether a track is *actually open*, as against merely permitted.
   *
   * Both halves have to hold: the server allows it and the student switched it on. That is the
   * only thing worth cutting off, and telling them apart is what keeps `end_discussion` in a class
   * of forty from making forty provider calls to stop tracks that were never running.
   */
  liveMic: boolean;
  liveCamera: boolean;
}

function snap(s: StudentFloor): Snapshot {
  const rights = publishRightsFor(s);
  return {
    state: mediaStateOf(s),
    requestedAt: s.requestedAt,
    invitedAt: s.invitedAt,
    scope: s.invitationScope,
    rights,
    liveMic: rights.mic && s.accepted.mic,
    liveCamera: rights.camera && s.accepted.camera,
  };
}

function snapshotAll(floor: Floor, alsoInclude: number | null): Map<number, Snapshot> {
  const out = new Map<number, Snapshot>();
  for (const [id, s] of floor.students) out.set(id, snap(s));
  // A student the teacher is about to act on may have no row yet — a person who joined and has
  // done nothing. Without this their arrival looks like "no change" and nothing is broadcast.
  if (alsoInclude !== null && !out.has(alsoInclude)) {
    out.set(alsoInclude, {
      state: "audience",
      requestedAt: null,
      invitedAt: null,
      scope: null,
      rights: { canPublish: false, mic: false, camera: false },
      liveMic: false,
      liveCamera: false,
    });
  }
  return out;
}

/**
 * Authorise one request, run it, and work out what the world has to be told.
 *
 * Mutates `floor` on success and leaves it untouched on every refusal — which is the property
 * that makes a refused action safe to retry, and the reason the authority checks all happen
 * before the first call into the state machine.
 */
export function applyFloorRequest(floor: Floor, request: FloorRequest, ctx: FloorContext): FloorOutcome {
  /*
    The cutoff first, before anything else is even considered.

    Ten minutes past the booked finish nobody may reopen this class, so nobody may be granted a
    microphone in it either. Checked here rather than per action so a new action cannot be added
    without it.
  */
  if (ctx.pastCutoff) return no("class-over", "This class is over.");

  const teacherOnly = TEACHER_ONLY.has(request.action);
  if (teacherOnly && !ctx.isTeacher) {
    // Never says "you are not the teacher" as though the client had asked politely. A student
    // whose app sends this is either broken or hand-edited, and both get the same flat answer.
    return no("not-yours", "Only the teacher can do that.");
  }
  if (!teacherOnly && ctx.isTeacher) {
    /*
      The teacher publishes from their own token and is not in `students`.

      Refused rather than quietly ignored, because a teacher's screen offering "Ask to speak"
      would be a bug worth seeing rather than one worth absorbing.
    */
    return no("teacher-publishes", "You are already speaking — you do not need to ask.");
  }

  const subject = "userId" in request ? request.userId : null;
  if (subject !== null) {
    if (request.action === "spotlight") {
      if (!ctx.inRoom(subject)) return no("not-here", "That person is not in this class.");
    } else if (!ctx.isStudent(subject)) {
      /*
        One predicate, two failures it refuses, one answer it gives.

        `isStudent` is false both for an id nobody in this class has ever had and for the class's
        own teacher — the second because the teacher publishes from their token and must never get
        a row in `students`, which would be a contradictory second account of their microphone.
        Both come back as the same sentence on purpose: a distinct refusal for the teacher case
        would let anyone with a socket enumerate which account teaches a class.
      */
      return no("not-a-student", "That person is not a student in this class.");
    }
  }

  const before = snapshotAll(floor, subject);
  const modeBefore = floor.mode;
  const spotlightBefore = floor.spotlight;

  const outcome = run(floor, request, ctx);
  if (!outcome.ok) return outcome;

  const after = snapshotAll(floor, null);
  const touched: number[] = [];
  const push: number[] = [];
  const silence: number[] = [];

  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) {
      // A row that did not exist a moment ago. New to everybody, so everybody hears about it.
      touched.push(id);
      if (now.rights.canPublish) push.push(id);
      continue;
    }
    const rightsMoved =
      was.rights.canPublish !== now.rights.canPublish ||
      was.rights.mic !== now.rights.mic ||
      was.rights.camera !== now.rights.camera;
    const visiblyMoved =
      rightsMoved ||
      was.state !== now.state ||
      was.requestedAt !== now.requestedAt ||
      was.invitedAt !== now.invitedAt ||
      was.scope !== now.scope;

    if (visiblyMoved) touched.push(id);
    if (rightsMoved) push.push(id);
    /*
      Cut off exactly the people who had something open and no longer do.

      Necessary because revoking a permission stops somebody publishing *again* and does nothing at
      all to the microphone that is open right now — a teacher pressing mute means both. And it
      covers a student's own step back to listening, which is trusted to their client for what it
      costs them and never for what it costs everybody else: one that says "I have stopped" and has
      not is a student the class can still hear while the teacher's screen says it cannot.

      Deliberately *not* "anybody whose rights narrowed". Ending a discussion of forty revokes forty
      permissions, of which perhaps three were ever switched on; silencing the other thirty-seven
      would be thirty-seven provider round trips to stop tracks that never existed.
    */
    if ((was.liveMic && !now.liveMic) || (was.liveCamera && !now.liveCamera)) silence.push(id);
  }

  return {
    ok: true,
    touched,
    push,
    silence,
    roomChanged: floor.mode !== modeBefore || floor.spotlight !== spotlightBefore,
    note: {
      action: request.action,
      actorId: ctx.actorId,
      subjects: subject !== null ? [subject] : touched.slice(),
    },
  };
}

/** The dispatch itself. Every branch is one call into the pure state machine, and nothing else. */
function run(floor: Floor, request: FloorRequest, ctx: FloorContext): { ok: true } | Refusal {
  const me = ctx.actorId;
  switch (request.action) {
    /* --- the student's own place ----------------------------------------- */
    case "ask":
      return askToSpeak(floor, me, ctx.now);
    case "cancel_ask":
      return cancelRequest(floor, me);
    case "accept":
      return acceptSpeaking(
        floor,
        me,
        request.scope === "mic+camera" ? { mic: true, camera: true } : { mic: true },
      );
    case "decline":
      return declineInvitation(floor, me);
    case "listen_only":
      return listenOnly(floor, me);
    case "join_discussion":
      return joinDiscussion(floor, me, request.scope);
    case "leave_discussion":
      /*
        A student stepping out of a discussion gives up the permission, not just the track.

        `listenOnly` alone would leave them allowed and silent, which reads as "muted" on the
        teacher's screen and means their microphone is one tap from being live again without the
        teacher having granted anything. `returnToAudience` is a teacher's verb everywhere else in
        this file; used on yourself it only ever takes away, so there is nothing here to abuse.
      */
      return returnToAudience(floor, me);

    /* --- the teacher's authority ------------------------------------------ */
    case "allow":
      return allowStudent(floor, request.userId, request.scope, ctx.now, { replace: request.replace });
    case "dismiss":
      return dismissRequest(floor, request.userId);
    case "cancel_invite":
      return cancelInvitation(floor, request.userId);
    case "cancel_invites":
      return cancelInvitations(floor);
    case "invite_all":
      return inviteAllToSpeak(floor, ctx.now);
    case "mute":
      return muteStudent(floor, request.userId);
    case "mute_all":
      return muteAllStudents(floor);
    case "stop_camera":
      return stopStudentCamera(floor, request.userId);
    case "return_audience":
      return returnToAudience(floor, request.userId);
    case "start_discussion":
      /*
        Eligibility and timing are two separate refusals and stay that way all the way to the
        screen. "Not on this plan" is never, "not yet" is a wait, and a teacher told the wrong one
        acts on it — see `refusals-must-name-their-reason.md`. The state machine checks the plan;
        the window is passed in, because only the caller knows the class's clock.
      */
      return startDiscussion(floor, ctx.now, ctx.window.open);
    case "end_discussion":
      return endDiscussion(floor);
    case "spotlight":
      return setSpotlight(floor, request.userId);
  }
}
