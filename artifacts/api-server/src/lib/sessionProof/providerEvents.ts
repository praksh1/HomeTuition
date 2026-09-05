/**
 * Turning a Daily webhook into the few facts worth keeping.
 *
 * ## Why this exists
 *
 * The attendance ledger in `session_participation` is written by this project's own classroom
 * socket. That is the right primary source — it is the thing neither side can argue with — but it
 * has one weakness a refund argument will find: **it is our word.** A teacher who says "I was
 * there, your app dropped me" is disputing the very record being used against them, and there is
 * nothing independent to check it against.
 *
 * Daily saw the same call. Its webhooks are a second, independently-produced account of who was in
 * the room and for how long. Where the two agree, a finding is much harder to argue with. Where
 * they disagree, that disagreement is itself the most interesting fact in the file — and it must be
 * shown to a person, not resolved by a rule.
 *
 * ## What this file is, and is not
 *
 * Pure and import-free, like `sessionEvidence.ts` and for the same reason: these are the rules a
 * refund will be argued over, and a rule that needs a database and a live webhook to exercise is a
 * rule nobody tests.
 *
 * It **decides nothing**. It normalizes, correlates, and rejects. Whether a class was delivered is
 * a judgement with an owner; see REFUNDS.md section 3.
 *
 * ## The envelope is treated as untrusted and only loosely known
 *
 * This normalizer is deliberately tolerant about *where* a field sits and strict about whether it
 * is usable. Daily's exact webhook envelope is not pinned in this repository, and guessing a
 * vendor's JSON shape and then trusting it is how a parser silently drops every event in
 * production. So each field is looked for in a few plausible places, and anything that cannot be
 * understood is **rejected with a reason** rather than half-stored.
 *
 * **Before this endpoint is enabled against real traffic, the envelope must be confirmed against
 * Daily's current webhook documentation and the accepted shapes here narrowed to match.** Until
 * then, treat a rejection count in the logs as expected rather than alarming.
 */

/** The only provider this file knows how to read. Others get their own normalizer. */
export const PROVIDER_DAILY = "daily";

/**
 * The four events worth storing.
 *
 * Deliberately not "everything Daily can send". Recording, transcription and dial-in events
 * describe features this product does not use, and an evidence table that accumulates events
 * nobody reads is a privacy cost with no benefit.
 */
export const SUPPORTED_EVENT_TYPES = [
  "meeting.started",
  "meeting.ended",
  "participant.joined",
  "participant.left",
] as const;

export type ProviderEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

/** Why an event was not stored. Counted in logs; never shown to a caller. */
export type RejectionReason =
  | "not_an_object"
  | "unsupported_type"
  | "missing_event_id"
  | "missing_room"
  | "unmapped_room"
  | "missing_or_bad_timestamp";

/**
 * One normalized event, holding the minimum that could corroborate attendance.
 *
 * Note what is absent: no raw payload, no token, no signature, no participant name, no IP, no
 * audio or video anything. A stored blob of somebody's meeting metadata is a liability that grows
 * silently, and none of it is needed to answer "was the teacher in the room, and for how long".
 */
export interface NormalizedProviderEvent {
  provider: string;
  /** The provider's own id for this delivery. The idempotency key. */
  providerEventId: string;
  eventType: ProviderEventType;
  /** When the provider says it happened, as epoch milliseconds. */
  eventAtMs: number;
  /** The Sikshya session this room belongs to, or null when the room is not ours. */
  sessionId: number | null;
  /** The provider's room name, kept so an unmapped event is still diagnosable. */
  providerRoom: string;
  /** The provider's id for the meeting instance, where it supplies one. */
  providerMeetingId: string | null;
  /** The provider's id for one participant's connection, where it supplies one. */
  providerParticipantId: string | null;
  /**
   * The Sikshya user id, **only when the provider echoes one back from a token we minted.**
   *
   * Null today, and that is a finding rather than an oversight: `lib/daily.ts` mints tokens with
   * `room_name`, `is_owner`, `user_name` and `exp`, and no `user_id`. So Daily can tell us that
   * *an owner* joined, never *which account*. Attribution therefore stops at the owner/non-owner
   * line until a `user_id` claim is added to token minting — a one-line change to an already
   * working path, deliberately not made here.
   */
  participantUserId: number | null;
  /**
   * Owner (moderator) or not, as the provider saw it.
   *
   * Corroborating only. Rights are decided by this server's own membership check and never by the
   * provider — see VIDEO.md. A provider claiming somebody was an owner proves what the provider
   * believed, not what they were entitled to.
   */
  participantIsOwner: boolean | null;
  /** Seconds the provider says the meeting or participation lasted, where supplied. */
  durationSeconds: number | null;
}

export type NormalizeResult =
  | { ok: true; event: NormalizedProviderEvent }
  | { ok: false; reason: RejectionReason };

/* ------------------------------------------------------------------ reading a loose payload */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First usable string at any of the given dotted paths. */
function pickString(source: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    let cursor: unknown = source;
    for (const key of path.split(".")) {
      if (!isObject(cursor)) { cursor = undefined; break; }
      cursor = cursor[key];
    }
    if (typeof cursor === "string" && cursor.trim().length > 0) return cursor.trim();
    // A numeric id is still an id. Stringified so the column type never depends on the provider.
    if (typeof cursor === "number" && Number.isFinite(cursor)) return String(cursor);
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, paths: string[]): number | null {
  for (const path of paths) {
    let cursor: unknown = source;
    for (const key of path.split(".")) {
      if (!isObject(cursor)) { cursor = undefined; break; }
      cursor = cursor[key];
    }
    if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    if (typeof cursor === "string" && cursor.trim() !== "") {
      const parsed = Number(cursor);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickBoolean(source: Record<string, unknown>, paths: string[]): boolean | null {
  for (const path of paths) {
    let cursor: unknown = source;
    for (const key of path.split(".")) {
      if (!isObject(cursor)) { cursor = undefined; break; }
      cursor = cursor[key];
    }
    if (typeof cursor === "boolean") return cursor;
  }
  return null;
}

/* ---------------------------------------------------------------------- room name ↔ session */

/**
 * The session id a Daily room name belongs to, or null.
 *
 * The exact inverse of `sanitizeRoomName` in `lib/daily.ts`, which builds `"sikshya" + id` with
 * every non-alphanumeric character stripped. Session ids are integers, so for this product the
 * mapping is one-to-one and reversible.
 *
 * Strict on purpose. `sanitizeRoomName` is lossy in general — a hypothetical id of `1-2` and one
 * of `12` both produce `sikshya12` — so anything that is not exactly `sikshya` followed by digits
 * is refused rather than guessed at. A webhook for somebody else's room, or for a room named by
 * hand in the Daily dashboard, correlates to no session and is stored unmapped rather than
 * attached to whichever class happens to share a prefix.
 */
export function sessionIdFromRoomName(roomName: string | null | undefined): number | null {
  if (typeof roomName !== "string") return null;
  const match = /^sikshya(\d+)$/.exec(roomName.trim());
  if (!match) return null;
  const id = Number(match[1]);
  // A leading zero would make two different room names map to one session.
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== match[1]) return null;
  return id;
}

/* ------------------------------------------------------------------------------ timestamps */

/** Ten years either side of now. Wide enough for clock skew, narrow enough to catch nonsense. */
const PLAUSIBLE_WINDOW_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Epoch milliseconds from whatever the provider sent, or null.
 *
 * Daily sends `event_ts` in **seconds**, and other providers send milliseconds or ISO strings, so
 * all three are accepted and disambiguated by magnitude rather than by trusting a field name. The
 * plausibility window exists because a wrong unit is otherwise silent: seconds read as milliseconds
 * puts a 2026 class in 1970, which sorts to the top of every timeline and looks like a real event.
 */
export function eventTimeMs(raw: unknown, now: number = Date.now()): number | null {
  let ms: number | null = null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Anything below this is far too small to be milliseconds since 1970 for a real event.
    ms = raw < 100_000_000_000 ? raw * 1000 : raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      ms = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    } else {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) ms = parsed;
    }
  }

  if (ms === null || !Number.isFinite(ms)) return null;
  if (Math.abs(ms - now) > PLAUSIBLE_WINDOW_MS) return null;
  return Math.round(ms);
}

/* ------------------------------------------------------------------------------ normalizing */

function isSupportedType(value: string | null): value is ProviderEventType {
  return value !== null && (SUPPORTED_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * One webhook body in, one storable row or a reason out.
 *
 * Order of checks is chosen so the cheapest and most common rejection comes first: a webhook for an
 * event type this product does not use should cost one string comparison, not a full parse.
 */
export function normalizeDailyEvent(raw: unknown, now: number = Date.now()): NormalizeResult {
  if (!isObject(raw)) return { ok: false, reason: "not_an_object" };

  const eventType = pickString(raw, ["type", "event_type", "payload.type"]);
  if (!isSupportedType(eventType)) return { ok: false, reason: "unsupported_type" };

  // The idempotency key. Without one, a retried delivery would be indistinguishable from a second
  // genuine event, and a duplicate "participant.left" would understate somebody's attendance.
  const providerEventId = pickString(raw, ["id", "event_id", "payload.id", "payload.event_id"]);
  if (!providerEventId) return { ok: false, reason: "missing_event_id" };

  const providerRoom = pickString(raw, ["payload.room", "payload.room_name", "room", "room_name"]);
  if (!providerRoom) return { ok: false, reason: "missing_room" };

  const eventAtMs = eventTimeMs(
    (raw as Record<string, unknown>).event_ts ??
      (raw as Record<string, unknown>).timestamp ??
      (isObject(raw.payload) ? raw.payload.event_ts ?? raw.payload.timestamp : undefined),
    now,
  );
  if (eventAtMs === null) return { ok: false, reason: "missing_or_bad_timestamp" };

  const sessionId = sessionIdFromRoomName(providerRoom);
  if (sessionId === null) return { ok: false, reason: "unmapped_room" };

  /*
    `user_id` is read from the payload but is null in practice today, because this project's tokens
    do not carry one. It is read anyway so that adding the claim later needs no change here — and
    so a test can prove the field is carried through when a provider does supply it.
  */
  const rawUserId = pickNumber(raw, ["payload.user_id", "user_id"]);
  const participantUserId =
    rawUserId !== null && Number.isSafeInteger(rawUserId) && rawUserId > 0 ? rawUserId : null;

  const durationSeconds = pickNumber(raw, ["payload.duration", "duration"]);

  return {
    ok: true,
    event: {
      provider: PROVIDER_DAILY,
      providerEventId,
      eventType,
      eventAtMs,
      sessionId,
      providerRoom,
      providerMeetingId: pickString(raw, ["payload.meeting_id", "meeting_id", "payload.mtg_session_id"]),
      providerParticipantId: pickString(raw, ["payload.session_id", "payload.participant_id"]),
      participantUserId,
      participantIsOwner: pickBoolean(raw, ["payload.owner", "payload.is_owner", "owner"]),
      // Negative or absurd durations are dropped rather than stored: a duration is only ever used
      // to corroborate a span, and a negative one would silently shorten it.
      durationSeconds:
        durationSeconds !== null && durationSeconds >= 0 && durationSeconds < 24 * 60 * 60
          ? Math.round(durationSeconds)
          : null,
    },
  };
}
