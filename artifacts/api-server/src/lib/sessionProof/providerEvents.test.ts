import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_DAILY,
  eventTimeMs,
  normalizeDailyEvent,
  sessionIdFromRoomName,
} from "./providerEvents.ts";

/** Pinned. Nothing in the module may read the wall clock. */
const NOW = Date.UTC(2026, 8, 5, 10, 0, 0);
const AT_S = Math.floor(NOW / 1000);

const webhook = (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "participant.joined",
  event_ts: AT_S,
  payload: { room: "sikshya42", ...payload },
  ...over,
});

test("a room name maps back to exactly the session that produced it", () => {
  // The inverse of sanitizeRoomName in lib/daily.ts: "sikshya" + the id.
  assert.equal(sessionIdFromRoomName("sikshya42"), 42);
  assert.equal(sessionIdFromRoomName("  sikshya7  "), 7);
});

test("a room this app did not name correlates to nothing", () => {
  for (const room of [
    "sikshya",            // no id
    "sikshya0",           // sessions start at 1
    "sikshya012",         // a leading zero would give two names one session
    "sikshya42x",
    "othersikshya42",
    "sikshya-42",
    "SIKSHYA42",          // sanitizeRoomName never produces upper case
    "",
    null,
    undefined,
  ]) {
    assert.equal(sessionIdFromRoomName(room as string), null, `"${String(room)}" must not map to a session`);
  }
});

test("a timestamp is read in whatever unit it arrives in", () => {
  assert.equal(eventTimeMs(AT_S, NOW), NOW);                    // Daily sends seconds
  assert.equal(eventTimeMs(NOW, NOW), NOW);                     // milliseconds
  assert.equal(eventTimeMs(String(AT_S), NOW), NOW);            // stringified
  assert.equal(eventTimeMs("2026-09-05T10:00:00.000Z", NOW), NOW); // ISO
});

test("a timestamp in the wrong unit is refused rather than silently believed", () => {
  // Seconds read as milliseconds puts a 2026 class in 1970, which sorts to the top of every
  // timeline and looks exactly like a real event.
  assert.equal(eventTimeMs(1, NOW), null);
  assert.equal(eventTimeMs(0, NOW), null);
  assert.equal(eventTimeMs(NOW * 1000, NOW), null);
  assert.equal(eventTimeMs("not a date", NOW), null);
  assert.equal(eventTimeMs(null, NOW), null);
  assert.equal(eventTimeMs(NaN, NOW), null);
});

test("a well-formed participant event normalizes to the minimum worth keeping", () => {
  const result = normalizeDailyEvent(
    webhook({ id: "evt_abc" }, { meeting_id: "mtg_1", session_id: "p_1", owner: true, duration: 900 }),
    NOW,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.event, {
    provider: PROVIDER_DAILY,
    providerEventId: "evt_abc",
    eventType: "participant.joined",
    eventAtMs: NOW,
    // No `joined_at` in this fixture, so the delivery clock is all there is — and the row says so
    // rather than presenting `event_ts` as though it were when somebody arrived.
    eventAtSource: "delivery",
    sessionId: 42,
    providerRoom: "sikshya42",
    providerMeetingId: "mtg_1",
    providerParticipantId: "p_1",
    participantUserId: null,
    participantIsOwner: true,
    durationSeconds: 900,
  });
});

/* ---------------------------------------------------------------- which clock a row is timed by */

test("a meeting is timed by its own start and end, not by when the callback was generated", () => {
  /*
    The bug this replaces. `event_ts` is when Daily generated the delivery; after a retry it can
    sit minutes after the thing it describes, and a span built from two of those overstates a
    lesson in the direction that costs a teacher money.
  */
  const started = normalizeDailyEvent(
    webhook({ type: "meeting.started", event_ts: AT_S + 600 }, { start_ts: AT_S }),
    NOW,
  );
  assert.ok(started.ok);
  assert.equal(started.event.eventAtMs, NOW);
  assert.equal(started.event.eventAtSource, "occurred");

  const ended = normalizeDailyEvent(
    webhook({ type: "meeting.ended", event_ts: AT_S + 3600 }, { end_ts: AT_S + 1800 }),
    NOW,
  );
  assert.ok(ended.ok);
  assert.equal(ended.event.eventAtMs, NOW + 1_800_000);
  assert.equal(ended.event.eventAtSource, "occurred");
});

test("an arrival is timed by joined_at", () => {
  const joined = normalizeDailyEvent(
    webhook({ type: "participant.joined", event_ts: AT_S + 120 }, { joined_at: AT_S }),
    NOW,
  );
  assert.ok(joined.ok);
  assert.equal(joined.event.eventAtMs, NOW);
  assert.equal(joined.event.eventAtSource, "occurred");
});

test("a departure is derived from the arrival plus how long it lasted", () => {
  // Daily reports no `left_at`, so the only honest occurrence timestamp is the one that can be
  // computed from two fields it does report.
  const left = normalizeDailyEvent(
    webhook({ type: "participant.left", event_ts: AT_S + 5000 }, { joined_at: AT_S, duration: 1200 }),
    NOW,
  );
  assert.ok(left.ok);
  assert.equal(left.event.eventAtMs, NOW + 1_200_000);
  assert.equal(left.event.eventAtSource, "occurred");
});

test("a departure with an unusable duration falls back rather than inventing a time", () => {
  for (const duration of [-60, 25 * 60 * 60, "later", null]) {
    const left = normalizeDailyEvent(
      webhook({ type: "participant.left", event_ts: AT_S }, { joined_at: AT_S - 600, duration }),
      NOW,
    );
    assert.ok(left.ok, `duration ${String(duration)} should still normalize`);
    // A derived timestamp built on a bad input is worse than an honest fallback: it looks exact.
    assert.equal(left.event.eventAtSource, "delivery", `duration ${String(duration)}`);
    assert.equal(left.event.eventAtMs, NOW);
  }
});

test("an occurrence timestamp outside the plausible window is not preferred to the delivery one", () => {
  // Seconds read as milliseconds puts a 2026 class in 1970, which sorts to the top of every
  // timeline and looks like a real event.
  const started = normalizeDailyEvent(
    webhook({ type: "meeting.started", event_ts: AT_S }, { start_ts: 1 }),
    NOW,
  );
  assert.ok(started.ok);
  assert.equal(started.event.eventAtSource, "delivery");
  assert.equal(started.event.eventAtMs, NOW);
});

test("nothing but the listed fields survives normalization", () => {
  // The privacy contract: no raw payload, no name, no address, no token.
  const result = normalizeDailyEvent(
    webhook({}, {
      user_name: "Asha Gurung",
      ip: "203.0.113.9",
      token: "secret-token",
      permissions: { canSend: true },
      recording: { url: "https://example/rec" },
    }),
    NOW,
  );
  assert.ok(result.ok);
  const serialised = JSON.stringify(result.event);
  for (const leaked of ["Asha", "203.0.113", "secret-token", "canSend", "example/rec"]) {
    assert.ok(!serialised.includes(leaked), `${leaked} must not be stored`);
  }
});

test("every supported event type is accepted and nothing else is", () => {
  for (const type of ["meeting.started", "meeting.ended", "participant.joined", "participant.left"]) {
    const r = normalizeDailyEvent(webhook({ type }), NOW);
    assert.ok(r.ok, `${type} should be accepted`);
  }
  for (const type of ["recording.started", "transcript.ready", "participant.updated", "", "PARTICIPANT.JOINED"]) {
    const r = normalizeDailyEvent(webhook({ type }), NOW);
    assert.ok(!r.ok && r.reason === "unsupported_type", `${type} should be refused`);
  }
});

test("an event with no id is refused, because idempotency has nothing to key on", () => {
  const r = normalizeDailyEvent({ type: "meeting.started", event_ts: AT_S, payload: { room: "sikshya42" } }, NOW);
  assert.ok(!r.ok && r.reason === "missing_event_id");
});

test("malformed bodies are refused with a reason and never throw", () => {
  const cases: [unknown, string][] = [
    [null, "not_an_object"],
    [undefined, "not_an_object"],
    ["a string", "not_an_object"],
    [[], "not_an_object"],
    [42, "not_an_object"],
    [{}, "unsupported_type"],
    [webhook({}, {} as never) && { id: "e", type: "meeting.started", event_ts: AT_S, payload: {} }, "missing_room"],
    [{ id: "e", type: "meeting.started", event_ts: "nonsense", payload: { room: "sikshya42" } }, "missing_or_bad_timestamp"],
    [{ id: "e", type: "meeting.started", event_ts: AT_S, payload: { room: "someone-elses-room" } }, "unmapped_room"],
  ];
  for (const [body, reason] of cases) {
    const r = normalizeDailyEvent(body, NOW);
    assert.ok(!r.ok, `${JSON.stringify(body)} should be refused`);
    assert.equal(r.reason, reason, JSON.stringify(body));
  }
});

test("a user id is carried through only when the provider actually supplies a usable one", () => {
  // Today this is always null: lib/daily.ts mints tokens without a user_id claim, so the provider
  // has nothing to echo. The field is read anyway so adding that claim later needs no change here.
  const today = normalizeDailyEvent(webhook(), NOW);
  assert.ok(today.ok);
  assert.equal(today.event.participantUserId, null);

  const withUser = normalizeDailyEvent(webhook({}, { user_id: 77 }), NOW);
  assert.ok(withUser.ok);
  assert.equal(withUser.event.participantUserId, 77);

  for (const bad of [0, -1, 1.5, "abc", null]) {
    const r = normalizeDailyEvent(webhook({}, { user_id: bad }), NOW);
    assert.ok(r.ok);
    assert.equal(r.event.participantUserId, null, `user_id ${String(bad)} must not be trusted`);
  }
});

test("an implausible duration is dropped rather than stored", () => {
  for (const bad of [-1, 24 * 60 * 60, 999_999]) {
    const r = normalizeDailyEvent(webhook({}, { duration: bad }), NOW);
    assert.ok(r.ok);
    assert.equal(r.event.durationSeconds, null, `duration ${bad} must be dropped`);
  }
  const good = normalizeDailyEvent(webhook({}, { duration: 61.4 }), NOW);
  assert.ok(good.ok);
  assert.equal(good.event.durationSeconds, 61);
});

test("normalizing is deterministic for the same input and clock", () => {
  const body = webhook({ id: "evt_same" }, { meeting_id: "m" });
  assert.deepEqual(normalizeDailyEvent(body, NOW), normalizeDailyEvent(body, NOW));
});
