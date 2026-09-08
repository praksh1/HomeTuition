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
   * Instructions the provider has not confirmed, keyed `kind:userId`.
   *
   * Empty is the healthy state and means the SFU holds exactly what the floor decided. See
   * `ProviderSync`.
   */
  provider: Map<string, ProviderSync>;
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
    */
    if (known) applyRights(sessionId, state, [client.userId]);
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
 * What the provider has been asked for, and whether it agreed.
 *
 * Absent from the map means "in step": the last thing the server asked for is what the SFU has.
 * Anything in the map is an unresolved instruction, and every screen in the class says so.
 */
interface ProviderSync {
  kind: "rights" | "silence";
  /** `pending` while a retry is still scheduled; `failed` once the attempts are spent. */
  state: "pending" | "failed";
  attempts: number;
  lastError: string;
  since: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Five attempts over about half a minute, then it stays visibly failed.
 *
 * Bounded on purpose. An unbounded retry against a provider that is genuinely down is a loop that
 * outlives the lesson and hides the problem behind an optimistic "still trying"; stopping and
 * saying so puts the fact in front of the teacher, who can end the class or carry on without the
 * student's microphone. The next action on that student pushes again from scratch either way.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

const syncKey = (kind: ProviderSync["kind"], userId: number) => `${kind}:${userId}`;

/**
 * Is everything the server asked for on this student's behalf actually in force?
 *
 * Read by `trackFloorHeld`, so a grant the SFU never accepted does not start a stopwatch, and by
 * the views, so nobody is told a permission landed when it did not.
 */
function providerHolds(state: RoomFloor, userId: number): boolean {
  return !state.provider.has(syncKey("rights", userId)) && !state.provider.has(syncKey("silence", userId));
}

/** How one person's provider state reads on a screen. Declared with the views it is drawn by. */
export function providerStateOf(state: RoomFloor, userId: number): ProviderState {
  const rights = state.provider.get(syncKey("rights", userId));
  const silence = state.provider.get(syncKey("silence", userId));
  if (rights?.state === "failed" || silence?.state === "failed") return "failed";
  if (rights || silence) return "pending";
  return "ok";
}

/**
 * Mark an instruction as outstanding, *before* the call is made.
 *
 * The correction Codex's second finding is really about. Marking only on failure left a window —
 * however short — in which the row read "in step" while the request was still in flight, and the
 * student's own screen offered them an unmute the SFU had not yet agreed to. Now the sequence is
 * always ask → pending → answer, and "ok" is only ever written by an answer.
 *
 * Attempt count and first-failure time survive across a re-begin so a retry does not reset its own
 * budget and loop for ever.
 */
function beginSync(state: RoomFloor, kind: ProviderSync["kind"], userId: number): void {
  const key = syncKey(kind, userId);
  const existing = state.provider.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  state.provider.set(key, {
    kind,
    state: "pending",
    attempts: existing?.attempts ?? 0,
    lastError: existing?.lastError ?? "",
    since: existing?.since ?? Date.now(),
    timer: null,
  });
}

function clearSync(state: RoomFloor, kind: ProviderSync["kind"], userId: number): void {
  const existing = state.provider.get(syncKey(kind, userId));
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  state.provider.delete(syncKey(kind, userId));
}

/** Drop every outstanding instruction for a room. Called when its floor is torn down. */
function clearAllSync(state: RoomFloor): void {
  for (const entry of state.provider.values()) if (entry.timer) clearTimeout(entry.timer);
  state.provider.clear();
}

/**
 * Record a failure, schedule the retry, and tell the room.
 *
 * The retry recomputes the instruction **from the floor as it stands at that moment**, never from
 * a value captured when the failure happened. A teacher who muted a student and then returned them
 * to the audience must not have the mute retried into a state that has moved on.
 */
function markFailed(
  sessionId: string,
  state: RoomFloor,
  kind: ProviderSync["kind"],
  userId: number,
  error: string,
): void {
  const key = syncKey(kind, userId);
  const existing = state.provider.get(key);
  const attempts = (existing?.attempts ?? 0) + 1;
  if (existing?.timer) clearTimeout(existing.timer);

  const delay = RETRY_DELAYS_MS[attempts - 1];
  const entry: ProviderSync = {
    kind,
    state: delay === undefined ? "failed" : "pending",
    attempts,
    lastError: error,
    since: existing?.since ?? Date.now(),
    timer: null,
  };
  state.provider.set(key, entry);

  if (delay !== undefined) {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      // The room may have been torn down while this was waiting.
      if (floors.get(sessionId) !== state) return;
      if (kind === "rights") void applyRights(sessionId, state, [userId]);
      else void applySilence(sessionId, state, [userId]);
    }, delay);
    // Node must not be held open by a classroom's retry timer.
    entry.timer.unref?.();
  } else {
    logger.error(
      { sessionId, userId, kind, error },
      "gave up asking the video provider to apply a floor decision; the class is being told",
    );
  }
  announce(state);
}

/**
 * Hand the floor's decision to whoever is carrying the media, and find out whether it took.
 *
 * ## Why the promise is no longer thrown away
 *
 * It used to be. The floor moved, the class was told immediately, and a failed call produced one
 * log line — so a student could be told they may speak while LiveKit still refused them, and a
 * teacher could be told a student was muted while an open microphone carried on. The comment said
 * "the provider catches up"; nothing implemented that.
 *
 * Now the outcome decides what the class is told. `absent` is accepted and needs no retry: a
 * student who is not in the SFU's room holds a token that permits publishing nothing, and
 * `floorJoin` re-pushes their standing grant the moment they come back. `failed` is kept, shown
 * and retried.
 *
 * Still not awaited by the socket handler — a slow provider must not hold up the frame — but the
 * screens now learn the truth a moment later instead of never.
 */
function applyRights(sessionId: string, state: RoomFloor, userIds: number[]): void {
  const provider = videoProvider();
  if (!provider.setPublishing || userIds.length === 0) return;
  for (const userId of userIds) {
    const student = state.floor.students.get(userId);
    if (!student) {
      // Nothing left to enforce — the row went with the class or the person.
      clearSync(state, "rights", userId);
      continue;
    }
    const rights = publishRightsFor(student);
    const setPublishing = provider.setPublishing.bind(provider);
    /*
      Pending first, synchronously, so the broadcast the caller is about to send already says so.
      `handleFloorFrame` calls this before it tells the room, which is what makes one round trip
      enough for the honest answer rather than two.
    */
    beginSync(state, "rights", userId);
    void setPublishing(sessionId, userId, rights)
      .then((outcome) => {
        if (floors.get(sessionId) !== state) return;
        if (outcome.applied || outcome.reason === "absent") {
          clearSync(state, "rights", userId);
          // The stopwatch only runs on a grant the SFU actually holds.
          trackFloorHeld(sessionId, state, [userId]);
          announce(state);
          return;
        }
        markFailed(sessionId, state, "rights", userId, outcome.error);
      })
      .catch((err: unknown) => {
        if (floors.get(sessionId) !== state) return;
        markFailed(sessionId, state, "rights", userId, err instanceof Error ? err.message : String(err));
      });
  }
}

/**
 * Stop tracks that are open right now, and keep trying until they are.
 *
 * Revoking a permission stops somebody publishing *again*; it does nothing to a microphone that is
 * already open. This is the half that fails **closed**: while a stop has not been confirmed, the
 * student is not reported as silenced to anybody, and the teacher's list says so.
 */
function applySilence(sessionId: string, state: RoomFloor, userIds: number[]): void {
  const provider = videoProvider();
  if (!provider.silence || userIds.length === 0) return;
  for (const userId of userIds) {
    const silence = provider.silence.bind(provider);
    beginSync(state, "silence", userId);
    void silence(sessionId, userId)
      .then((outcome) => {
        if (floors.get(sessionId) !== state) return;
        if (outcome.applied || outcome.reason === "absent") {
          clearSync(state, "silence", userId);
          trackFloorHeld(sessionId, state, [userId]);
          announce(state);
          return;
        }
        markFailed(sessionId, state, "silence", userId, outcome.error);
      })
      .catch((err: unknown) => {
        if (floors.get(sessionId) !== state) return;
        markFailed(sessionId, state, "silence", userId, err instanceof Error ? err.message : String(err));
      });
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
  applyRights(sessionId, state, outcome.push);
  applySilence(sessionId, state, outcome.silence);

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
