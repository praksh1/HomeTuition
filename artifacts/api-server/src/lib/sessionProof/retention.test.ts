import assert from "node:assert/strict";
import test from "node:test";
import {
  FINE_GRAINED_RETENTION_DAYS,
  RETENTION_WINDOW_MS,
  planRetention,
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
    { id: 1, sessionId: 10, atMs: NOW - 31 * DAY },
    { id: 2, sessionId: 10, atMs: NOW - 29 * DAY },
    { id: 3, sessionId: 11, atMs: NOW - 40 * DAY },
    { id: 4, sessionId: 11, atMs: NOW },
  ], NOW);

  assert.deepEqual(plan.expiredIds, [1, 3]);
  assert.deepEqual(plan.keptIds, [2, 4]);
  assert.equal(plan.cutoffMs, NOW - RETENTION_WINDOW_MS);
});

test("a row exactly on the boundary is kept", () => {
  // Deleting evidence one millisecond early is the error worth avoiding.
  const plan = planRetention([{ id: 1, sessionId: 1, atMs: NOW - RETENTION_WINDOW_MS }], NOW);
  assert.deepEqual(plan.expiredIds, []);
  assert.deepEqual(plan.keptIds, [1]);
});

test("every session losing rows is named, so an aggregate can be written first", () => {
  const plan = planRetention([
    { id: 1, sessionId: 10, atMs: NOW - 40 * DAY },
    { id: 2, sessionId: 10, atMs: NOW - 41 * DAY },
    { id: 3, sessionId: 12, atMs: NOW - 40 * DAY },
    { id: 4, sessionId: 13, atMs: NOW },
    { id: 5, sessionId: null, atMs: NOW - 40 * DAY },
  ], NOW);

  assert.deepEqual(plan.sessionsNeedingAggregate, [10, 12], "deduplicated, sorted, and unmapped rows excluded");
});

test("planning removes nothing by itself", () => {
  // The plan is data. There is no delete in this module, and nothing here can run on a schedule.
  const rows = [{ id: 1, sessionId: 1, atMs: NOW - 90 * DAY }];
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
    { id: 9, sessionId: 2, atMs: NOW - 60 * DAY },
    { id: 3, sessionId: 1, atMs: NOW - 60 * DAY },
    { id: 7, sessionId: 2, atMs: NOW - 60 * DAY },
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
