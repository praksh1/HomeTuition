import assert from "node:assert/strict";
import test from "node:test";
import {
  FINE_GRAINED_RETENTION_DAYS,
  RETENTION_WINDOW_MS,
  mergeSummary,
  planRetention,
  sessionRollUpEligibility,
  summariseExpiring,
} from "./retention.ts";

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

test("the window is thirty fixed days, not a calendar month", () => {
  // Bikram Sambat months run 29-32 days and Gregorian 28-31, so calendar arithmetic gives two
  // different answers to one policy. Same reasoning as the tier window.
  assert.equal(FINE_GRAINED_RETENTION_DAYS, 30);
  assert.equal(RETENTION_WINDOW_MS, 30 * DAY);
});

test("rows older than the window are planned for removal and newer ones are kept", () => {
  const plan = planRetention([
    { id: 1, sessionId: 10, receivedAtMs: NOW - 31 * DAY },
    { id: 2, sessionId: 10, receivedAtMs: NOW - 29 * DAY },
    { id: 3, sessionId: 11, receivedAtMs: NOW - 40 * DAY },
    { id: 4, sessionId: 11, receivedAtMs: NOW },
  ], NOW);

  assert.deepEqual(plan.expiredIds, [1, 3]);
  assert.deepEqual(plan.keptIds, [2, 4]);
  assert.equal(plan.cutoffMs, NOW - RETENTION_WINDOW_MS);
});

test("a row exactly on the boundary is kept", () => {
  // Deleting evidence one millisecond early is the error worth avoiding.
  const plan = planRetention([{ id: 1, sessionId: 1, receivedAtMs: NOW - RETENTION_WINDOW_MS }], NOW);
  assert.deepEqual(plan.expiredIds, []);
  assert.deepEqual(plan.keptIds, [1]);
});

test("every session losing rows is named, so an aggregate can be written first", () => {
  const plan = planRetention([
    { id: 1, sessionId: 10, receivedAtMs: NOW - 40 * DAY },
    { id: 2, sessionId: 10, receivedAtMs: NOW - 41 * DAY },
    { id: 3, sessionId: 12, receivedAtMs: NOW - 40 * DAY },
    { id: 4, sessionId: 13, receivedAtMs: NOW },
    { id: 5, sessionId: null, receivedAtMs: NOW - 40 * DAY },
  ], NOW);

  assert.deepEqual(plan.sessionsNeedingAggregate, [10, 12], "deduplicated, sorted, and unmapped rows excluded");
});

test("planning removes nothing by itself", () => {
  // The plan is data. There is no delete in this module, and nothing here can run on a schedule.
  const rows = [{ id: 1, sessionId: 1, receivedAtMs: NOW - 90 * DAY }];
  const before = JSON.stringify(rows);
  planRetention(rows, NOW);
  assert.equal(JSON.stringify(rows), before, "planRetention must not mutate its input");
});

test("an empty table plans nothing rather than failing", () => {
  const plan = planRetention([], NOW);
  assert.deepEqual(plan.expiredIds, []);
  assert.deepEqual(plan.sessionsNeedingAggregate, []);
});

test("the plan is deterministic and sorted, so a dry run is diffable", () => {
  const rows = [
    { id: 9, sessionId: 2, receivedAtMs: NOW - 60 * DAY },
    { id: 3, sessionId: 1, receivedAtMs: NOW - 60 * DAY },
    { id: 7, sessionId: 2, receivedAtMs: NOW - 60 * DAY },
  ];
  const a = planRetention(rows, NOW);
  const b = planRetention([...rows].reverse(), NOW);
  assert.deepEqual(a.expiredIds, [3, 7, 9]);
  assert.deepEqual(a, b, "row order must not change the plan");
});

/* ---------------------------------------------------- what a summary keeps once rows are gone */

test("what survives is counts and spans, never a timestamp", () => {
  const delta = summariseExpiring(
    [
      { id: 1, eventType: "meeting.started", eventAtMs: 1_000_000, providerMeetingId: "m1", participantUserId: null },
      { id: 2, eventType: "meeting.ended", eventAtMs: 1_600_000, providerMeetingId: "m1", participantUserId: null },
      { id: 3, eventType: "participant.joined", eventAtMs: 1_010_000, providerMeetingId: "m1", participantUserId: 7 },
    ],
    [
      { id: 1, quality: "bad", reconnect: true },
      { id: 2, quality: "good", reconnect: false },
      { id: 3, quality: "nonsense", reconnect: false },
    ],
  );
  assert.equal(delta.providerSawMeeting, true);
  assert.equal(delta.providerMeetingCount, 1);
  assert.equal(delta.providerMeetingSpanMs, 600_000);
  assert.equal(delta.providerParticipantJoinEvents, 1);
  assert.equal(delta.reportedReconnectsTotal, 1);
  assert.equal(delta.qualityBad, 1);
  assert.equal(delta.qualityGood, 1);
  assert.equal(delta.qualityUnknown, 1, "a bucket nobody recognises is unknown, not dropped");

  // "At 19:42:11 this person's connection was bad" is surveillance; "three bad periods" is a fact
  // about a lesson. Only the second may outlive the window.
  const serialised = JSON.stringify(delta);
  assert.ok(!serialised.includes("1010000"));
  assert.ok(!serialised.includes("\"7\""));
});

test("two meetings are summed as two spans, never spanned end to end", () => {
  const delta = summariseExpiring(
    [
      { id: 1, eventType: "meeting.started", eventAtMs: 0, providerMeetingId: "a", participantUserId: null },
      { id: 2, eventType: "meeting.ended", eventAtMs: 600_000, providerMeetingId: "a", participantUserId: null },
      { id: 3, eventType: "meeting.started", eventAtMs: 3_000_000, providerMeetingId: "b", participantUserId: null },
      { id: 4, eventType: "meeting.ended", eventAtMs: 3_600_000, providerMeetingId: "b", participantUserId: null },
    ],
    [],
  );
  assert.equal(delta.providerMeetingCount, 2);
  // Twenty minutes of meeting, not the hour between the first start and the last end.
  assert.equal(delta.providerMeetingSpanMs, 1_200_000);
});

test("an anonymous join is not counted as a named one", () => {
  const delta = summariseExpiring(
    [{ id: 1, eventType: "participant.joined", eventAtMs: 0, providerMeetingId: null, participantUserId: null }],
    [],
  );
  assert.equal(delta.providerParticipantJoinEvents, 0, "evidence somebody was there is not evidence about who");
  assert.equal(delta.providerSawMeeting, true, "but the provider did see the room being used");
});

test("a half-reported meeting contributes no span rather than a negative one", () => {
  const delta = summariseExpiring(
    [{ id: 1, eventType: "meeting.started", eventAtMs: 500, providerMeetingId: "a", participantUserId: null }],
    [],
  );
  assert.equal(delta.providerMeetingCount, 1);
  assert.equal(delta.providerMeetingSpanMs, 0);
});

test("nothing expiring summarises to nothing, not to zeroes that look like findings", () => {
  const delta = summariseExpiring([], []);
  assert.equal(delta.providerSawMeeting, false);
  assert.equal(delta.providerMeetingCount, 0);
});

/* --------------------------------------------- a class moves all at once, or it does not move */

test("a meeting whose start has expired but whose end has not holds the whole class back", () => {
  /*
    The defect this rule exists for, in one assertion.

    A meeting starts at T and ends an hour later, so its two rows arrive an hour apart. Row-by-row
    retention took the start on the day the window passed and the end an hour afterwards, leaving
    the class permanently summarised as two meetings of no length — a lesson that plainly happened,
    reduced to evidence that it did not, with the rows gone and no way to correct it.
  */
  const startArrived = NOW - RETENTION_WINDOW_MS - 60 * 60_000;
  const endArrived = NOW - RETENTION_WINDOW_MS + 1;
  const e = sessionRollUpEligibility([startArrived, endArrived], NOW);
  assert.equal(e.eligible, false, "one row still inside the window must hold the whole class");
  assert.equal(e.heldBack, 1);
  assert.equal(e.newestReceivedAtMs, endArrived);
});

test("once both ends are past the window the class may be rolled up", () => {
  const startArrived = NOW - RETENTION_WINDOW_MS - 60 * 60_000;
  const endArrived = NOW - RETENTION_WINDOW_MS - 1;
  assert.equal(sessionRollUpEligibility([startArrived, endArrived], NOW).eligible, true);
});

test("a row exactly on the boundary holds the class, rather than being swept a millisecond early", () => {
  assert.equal(sessionRollUpEligibility([NOW - RETENTION_WINDOW_MS], NOW).eligible, false);
  assert.equal(sessionRollUpEligibility([NOW - RETENTION_WINDOW_MS - 1], NOW).eligible, true);
});

test("a class with no rows is not eligible for anything", () => {
  const e = sessionRollUpEligibility([], NOW);
  assert.equal(e.eligible, false);
  assert.equal(e.newestReceivedAtMs, null);
});

test("a meeting reported with only one end is counted but declared unmeasured", () => {
  const delta = summariseExpiring(
    [
      { id: 1, eventType: "meeting.started", eventAtMs: 0, providerMeetingId: "a", participantUserId: null },
      { id: 2, eventType: "meeting.ended", eventAtMs: 600_000, providerMeetingId: "a", participantUserId: null },
      { id: 3, eventType: "meeting.started", eventAtMs: 900_000, providerMeetingId: "b", participantUserId: null },
    ],
    [],
  );
  assert.equal(delta.providerMeetingCount, 2);
  assert.equal(delta.providerMeetingSpanMs, 600_000);
  // Without this, "2 meetings totalling ten minutes" reads as a complete measurement of both.
  assert.equal(delta.providerMeetingsUnmeasured, 1);
});

/* -------------------------------------------------- folding a roll-up into an existing summary */

const DELTA = {
  providerSawMeeting: true,
  providerMeetingCount: 2,
  providerMeetingSpanMs: 1_800_000,
  providerMeetingsUnmeasured: 0,
  providerParticipantJoinEvents: 3,
  reportedReconnectsTotal: 1,
  qualityGood: 4,
  qualityWarning: 2,
  qualityBad: 1,
  qualityUnknown: 0,
};
const BOTH = { provider: true, telemetry: true };
const ROWS = { providerEvents: 6, qualitySamples: 7 };

test("a first roll-up writes the figures and names no unavailable source", () => {
  const m = mergeSummary(null, DELTA, BOTH, ROWS);
  assert.equal(m.providerMeetingCount, 2);
  assert.equal(m.providerMeetingSpanMs, 1_800_000);
  assert.equal(m.qualityGood, 4);
  assert.equal(m.unavailableSources, null);
  assert.equal(m.lateArrivals, 0);
});

test("a source that was not being ingested contributes nothing — not even a zero", () => {
  /*
    The fabrication this guards. A zero written for a source nobody was watching is
    indistinguishable from a real zero, and once the rows are deleted nothing can tell them apart
    again. This project has already shipped that bug on two dashboards.
  */
  const m = mergeSummary(null, DELTA, { provider: false, telemetry: true }, ROWS);
  assert.equal(m.providerMeetingCount, null, "not 0");
  assert.equal(m.providerMeetingSpanMs, null, "not 0");
  assert.equal(m.providerSawMeeting, null, "not false");
  assert.equal(m.qualityGood, 4, "the source that was watching is still recorded");
  assert.match(String(m.unavailableSources), /provider/);
  assert.doesNotMatch(String(m.unavailableSources), /telemetry/);
  // The rows still went away, so their disappearance is accounted for rather than silent.
  assert.equal(m.lateArrivals, 6);
});

test("evidence arriving later can resolve a source that was previously unknown", () => {
  const first = mergeSummary(null, DELTA, { provider: false, telemetry: true }, ROWS);
  const existing = {
    providerCovered: first.providerMeetingCount !== null,
    telemetryCovered: first.qualityGood !== null,
    ...first,
  };
  const second = mergeSummary(existing, DELTA, BOTH, ROWS);
  assert.equal(second.providerMeetingCount, 2, "null becomes a real number once there is evidence");
  assert.equal(second.unavailableSources, null, "and the source stops being listed as unknown");
  // Telemetry was already covered, so this pass's samples are late rather than additional.
  assert.equal(second.lateArrivals, first.lateArrivals + 7);
});

test("a late arrival never adds to figures that were already written", () => {
  /*
    The double-count this prevents. A class is rolled up all at once, so a delivery that turns up
    afterwards has no pair left to match — adding it would turn a lone `meeting.ended` into "a
    second meeting of no length" against a lesson that had exactly one.
  */
  const first = mergeSummary(null, DELTA, BOTH, ROWS);
  const existing = { providerCovered: true, telemetryCovered: true, ...first };
  const late = mergeSummary(existing, { ...DELTA, providerMeetingCount: 1, providerMeetingSpanMs: 0 }, BOTH, {
    providerEvents: 1,
    qualitySamples: 0,
  });
  assert.equal(late.providerMeetingCount, 2, "unchanged");
  assert.equal(late.providerMeetingSpanMs, 1_800_000, "unchanged");
  assert.equal(late.lateArrivals, 1, "but recorded, not silently dropped");
});

test("the unavailable list is derived from the figures, so it can never contradict them", () => {
  const nothing = mergeSummary(null, DELTA, { provider: false, telemetry: false }, ROWS);
  assert.equal(nothing.unavailableSources, "provider,client-telemetry");
  assert.equal(nothing.providerMeetingCount, null);
  assert.equal(nothing.qualityGood, null);

  const everything = mergeSummary(null, DELTA, BOTH, ROWS);
  assert.equal(everything.unavailableSources, null);
  assert.notEqual(everything.providerMeetingCount, null);
});

test("merging does not mutate the summary it was given", () => {
  const existing = {
    providerCovered: true, telemetryCovered: true,
    providerSawMeeting: true, providerMeetingCount: 5, providerMeetingSpanMs: 99,
    providerMeetingsUnmeasured: 0, providerParticipantJoinEvents: 1,
    reportedReconnectsTotal: 0, qualityGood: 1, qualityWarning: 0, qualityBad: 0, qualityUnknown: 0,
    lateArrivals: 0,
  };
  const before = JSON.stringify(existing);
  mergeSummary(existing, DELTA, BOTH, ROWS);
  assert.equal(JSON.stringify(existing), before);
});
