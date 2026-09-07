/**
 * The classroom floor, per live room — where the decisions meet the socket, the provider and the
 * record.
 *
 * Three files, three jobs, and keeping them apart is what makes any of it checkable:
 *
 * - `lib/classroom/speakingFloor.ts` — what the rules *are*. Pure; no clock, no database.
 * - `lib/classroom/floorProtocol.ts` — who may ask for them, and what a frame is allowed to mean.
 * - here — the state that has to live somewhere, and the four effects: tell the room, tell the
 *   provider, stop a track that is already open, write down what happened.
 *
 * ## Held in memory, and what that costs
 *
 * A room's floor lives in this process, exactly like the whiteboard next door, and a restart
 * loses it. The whiteboard has a stored copy because losing a lesson's diagrams is losing the
 * lesson; the floor deliberately has none, because everything it holds is about *this minute* —
 * who has their hand up, whose microphone is open. After a restart every client reconnects, every
 * student is an audience member again, and the teacher grants the floor afresh. Restoring stale
 * permissions from before a restart would be worse than starting clean: it would hand a microphone
 * to somebody whose turn had finished.
 *
 * What is *not* lost is the record. Grants, mutes and speaking time go to the activity log as they
 * happen, so the evidence for a refund argument survives what the live state does not.
 *
 * ## The provider has to be able to enforce it
 *
 * Every action is refused outright unless the configured provider can decide who publishes. On
 * Daily it cannot — everybody in a Prebuilt room may unmute themselves — so a raise-your-hand
 * button there would be asking permission for something the student already has, and a teacher's
 * mute would be a button that does nothing while looking as though it had. The app hides the
 * controls from the same capability; this is the half that holds when the app is lying.
 */
import { eq } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { recordActivity } from "../lib/activityLog";
import { videoProvider } from "../lib/video";
import { cutoffAt, type StartableSession } from "../lib/sessionStart.ts";
import { discussionWindow, type WindowCheck } from "../lib/classroom/discussionWindow.ts";
import { discussionModeEligible } from "../lib/classroom/discussionEligibility.ts";
import {
  applyFloorRequest,
  readFloorMessage,
  type FloorContext,
  type FloorEffects,
  type FloorRequest,
} from "../lib/classroom/floorProtocol.ts";
import {
  emptyFloor,
  endSession,
  markDisconnected,
  markReconnected,
  publishRightsFor,
  type Floor,
} from "../lib/classroom/speakingFloor.ts";
import { studentView, teacherView } from "../lib/classroom/floorView.ts";

/** One connected socket, as far as the floor is concerned. */
export interface FloorClient {
  userId: number;
  isSessionTeacher: boolean;
  send(msg: object): void;
}

/** How this module reaches the room it belongs to. Supplied by the hub, so this stays testable. */
export interface RoomPort {
  clients(): FloorClient[];
}

interface RoomFloor {
  floor: Floor;
  /**
   * Last known display name per user, from the database rather than anything a client said.
   *
   * Kept after they disconnect on purpose: a student who dropped mid-answer is still a row in the
   * teacher's list, and "Student" where their name used to be reads as a different person.
   */
  names: Map<number, string>;
  /** The class's own timing, read once. Null when the row could not be read. */
  session: StartableSession | null;
  cutoff: number | null;
  /** Whose first raised hand has already been written down. See `noteAsk`. */
  loggedAsk: Set<number>;
  /** When each student's microphone actually went live, for the speaking-time record. */
  speakingSince: Map<number, number>;
}

const floors = new Map<string, RoomFloor>();
/** Loads in flight, so ten people joining at once cause one lookup rather than ten. */
const loading = new Map<string, Promise<RoomFloor>>();

/**
 * The floor for one class, loading its entitlement and its clock exactly once.
 *
 * Both facts come from the server: whether the class carries the Monthly discussion benefit, and
 * when it stops being a class at all. A client is never asked for either — one would claim to be
 * Monthly and the other would claim it was still Tuesday.
 */
export async function ensureFloor(sessionId: string): Promise<RoomFloor> {
  const existing = floors.get(sessionId);
  if (existing) return existing;
  const inFlight = loading.get(sessionId);
  if (inFlight) return inFlight;

  const work = (async (): Promise<RoomFloor> => {
    const numericId = Number(sessionId);
    let eligible = false;
    let session: StartableSession | null = null;

    if (Number.isFinite(numericId)) {
      try {
        eligible = await discussionModeEligible(numericId);
      } catch (err) {
        // Defaults closed. A database that cannot say "this is paid for" has not said yes.
        logger.warn({ err, sessionId }, "could not read the discussion entitlement");
      }
      try {
        const [row] = await db
          .select({
            date: sessionsTable.date,
            duration: sessionsTable.duration,
            startedAt: sessionsTable.startedAt,
            status: sessionsTable.status,
          })
          .from(sessionsTable)
          .where(eq(sessionsTable.id, numericId))
          .limit(1);
        /*
          `endedAt: null` is the same honest stub the room route uses.

          `cutoffAt` is a function of the booked slot alone — date plus duration plus the overtime
          allowance — and never of when a teacher pressed stop. One timeline, and this joins it
          rather than starting a second.
        */
        if (row) session = { ...row, endedAt: null };
      } catch (err) {
        logger.warn({ err, sessionId }, "could not read the class's own clock");
      }
    }

    const made: RoomFloor = {
      floor: emptyFloor(eligible),
      names: new Map(),
      session,
      cutoff: session ? cutoffAt(session) : null,
      loggedAsk: new Set(),
      speakingSince: new Map(),
    };
    floors.set(sessionId, made);
    return made;
  })().finally(() => loading.delete(sessionId));

  loading.set(sessionId, work);
  return work;
}

/** Whether the configured provider can actually enforce a permission. See the file header. */
function providerEnforces(): boolean {
  return videoProvider().capabilities.moderatesPublishing;
}

function windowFor(state: RoomFloor, now: number): WindowCheck {
  if (!state.session) {
    return { open: false, code: "no-schedule", reason: "This class has no scheduled time.", opensAt: null };
  }
  return discussionWindow(state.session, state.cutoff, now);
}

/* ------------------------------------------------------------------------- */
/* Telling people                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Send each person the view they are entitled to.
 *
 * Per viewer rather than one broadcast, because the teacher's view is the whole roster and a
 * student's is their own row and two counts. `floorView.ts` says why that is two functions rather
 * than one payload and a filter.
 */
function tell(state: RoomFloor, room: RoomPort, only: Set<number> | null): void {
  for (const client of room.clients()) {
    if (client.isSessionTeacher) {
      // Always. Any change at all is a change to the list they are moderating from.
      client.send({ type: "floor_state", floor: teacherView(state.floor, state.names) });
      continue;
    }
    if (only !== null && !only.has(client.userId)) continue;
    client.send({ type: "floor_state", floor: studentView(state.floor, client.userId) });
  }
}

/** Everybody, whatever changed. For a mode switch, a spotlight, or a fresh arrival. */
export function tellEveryone(sessionId: string, room: RoomPort): void {
  const state = floors.get(sessionId);
  if (state) tell(state, room, null);
}

/** One person, on connect: their own row, without disturbing anybody else's screen. */
function tellOne(state: RoomFloor, client: FloorClient): void {
  client.send({
    type: "floor_state",
    floor: client.isSessionTeacher ? teacherView(state.floor, state.names) : studentView(state.floor, client.userId),
  });
}

/* ------------------------------------------------------------------------- */
/* Coming and going                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Somebody's socket opened.
 *
 * Their *permissions* are whatever the server still says they are. A student who was returned to
 * the audience and then reconnected comes back an audience member, because the floor is the record
 * and their client's memory is not — which is the whole reason a revoked permission stays revoked
 * across a reconnect.
 */
export async function floorJoin(
  sessionId: string,
  room: RoomPort,
  client: FloorClient,
  name: string,
): Promise<void> {
  const state = await ensureFloor(sessionId);
  state.names.set(client.userId, name);

  if (!client.isSessionTeacher) {
    const before = state.floor.students.get(client.userId);
    const known = before !== undefined;
    markReconnected(state.floor, client.userId);
    /*
      A returning student's tracks are closed, so their acceptance is not carried over.

      `markDisconnected` already cleared it when they dropped. Re-pushing their rights to the
      provider matters more: LiveKit sees a *new* participant on a reconnect, minted from a token
      that permits publishing nothing, so a student who was speaking and dropped would come back
      silent and unable to fix it. Pushing is what restores their standing grant.
    */
    if (known) void pushRights(sessionId, state, [client.userId]);
  }

  tellOne(state, client);
  // And the teacher, whose roster now contains one more connected person.
  for (const other of room.clients()) {
    if (other.isSessionTeacher && other.userId !== client.userId) {
      other.send({ type: "floor_state", floor: teacherView(state.floor, state.names) });
    }
  }
}

/**
 * Somebody's socket closed for good.
 *
 * Only when their *last* one did: a student with the class open in two tabs who closes one has not
 * left, and marking them gone would show the teacher a disconnected student who is looking right
 * at them. The hub decides that, because only it knows who is still connected.
 */
export function floorLeave(sessionId: string, room: RoomPort, userId: number, isTeacher: boolean): void {
  const state = floors.get(sessionId);
  if (!state || isTeacher) return;
  closeSpeakingStint(sessionId, state, userId);
  markDisconnected(state.floor, userId);
  for (const other of room.clients()) {
    if (other.isSessionTeacher) {
      other.send({ type: "floor_state", floor: teacherView(state.floor, state.names) });
    }
  }
}

/**
 * The class started, or ended. Either way the floor starts again from nothing.
 *
 * Called from the one place the rest of the server already announces a status change, so a class
 * cannot end without this happening. Any speaking stint still open is written down first — a
 * lesson that ends while a student is mid-answer must not lose the record that they answered.
 */
export function resetFloorFor(sessionId: string): void {
  const state = floors.get(sessionId);
  if (!state) return;
  for (const userId of [...state.speakingSince.keys()]) closeSpeakingStint(sessionId, state, userId);
  endSession(state.floor);
  state.loggedAsk.clear();
  state.names.clear();
}

/** The room emptied. Drop it entirely; the next person to arrive loads it again. */
export function forgetFloor(sessionId: string): void {
  const state = floors.get(sessionId);
  if (state) {
    for (const userId of [...state.speakingSince.keys()]) closeSpeakingStint(sessionId, state, userId);
  }
  floors.delete(sessionId);
}

/* ------------------------------------------------------------------------- */
/* The record                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Which actions are worth a line in the log a support agent reads.
 *
 * Not all of them. A teacher tapping the spotlight while they talk, or a student cancelling their
 * own raised hand, are not facts anybody argues about later, and a log that records every tap is a
 * log nobody can read. What is kept is every decision that changed what somebody was *allowed* to
 * do — which is exactly the set a refund argument turns on.
 */
const WORTH_RECORDING = new Set<FloorRequest["action"]>([
  "allow",
  "dismiss",
  "invite_all",
  "mute",
  "mute_all",
  "stop_camera",
  "return_audience",
  "start_discussion",
  "end_discussion",
]);

function noteAction(sessionId: string, effects: FloorEffects): void {
  const numericId = Number(sessionId);
  if (!Number.isFinite(numericId)) return;
  if (!WORTH_RECORDING.has(effects.note.action)) return;
  recordActivity({
    userId: effects.note.actorId,
    action: `classroom.floor.${effects.note.action}`,
    subjectType: "session",
    subjectId: numericId,
    detail: { students: effects.note.subjects },
  });
}

/**
 * A student's first raised hand in this class, and only the first.
 *
 * "I put my hand up and was never picked" is a real complaint with a real answer, and it needs a
 * line in the record to have one. Every tap would be noise — the same student on a bad connection
 * generates several — so the first is kept and the rest are not, which is enough to establish that
 * they asked and enough to compare against whether they were ever allowed.
 */
function noteAsk(sessionId: string, state: RoomFloor, userId: number): void {
  const numericId = Number(sessionId);
  if (!Number.isFinite(numericId) || state.loggedAsk.has(userId)) return;
  state.loggedAsk.add(userId);
  recordActivity({
    userId,
    action: "classroom.floor.ask",
    subjectType: "session",
    subjectId: numericId,
  });
}

/**
 * How long somebody actually spoke, written down when their turn ends.
 *
 * ## Why this is a log line and not a column
 *
 * A `spoke_ms` column on `session_participation` would be easier to query and is the better answer
 * eventually. It is not the answer today because this project pushes schema by hand (`db:push`)
 * while the API redeploys itself on every push — so between a deploy and the owner running that
 * command, an INSERT naming a column the database does not have fails, and
 * `recordParticipation` swallows the error. The whole attendance ledger would stop being written
 * for however long that gap lasted, to add a number. That trade is not worth making, and this is
 * the same reasoning the schema files already record for why `session_activity` is its own table.
 *
 * So it goes to the append-only log, which needs no migration, is read in the same place a support
 * agent reads everything else, and sums to the same answer.
 */
function closeSpeakingStint(sessionId: string, state: RoomFloor, userId: number): void {
  const since = state.speakingSince.get(userId);
  if (since === undefined) return;
  state.speakingSince.delete(userId);
  const numericId = Number(sessionId);
  const ms = Date.now() - since;
  // Under a second is a tap, not a turn. Recording those buries the real ones.
  if (!Number.isFinite(numericId) || ms < 1000) return;
  recordActivity({
    userId,
    action: "classroom.floor.spoke",
    subjectType: "session",
    subjectId: numericId,
    detail: { ms },
  });
}

/** Start or stop each student's stopwatch from what the floor now says is live. */
function trackSpeaking(sessionId: string, state: RoomFloor, candidates: number[]): void {
  for (const userId of candidates) {
    const s = state.floor.students.get(userId);
    const rights = s ? publishRightsFor(s) : null;
    const live = Boolean(s && rights && ((rights.mic && s.accepted.mic) || (rights.camera && s.accepted.camera)));
    if (live && !state.speakingSince.has(userId)) state.speakingSince.set(userId, Date.now());
    else if (!live) closeSpeakingStint(sessionId, state, userId);
  }
}

/* ------------------------------------------------------------------------- */
/* Telling the provider                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Hand the floor's decision to whoever is carrying the media.
 *
 * Never awaited by the socket handler. A provider that is slow, or briefly unreachable, must not
 * hold up the message that tells the class what the teacher just decided — the screens update from
 * the floor, and the provider catches up. A failure is logged and the floor stands, because the
 * floor is the record: the next thing this student does is checked against it either way.
 */
function pushRights(sessionId: string, state: RoomFloor, userIds: number[]): void {
  const provider = videoProvider();
  if (!provider.setPublishing || userIds.length === 0) return;
  for (const userId of userIds) {
    const s = state.floor.students.get(userId);
    if (!s) continue;
    const rights = publishRightsFor(s);
    void provider
      .setPublishing(sessionId, userId, rights)
      .then((applied) => {
        if (!applied) {
          logger.warn({ sessionId, userId, rights }, "the video provider did not apply a floor decision");
        }
      })
      .catch((err: unknown) => logger.warn({ err, sessionId, userId }, "floor permission push failed"));
  }
}

/** Stop tracks that are open right now. Revoking a permission does not close one. */
function silenceThem(sessionId: string, userIds: number[]): void {
  const provider = videoProvider();
  if (!provider.silence || userIds.length === 0) return;
  for (const userId of userIds) {
    void provider
      .silence(sessionId, userId)
      .catch((err: unknown) => logger.warn({ err, sessionId, userId }, "could not stop a track"));
  }
}

/* ------------------------------------------------------------------------- */
/* One frame                                                                  */
/* ------------------------------------------------------------------------- */

/** Whether the hub should stop looking at this frame. False means "not a floor message". */
export function isFloorFrame(msg: Record<string, unknown>): boolean {
  return readFloorMessage(msg).kind !== "other";
}

/**
 * Handle one floor frame from one authenticated socket.
 *
 * `actorId` and `isTeacher` are the hub's, taken from the membership check at upgrade time. This
 * function never reads an actor from the message, which is the single rule the whole classroom's
 * authority rests on.
 */
export async function handleFloorFrame(
  sessionId: string,
  room: RoomPort,
  client: FloorClient,
  msg: Record<string, unknown>,
): Promise<void> {
  const parsed = readFloorMessage(msg);
  if (parsed.kind === "other") return;

  const refuse = (code: string, reason: string, action?: string) =>
    client.send({ type: "floor_refused", action: action ?? null, code, reason });

  if (parsed.kind === "malformed") {
    logger.warn({ sessionId, userId: client.userId, type: msg.type }, "unusable floor message");
    refuse(parsed.code, parsed.reason);
    return;
  }

  if (!providerEnforces()) {
    /*
      Said plainly rather than accepted and quietly ignored.

      The app hides these controls when the provider cannot enforce them, so reaching this line
      means either a stale client or a hand-edited one. Both deserve the true answer: this is not
      a permission problem and not a timing problem, it is a class whose video cannot do this.
    */
    refuse(
      "not-supported",
      "Raising your hand is not available on this class's video.",
      parsed.request.action,
    );
    return;
  }

  const state = await ensureFloor(sessionId);
  const now = Date.now();

  const ctx: FloorContext = {
    actorId: client.userId,
    isTeacher: client.isSessionTeacher,
    now,
    /*
      The class's own hard stop, from the one timeline the rest of the server runs on.

      A class whose row could not be read has no cutoff rather than an immediate one: refusing
      every action because a lookup failed would end a lesson over a database blip.
    */
    pastCutoff: state.cutoff !== null && now >= state.cutoff,
    window: windowFor(state, now),
    isStudent: (userId) => {
      if (userId === client.userId && client.isSessionTeacher) return false;
      if (state.floor.students.has(userId)) return true;
      return room.clients().some((c) => c.userId === userId && !c.isSessionTeacher);
    },
    inRoom: (userId) =>
      state.floor.students.has(userId) || room.clients().some((c) => c.userId === userId),
  };

  const outcome = applyFloorRequest(state.floor, parsed.request, ctx);
  if (!outcome.ok) {
    refuse(outcome.code, outcome.reason, parsed.request.action);
    return;
  }

  // The provider first: a permission the class has been told about but the SFU has not is a
  // student pressing "unmute" and being refused by LiveKit while their screen says they may.
  pushRights(sessionId, state, outcome.push);
  silenceThem(sessionId, outcome.silence);

  trackSpeaking(sessionId, state, outcome.touched);
  if (parsed.request.action === "ask") noteAsk(sessionId, state, client.userId);
  noteAction(sessionId, outcome);

  /*
    Who needs telling.

    A mode switch or a spotlight changes everybody's layout, so everybody hears. Anything else is
    one or two rows: the teacher always — it is their moderation list — and the students whose own
    row moved. A class of forty does not get forty payloads because one of them raised a hand.
  */
  tell(state, room, outcome.roomChanged ? null : new Set(outcome.touched));
}

/** For tests and diagnostics only: the floor as it stands, without loading one. */
export function peekFloor(sessionId: string): Floor | null {
  return floors.get(sessionId)?.floor ?? null;
}
