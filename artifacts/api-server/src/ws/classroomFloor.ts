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
import { studentView, teacherView, type ProviderState } from "../lib/classroom/floorView.ts";

/** One connected socket, as far as the floor is concerned. */
export interface FloorClient {
  userId: number;
  isSessionTeacher: boolean;
  /**
   * The display name, from the database rather than anything the client said.
   *
   * Carried here so that restarting a class can rebuild the roster *and its names* from whoever is
   * connected. Without it the rebuild would produce a list of people called "Student", which is
   * the same defect one step quieter.
   */
  name: string;
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
  /**
   * When each student's floor time started — permitted, consented *and* confirmed by the provider.
   *
   * Named for what it measures. It is not speaking time; see `FLOOR_HELD_ACTION`.
   */
  speakingSince: Map<number, number>;
  /**
   * One reconciliation record per student, whether or not anything is outstanding.
   *
   * A record whose `confirmed` equals its `desired` is the healthy state and means the SFU holds
   * exactly what the floor decided. See `ParticipantSync`.
   */
  provider: Map<number, ParticipantSync>;
  /**
   * How to reach the room, kept so a retry that resolves seconds later can still tell everybody.
   *
   * Refreshed on every join and every frame. The hub rebuilds its port on each call — each one
   * reads the live client set — so holding the latest is holding a live view, not a stale copy.
   */
  room: RoomPort | null;
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
      provider: new Map(),
      room: null,
    };
    floors.set(sessionId, made);
    return made;
  })().finally(() => loading.delete(sessionId));

  loading.set(sessionId, work);
  return work;
}

/**
 * Whether the configured provider can actually enforce a permission. See the file header.
 *
 * Exported because the hub asks it *before* putting somebody on the floor. On Daily that saves two
 * database lookups on every single join — the entitlement and the class's clock — for a floor
 * nobody could use, and Daily is the production provider.
 */
export function floorAvailable(): boolean {
  return videoProvider().capabilities.moderatesPublishing;
}

function windowFor(state: RoomFloor, now: number): WindowCheck {
  if (!state.session) {
    return { open: false, code: "no-schedule", reason: "This class has no scheduled time.", opensAt: null };
  }
  return discussionWindow(state.session, now);
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
/**
 * What the provider is holding, per student, for the views to render.
 *
 * Built fresh each time rather than stored on the floor, because it describes the *provider*
 * rather than the classroom's decision and the two must not be confused: the floor says what the
 * teacher decided, this says whether the SFU has caught up.
 */
function providerStates(state: RoomFloor): Map<number, ProviderState> {
  const out = new Map<number, ProviderState>();
  for (const userId of state.floor.students.keys()) {
    const value = providerStateOf(state, userId);
    if (value !== "ok") out.set(userId, value);
  }
  return out;
}

function tell(state: RoomFloor, room: RoomPort, only: Set<number> | null): void {
  const sync = providerStates(state);
  for (const client of room.clients()) {
    if (client.isSessionTeacher) {
      // Always. Any change at all is a change to the list they are moderating from.
      client.send({ type: "floor_state", floor: teacherView(state.floor, state.names, sync) });
      continue;
    }
    if (only !== null && !only.has(client.userId)) continue;
    client.send({ type: "floor_state", floor: studentView(state.floor, client.userId, sync) });
  }
}

/** Everybody, whatever changed. For a mode switch, a spotlight, or a fresh arrival. */
export function tellEveryone(sessionId: string, room: RoomPort): void {
  const state = floors.get(sessionId);
  if (!state) return;
  state.room = room;
  tell(state, room, null);
}

/**
 * Tell the room something changed that nobody asked for just now.
 *
 * A provider retry resolving, or giving up, happens seconds after the frame that caused it — long
 * after the socket handler has returned. Without this, a permission that finally landed, or one
 * that finally failed, would sit in the server and never reach a screen.
 */
function announce(state: RoomFloor): void {
  if (state.room) tell(state, state.room, null);
}

/** One person, on connect: their own row, without disturbing anybody else's screen. */
function tellOne(state: RoomFloor, client: FloorClient): void {
  const sync = providerStates(state);
  client.send({
    type: "floor_state",
    floor: client.isSessionTeacher
      ? teacherView(state.floor, state.names, sync)
      : studentView(state.floor, client.userId, sync),
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
  // Kept so a provider retry that resolves seconds from now can still reach this room.
  state.room = room;

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

      It will very often find them absent, because this is the *classroom* socket and their media
      connection is seconds behind it. That is now an unconfirmed grant rather than a completed
      one, and `noteMediaReady` finishes it when their video arrives.
    */
    if (known) syncParticipants(sessionId, state, [client.userId], []);
  }

  tellOne(state, client);
  // And the teacher, whose roster now contains one more connected person.
  const sync = providerStates(state);
  for (const other of room.clients()) {
    if (other.isSessionTeacher && other.userId !== client.userId) {
      other.send({ type: "floor_state", floor: teacherView(state.floor, state.names, sync) });
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
  closeFloorHeld(sessionId, state, userId);
  markDisconnected(state.floor, userId);
  state.room = room;
  const sync = providerStates(state);
  for (const other of room.clients()) {
    if (other.isSessionTeacher) {
      other.send({ type: "floor_state", floor: teacherView(state.floor, state.names, sync) });
    }
  }
}

/** Everything that belongs to the lesson that just ended, closed and written down. */
function wipeFloor(sessionId: string, state: RoomFloor): void {
  for (const userId of [...state.speakingSince.keys()]) closeFloorHeld(sessionId, state, userId);
  clearAllSync(state);
  endSession(state.floor);
  state.loggedAsk.clear();
  state.names.clear();
}

/**
 * The class is starting. Clear the last lesson, then put the lobby back.
 *
 * ## The bug this exists to fix
 *
 * Students are allowed into the room ten minutes before the booked start, so a teacher pressing
 * start does it to a room that already has people in it. The previous version cleared
 * `floor.students` and `state.names` and told everybody — and never rebuilt either. The result was
 * a teacher whose participant list was *empty* the moment their class began: Invite all and Mute
 * all reached nobody, and a student who later raised a hand reappeared under the generic name
 * "Student", because the name map had been thrown away too.
 *
 * Nothing about that was visible in the two-browser journey, because it opened the classrooms
 * after starting the class. It is now the first thing that suite does.
 *
 * Clearing first and rebuilding second, rather than keeping the rows, is deliberate: a teacher's
 * next lesson must not inherit the previous one's raised hands, invitations or — worst — a
 * *permission* belonging to a student from an hour ago. What is rebuilt is presence and identity
 * only, which is exactly what is true of the people sitting in the room.
 */
export function restartFloorFor(sessionId: string, room: RoomPort): void {
  const state = floors.get(sessionId);
  if (!state) return;
  wipeFloor(sessionId, state);
  state.room = room;

  for (const client of room.clients()) {
    if (client.isSessionTeacher) continue;
    state.names.set(client.userId, client.name);
    // Creates the row and marks it connected. Nothing is granted: `emptyStudent` starts at
    // audience, which is the truth about somebody who has just watched their class begin.
    markReconnected(state.floor, client.userId);
  }
}

/**
 * The class is over. Clear it, and rebuild nothing.
 *
 * The opposite of `restartFloorFor` and kept separate from it for that reason: after the end of a
 * class every floor action is refused by the cutoff check anyway, so rebuilding presence would
 * draw a roster of controls that all answer "this class is over".
 */
export function endFloorFor(sessionId: string): void {
  const state = floors.get(sessionId);
  if (!state) return;
  wipeFloor(sessionId, state);
}

/** The room emptied. Drop it entirely; the next person to arrive loads it again. */
export function forgetFloor(sessionId: string): void {
  const state = floors.get(sessionId);
  if (state) {
    for (const userId of [...state.speakingSince.keys()]) closeFloorHeld(sessionId, state, userId);
    clearAllSync(state);
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
 * The event name for how long a student *held the floor*.
 *
 * ## It is not speaking time, and an earlier version called it that
 *
 * The stopwatch below starts when the server has granted a microphone **and** the student has
 * pressed accept. Both of those are decisions; neither is a measurement. Nothing here observes a
 * published audio track, a provider acknowledgement, an audio level or any media telemetry — so
 * this number is written identically whether the student talked for four minutes or sat in
 * silence with a broken microphone, and it is written even when the permission push to LiveKit
 * failed and no sound could have been transmitted at all.
 *
 * It was called `classroom.floor.spoke`, and it went into the same log a support agent reads when
 * deciding a refund. "Sita spoke for four minutes" is a sentence somebody would have acted on.
 *
 * So the name says what it measures. `speechConfirmed: false` travels on every row as the
 * machine-readable half of the same statement: **this app cannot currently confirm that any sound
 * was transmitted**, and until provider media telemetry is ingested, nothing may report it as
 * though it could. `.agents/backlog/ui-upgrade-progress.md` is about exactly this class of
 * mistake — a number that is real-looking and answers a different question than the one asked.
 */
const FLOOR_HELD_ACTION = "classroom.floor.held";

/**
 * How long somebody was permitted to speak and had switched their microphone on.
 *
 * ## Why this is a log line and not a column
 *
 * A column on `session_participation` would be easier to query and is the better answer
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
function closeFloorHeld(sessionId: string, state: RoomFloor, userId: number): void {
  const since = state.speakingSince.get(userId);
  if (since === undefined) return;
  state.speakingSince.delete(userId);
  const numericId = Number(sessionId);
  const ms = Date.now() - since;
  // Under a second is a tap, not a turn. Recording those buries the real ones.
  if (!Number.isFinite(numericId) || ms < 1000) return;
  recordActivity({
    userId,
    action: FLOOR_HELD_ACTION,
    subjectType: "session",
    subjectId: numericId,
    detail: {
      ms,
      /*
        Both fields exist so that a future reader cannot mistake this for what it is not.

        `basis` says where the number came from; `speechConfirmed` says what is still missing.
        A narrative or refund rule that wants proof of speech has to find a row where this is
        true, and no code path in this build writes one — which is the honest position, because
        no provider media telemetry is ingested yet.
      */
      basis: "permission_and_consent",
      speechConfirmed: false,
    },
  });
}

/**
 * Start or stop each student's stopwatch from what the floor now says they are permitted to do.
 *
 * Named for the floor rather than for speech, deliberately — see `FLOOR_HELD_ACTION`. A student
 * whose permission push to the provider failed is *not* counted: `providerHolds` is false while a
 * grant is unconfirmed, so the clock does not run on a microphone the SFU never opened.
 */
function trackFloorHeld(sessionId: string, state: RoomFloor, candidates: number[]): void {
  for (const userId of candidates) {
    const s = state.floor.students.get(userId);
    const rights = s ? publishRightsFor(s) : null;
    const consented = Boolean(
      s && rights && ((rights.mic && s.accepted.mic) || (rights.camera && s.accepted.camera)),
    );
    const held = consented && providerHolds(state, userId);
    if (held && !state.speakingSince.has(userId)) state.speakingSince.set(userId, Date.now());
    else if (!held) closeFloorHeld(sessionId, state, userId);
  }
}

/* ------------------------------------------------------------------------- */
/* Telling the provider                                                       */
/* ------------------------------------------------------------------------- */

/**
 * One participant's reconciliation state — a revision counter and a single running loop.
 *
 * ## Why a revision rather than a pending flag per instruction
 *
 * The previous version kept one entry per `kind:userId` and started a fresh provider call for each
 * decision, so two decisions a second apart meant two calls in flight with no ordering between
 * them. Codex's sixth finding: an older answer could clear the pending state belonging to a newer
 * instruction, and an older retry could fire after a newer decision and re-apply authority the
 * teacher had already taken back. Tagging each call with an id and discarding stale *answers* does
 * not fix it — by the time a stale answer is discarded, the stale **write** has already reached the
 * SFU.
 *
 * So no two writes for one participant are ever in flight. `desired` moves on every floor change;
 * one loop at a time reads it, asks the provider for exactly that, and on returning checks whether
 * the floor moved underneath it. If it did, the loop goes round again from the *current* state
 * rather than finishing the instruction it started with. Intermediate states are skipped, which is
 * correct and is also cheaper: a teacher who invites and then mutes within a second causes one
 * write, of the mute.
 *
 * `confirmed === desired` is the whole definition of "the SFU holds what the classroom decided",
 * and it is what every screen renders.
 */
interface ParticipantSync {
  /** Bumped by every floor change that alters what this participant may publish. Monotonic. */
  desired: number;
  /** The newest revision the provider has confirmed. Never assigned from a superseded call. */
  confirmed: number;
  /** True while this participant's loop is running. Exactly one, which is the whole design. */
  running: boolean;
  /** Failed attempts at the **current** desired revision. Reset the moment it moves. */
  attempts: number;
  /**
   * Why the last attempt did not stick, which decides how the class is told about it.
   *
   * `absent` on a grant is not a failure of the provider — it is a student whose media connection
   * has not arrived yet — so it reads as still-pending and is resolved by `noteMediaReady` rather
   * than by calling the class broken. `error` is an outage and becomes visibly failed once the
   * retry budget is spent.
   */
  stalledBy: "none" | "absent" | "error";
  lastError: string;
  /**
   * An instruction to stop tracks that are open **now**, outstanding until it is confirmed.
   *
   * Sticky on purpose. Revoking a permission stops somebody publishing *again* and does nothing to
   * a microphone already open, so a stop that was asked for and never confirmed must survive the
   * next decision — otherwise a teacher who muted a student and then returned them to the audience
   * would silently drop the requirement to close a track that may still be running. Only a
   * decision that permits publishing again clears it, because silencing somebody a moment after
   * allowing them to speak would undo the grant.
   */
  needSilence: boolean;
  /** Wakes an interruptible backoff, so a newer decision never queues behind an older one's wait. */
  wake: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Bounding `floor_media_ready`: when the last one was accepted, and how many have been. */
  lastNudge: number;
  nudges: number;
}

/**
 * Five attempts over about half a minute, then it stops.
 *
 * Bounded on purpose. An unbounded retry against a provider that is genuinely down is a loop that
 * outlives the lesson and hides the problem behind an optimistic "still trying"; stopping and
 * saying so puts the fact in front of the teacher, who can end the class or carry on without the
 * student's microphone. Any later decision starts the budget again.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/**
 * How often one student's `floor_media_ready` is allowed to do anything, and how many in a class.
 *
 * The frame carries no identity and no authority — see `noteMediaReady` — but it does cause work,
 * so a client that sent it in a loop would be asking this server to talk to LiveKit in a loop.
 * Two seconds apart and twenty in a lesson is far more than a real reconnection storm needs and far
 * less than a useful amount of noise.
 */
const MEDIA_READY_MIN_GAP_MS = 2_000;
const MEDIA_READY_MAX_PER_STUDENT = 20;

function syncFor(state: RoomFloor, userId: number): ParticipantSync {
  const existing = state.provider.get(userId);
  if (existing) return existing;
  const made: ParticipantSync = {
    desired: 0,
    confirmed: 0,
    running: false,
    attempts: 0,
    stalledBy: "none",
    lastError: "",
    needSilence: false,
    wake: null,
    timer: null,
    lastNudge: 0,
    nudges: 0,
  };
  state.provider.set(userId, made);
  return made;
}

/**
 * Is everything the server asked for on this student's behalf actually in force?
 *
 * Read by `trackFloorHeld`, so a grant the SFU never accepted starts no stopwatch, and by the
 * views, so nobody is told a permission landed when it did not.
 */
function providerHolds(state: RoomFloor, userId: number): boolean {
  const s = state.provider.get(userId);
  return s === undefined || s.confirmed === s.desired;
}

/** How one person's provider state reads on a screen. Declared with the views it is drawn by. */
export function providerStateOf(state: RoomFloor, userId: number): ProviderState {
  const s = state.provider.get(userId);
  if (!s || s.confirmed === s.desired) return "ok";
  /*
    Spent, and it was the provider's fault. Only this reads as failed.

    A grant waiting on a media participant that has not arrived stays `pending` however long it
    waits, because that is what is true: nothing is broken, the student's video has not connected,
    and `noteMediaReady` will finish the job when it does. Calling that `failed` would send a
    teacher chasing an outage that is not happening.
  */
  if (!s.running && s.stalledBy === "error" && s.attempts >= RETRY_DELAYS_MS.length) return "failed";
  return "pending";
}

/**
 * Record that what this participant may publish has changed, and invalidate anything older.
 *
 * Called for every user in a decision's effects **before** the room is told, so the broadcast that
 * follows already says the provider has not caught up. `ok` is only ever written by an answer.
 */
function bump(state: RoomFloor, userId: number, wantsSilence: boolean): void {
  const s = syncFor(state, userId);
  s.desired += 1;
  // A new decision gets a fresh budget: the previous one's failures say nothing about this one.
  s.attempts = 0;
  s.stalledBy = "none";
  s.lastError = "";

  const student = state.floor.students.get(userId);
  const permits = student ? publishRightsFor(student).canPublish : false;
  s.needSilence = wantsSilence || (s.needSilence && !permits);

  // Cut short any backoff belonging to the instruction this one replaces.
  const wake = s.wake;
  s.wake = null;
  if (wake) wake();
}

/** A backoff that a newer decision can end early. Resolves on the timer or on `wake`. */
function backoff(s: ParticipantSync, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
      s.wake = null;
      resolve();
    };
    s.wake = done;
    s.timer = setTimeout(done, ms);
    // Node must not be held open by a classroom's retry timer.
    s.timer.unref?.();
  });
}

type Step = { ok: true } | { ok: false; reason: "absent" | "error"; error: string };

/**
 * One pass at making the SFU agree with the floor, derived from the floor *at this instant*.
 *
 * Nothing is captured from the decision that triggered it. That is what lets the loop above throw
 * away a superseded instruction: whatever it does next is recomputed here from the current state,
 * so a stale grant can never be the thing that gets written.
 *
 * ## The order, and why it is this way round
 *
 * Permission first, then the open track. Stopping a live microphone while its owner is still
 * permitted to publish leaves them able to switch it straight back on — the mute would look like it
 * worked and last a second. Revoking first closes the door, and the track is then closed behind it.
 */
async function applyOnce(
  sessionId: string,
  state: RoomFloor,
  userId: number,
  provider: ReturnType<typeof videoProvider>,
): Promise<Step> {
  const student = state.floor.students.get(userId);
  const rights = student
    ? publishRightsFor(student)
    : // No row means no permission: a student whose class ended, or who was never on the floor.
      { canPublish: false, mic: false, camera: false };
  // Read, never created. A loop still in flight when its class was torn down must not put a record
  // back into a map that has just been cleared.
  const sync = state.provider.get(userId);

  if (provider.setPublishing) {
    const push = await provider.setPublishing(sessionId, userId, rights);
    if (!push.applied) {
      if (push.reason === "failed") return { ok: false, reason: "error", error: push.error };
      /**
       * Absent, and what that means depends entirely on which way the instruction points.
       *
       * **A revocation of somebody who is not in the room is complete.** There is nobody by that
       * identity to publish anything, and if they arrive they arrive on a token that permits
       * nothing. Nothing is outstanding.
       *
       * **A grant to somebody who is not in the room is not.** Codex's fifth finding, and the
       * ordering that produces it is ordinary rather than exotic: the classroom WebSocket and the
       * LiveKit media connection are separate, and a student is on the first for a second or two
       * before they are on the second. A teacher granting the floor in that window used to be told
       * it had landed — and it had not, and nothing would ever push it again, so the student sat
       * there with a locked token and a screen saying they could speak.
       */
      if (rights.canPublish) {
        return {
          ok: false,
          reason: "absent",
          error: "the student's video connection has not reached the class yet",
        };
      }
    }
  }

  // A grant never carries a stop: `bump` clears it, and this is the second guard on the same rule.
  if (!sync?.needSilence || rights.canPublish) return { ok: true };
  if (!provider.silence) return { ok: true };

  const stop = await provider.silence(sessionId, userId);
  // Absent is a completed silence here for the same reason as above: nobody is publishing.
  if (stop.applied || stop.reason === "absent") {
    sync.needSilence = false;
    return { ok: true };
  }
  return { ok: false, reason: "error", error: stop.error };
}

/**
 * Run this participant's reconciliation until the provider holds the latest decision.
 *
 * Never awaited by a socket handler — a slow provider must not hold up a frame — and never started
 * twice. A second call while a loop is running is a no-op precisely *because* the running loop
 * re-reads `desired` after every await and will pick the new revision up itself.
 */
function reconcile(sessionId: string, state: RoomFloor, userId: number): void {
  const sync = syncFor(state, userId);
  if (sync.running) return;

  const provider = videoProvider();
  if (!provider.setPublishing) {
    // Nothing can be enforced, so nothing is outstanding. Daily takes this branch and the floor is
    // refused long before here anyway; this keeps a provider swap from leaving rows stuck pending.
    sync.confirmed = sync.desired;
    return;
  }

  sync.running = true;
  void (async () => {
    try {
      while (sync.confirmed !== sync.desired) {
        const revision = sync.desired;
        const step = await applyOnce(sessionId, state, userId, provider);
        // The room may have been torn down, or reloaded, while this was in flight.
        if (floors.get(sessionId) !== state) return;
        /*
          Or the *lesson* ended underneath it.

          `restartFloorFor` and `endFloorFor` keep the same room object and clear its records, so
          the check above does not catch them. A loop holding a record the room has dropped is no
          longer the authority on anything: it stops rather than reconciling a floor that has been
          wiped, and rather than writing its answer into an object nothing reads.
        */
        if (state.provider.get(userId) !== sync) return;
        // The floor moved underneath us. Throw this answer away and reconcile the newest state,
        // which `applyOnce` will read for itself.
        if (sync.desired !== revision) continue;

        if (step.ok) {
          sync.confirmed = revision;
          sync.attempts = 0;
          sync.stalledBy = "none";
          sync.lastError = "";
          // The stopwatch only runs on a grant the SFU actually holds.
          trackFloorHeld(sessionId, state, [userId]);
          announce(state);
          continue;
        }

        sync.attempts += 1;
        sync.stalledBy = step.reason;
        sync.lastError = step.error;
        trackFloorHeld(sessionId, state, [userId]);
        announce(state);

        const delay = RETRY_DELAYS_MS[sync.attempts - 1];
        if (delay === undefined) {
          logger.warn(
            { sessionId, userId, reason: step.reason, error: step.error },
            step.reason === "absent"
              ? "a grant is waiting for the student's video to reach the class; the room has been told"
              : "gave up asking the video provider to apply a floor decision; the class is being told",
          );
          return;
        }
        await backoff(sync, delay);
        if (floors.get(sessionId) !== state) return;
      }
    } finally {
      sync.running = false;
    }
  })();
}

/**
 * Push what the floor says for these people, and stop any track the decision closed.
 *
 * Two passes on purpose: every revision moves before any provider call starts, so the state the
 * caller is about to broadcast is already the truth about all of them rather than about whichever
 * one happened to be reconciled first.
 */
function syncParticipants(
  sessionId: string,
  state: RoomFloor,
  push: readonly number[],
  silence: readonly number[],
): void {
  const stopping = new Set(silence);
  const everyone = new Set([...push, ...silence]);
  for (const userId of everyone) bump(state, userId, stopping.has(userId));
  for (const userId of everyone) reconcile(sessionId, state, userId);
}

/**
 * The student's own client saying its media connection is up — a nudge, and nothing else.
 *
 * ## What it is allowed to be
 *
 * The gap Codex's fifth finding leaves open is that nothing on this server knows when a student's
 * LiveKit participant appears. `floorJoin` is a *classroom socket* hook and fires earlier; LiveKit
 * webhooks would be the authoritative answer and are a separate piece of work with its own
 * configuration (see the note in `livekitProvider.ts`). So the client says when its own media is
 * ready, and this is written so that a client saying it dishonestly, or a thousand times, gains
 * nothing:
 *
 * - **Identity comes from the authenticated socket**, never from the frame. The frame has no body.
 * - **The rights come from the floor**, recomputed by `applyOnce`. This grants nothing and cannot:
 *   it does not move `desired`, so a student with nothing outstanding causes exactly one map
 *   lookup and no provider call at all.
 * - **It is bounded**: a minimum gap between accepted nudges and a ceiling per student per class.
 *
 * The most a client can do with it is ask this server to re-attempt a decision its own teacher
 * already made — which is the entire point.
 */
function noteMediaReady(sessionId: string, room: RoomPort, client: FloorClient): void {
  const state = floors.get(sessionId);
  if (!state || client.isSessionTeacher) return;
  state.room = room;

  const sync = state.provider.get(client.userId);
  // Nothing has ever been asked of the provider for them, so there is nothing to re-attempt.
  if (!sync || sync.confirmed === sync.desired) return;

  const now = Date.now();
  if (now - sync.lastNudge < MEDIA_READY_MIN_GAP_MS) return;
  if (sync.nudges >= MEDIA_READY_MAX_PER_STUDENT) return;
  sync.lastNudge = now;
  sync.nudges += 1;

  /*
    A fresh retry budget, but only for the one stall this signal is about.

    A grant stalled on an absent participant is stalled on precisely the thing that has just
    arrived, so starting again is the right response. A grant stalled on an outage is not, and
    resetting there would let a client turn a bounded retry into an unbounded one.
  */
  if (sync.stalledBy === "absent") sync.attempts = 0;
  const wake = sync.wake;
  sync.wake = null;
  if (wake) wake();
  reconcile(sessionId, state, client.userId);
}

/** Drop every outstanding instruction for a room. Called when its floor is torn down. */
function clearAllSync(state: RoomFloor): void {
  for (const entry of state.provider.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    /*
      Woken rather than left hanging.

      A loop parked in `backoff` when its class ends would otherwise sit on a promise nobody will
      resolve for up to sixteen seconds. It wakes, sees the floor is gone, and returns.
    */
    const wake = entry.wake;
    entry.wake = null;
    if (wake) wake();
  }
  state.provider.clear();
}

/* ------------------------------------------------------------------------- */
/* One frame                                                                  */
/* ------------------------------------------------------------------------- */

/** Whether the hub should stop looking at this frame. False means "not a floor message". */
export function isFloorFrame(msg: Record<string, unknown>): boolean {
  return msg.type === MEDIA_READY_FRAME || readFloorMessage(msg).kind !== "other";
}

/**
 * The frame a client sends when its own video connection is up.
 *
 * Carries nothing but its own name — deliberately. See `noteMediaReady` for why a body would be a
 * mistake and what the server does with it instead.
 */
export const MEDIA_READY_FRAME = "floor_media_ready";

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
  /*
    Handled before anything else, because it is not a request and has no authority to check.

    It asks for nothing; it says a fact about the sender's own connection, and the only thing this
    server does with it is re-attempt a decision the teacher already made. It is answered even
    while the class is past its cutoff: what is outstanding there is a *revocation*, and finishing
    one late is always right.
  */
  if (msg.type === MEDIA_READY_FRAME) {
    if (floorAvailable()) noteMediaReady(sessionId, room, client);
    return;
  }

  const parsed = readFloorMessage(msg);
  if (parsed.kind === "other") return;

  const refuse = (code: string, reason: string, action?: string) =>
    client.send({ type: "floor_refused", action: action ?? null, code, reason });

  if (parsed.kind === "malformed") {
    logger.warn({ sessionId, userId: client.userId, type: msg.type }, "unusable floor message");
    refuse(parsed.code, parsed.reason);
    return;
  }

  if (!floorAvailable()) {
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
  syncParticipants(sessionId, state, outcome.push, outcome.silence);

  trackFloorHeld(sessionId, state, outcome.touched);
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
