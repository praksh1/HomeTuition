import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeSessionProof,
  type AggregateInput,
  type LedgerPresence,
  type StoredProviderEvent,
} from "./aggregate.ts";

const NOW = Date.UTC(2026, 8, 5, 11, 0, 0);
const START = Date.UTC(2026, 8, 5, 10, 0, 0);
const MIN = 60_000;

const teacher: LedgerPresence = {
  userId: 1, name: "Asha", role: "teacher",
  firstJoinedAtMs: START, lastSeenAtMs: START + 55 * MIN,
  presentMs: 55 * MIN, joinCount: 1, drawCount: 40, messageCount: 3,
};
const student: LedgerPresence = {
  userId: 2, name: "Bikash", role: "student",
  firstJoinedAtMs: START + MIN, lastSeenAtMs: START + 55 * MIN,
  presentMs: 54 * MIN, joinCount: 1, drawCount: 0, messageCount: 5,
};

const base = (over: Partial<AggregateInput> = {}): AggregateInput => ({
  session: { scheduledStartMs: START, durationMinutes: 60, startedAtMs: START, endedAtMs: START + 55 * MIN },
  ledger: [teacher, student],
  providerEvents: [],
  quality: [],
  available: { ledger: true, provider: true, telemetry: true },
  expected: [{ userId: 1, name: "Asha", role: "teacher" }, { userId: 2, name: "Bikash", role: "student" }],
  ...over,
});

test("an unreadable ledger is never rendered as zero attendance", () => {
  // The whole reason this module exists. "Nobody attended" and "we were not watching" must not
  // arrive at an operator looking the same.
  const s = summarizeSessionProof(base({ ledger: [], available: { ledger: false, provider: true, telemetry: true } }), NOW);
  const asha = s.people.find((p) => p.userId === 1)!;
  assert.equal(asha.presentMs.available, false);
  assert.equal(asha.drawCount.available, false);
  assert.match(s.caveats.join(" "), /could not be read/i);
  assert.match(s.caveats.join(" "), /not the same as nobody attending/i);
});

test("a readable but empty ledger says so, and differently", () => {
  const s = summarizeSessionProof(base({ ledger: [] }), NOW);
  assert.match(s.caveats.join(" "), /readable and holds no rows/i);
  // Still unavailable per person — there is no row for them — but the class-level caveat differs.
  assert.doesNotMatch(s.caveats.join(" "), /could not be read/i);
});

test("a real zero is reported as a zero", () => {
  // The student drew nothing, and that is a fact rather than a gap.
  const s = summarizeSessionProof(base(), NOW);
  const bikash = s.people.find((p) => p.userId === 2)!;
  assert.deepEqual(bikash.drawCount, { available: true, value: 0 });
  assert.deepEqual(bikash.presentMs, { available: true, value: 54 * MIN });
});

test("somebody who paid and never appeared is still listed, with nothing filled in", () => {
  const s = summarizeSessionProof(base({
    ledger: [teacher],
    expected: [
      { userId: 1, name: "Asha", role: "teacher" },
      { userId: 3, name: "Never Came", role: "student" },
    ],
  }), NOW);
  const ghost = s.people.find((p) => p.userId === 3)!;
  assert.equal(ghost.presentMs.available, false);
  assert.equal(ghost.confidence, "absent");
});

test("no provider ingestion is a stated gap, not a silent one", () => {
  const s = summarizeSessionProof(base({ available: { ledger: true, provider: false, telemetry: true } }), NOW);
  assert.equal(s.providerSawMeeting.available, false);
  assert.equal(s.providerMeetingSpanMs.available, false);
  assert.match(s.caveats.join(" "), /no independent record from the video provider/i);
});

test("provider events corroborate the ledger and the span is only claimed when both ends arrived", () => {
  const events: StoredProviderEvent[] = [
    { eventType: "meeting.started", eventAtMs: START, participantUserId: null, participantIsOwner: null, durationSeconds: null },
    { eventType: "meeting.ended", eventAtMs: START + 55 * MIN, participantUserId: null, participantIsOwner: null, durationSeconds: null },
  ];
  const s = summarizeSessionProof(base({ providerEvents: events }), NOW);
  assert.deepEqual(s.providerSawMeeting, { available: true, value: true });
  assert.deepEqual(s.providerMeetingSpanMs, { available: true, value: 55 * MIN });

  const onlyStart = summarizeSessionProof(base({ providerEvents: [events[0]!] }), NOW);
  assert.equal(onlyStart.providerMeetingSpanMs.available, false);
});

test("unattributable provider events say so instead of implying nobody joined", () => {
  // Today's real case: tokens carry no user_id, so Daily can only say "an owner joined".
  const s = summarizeSessionProof(base({
    providerEvents: [
      { eventType: "participant.joined", eventAtMs: START, participantUserId: null, participantIsOwner: true, durationSeconds: null },
    ],
  }), NOW);
  const asha = s.people.find((p) => p.userId === 1)!;
  assert.equal(asha.providerJoinCount.available, false, "a null user_id must not become a zero join count");
  assert.match(s.caveats.join(" "), /cannot be tied to a Sikshya account/i);
  assert.match(s.timeline.map((e) => e.detail).join(" "), /an owner \(moderator\) joining/i);
});

test("a named provider join corroborates that person and raises confidence", () => {
  const s = summarizeSessionProof(base({
    providerEvents: [
      { eventType: "participant.joined", eventAtMs: START, participantUserId: 1, participantIsOwner: true, durationSeconds: null },
    ],
  }), NOW);
  const asha = s.people.find((p) => p.userId === 1)!;
  const bikash = s.people.find((p) => p.userId === 2)!;
  assert.deepEqual(asha.providerJoinCount, { available: true, value: 1 });
  assert.equal(asha.confidence, "corroborated");
  // The provider named somebody, so a zero for the other person is now a real zero.
  assert.deepEqual(bikash.providerJoinCount, { available: true, value: 0 });
  assert.equal(bikash.confidence, "single-source");
});

test("client telemetry is carried but always labelled self-reported", () => {
  const s = summarizeSessionProof(base({
    quality: [
      { userId: 1, observedAtMs: START + 10 * MIN, quality: "bad", reconnect: false },
      { userId: 1, observedAtMs: START + 11 * MIN, quality: "good", reconnect: true },
    ],
  }), NOW);
  const asha = s.people.find((p) => p.userId === 1)!;
  assert.deepEqual(asha.reportedReconnects, { available: true, value: 1 });
  assert.ok(asha.qualityBuckets.available && asha.qualityBuckets.value.bad === 1);
  assert.match(s.caveats.join(" "), /come from the participants' own devices/i);
  assert.match(s.caveats.join(" "), /not proof/i);
  // A device that said nothing is not a device that had no trouble.
  const bikash = s.people.find((p) => p.userId === 2)!;
  assert.equal(bikash.reportedReconnects.available, false);
});

test("the timeline is ordered and carries its source on every line", () => {
  const s = summarizeSessionProof(base({
    providerEvents: [
      { eventType: "meeting.started", eventAtMs: START - MIN, participantUserId: null, participantIsOwner: null, durationSeconds: null },
    ],
    quality: [{ userId: 2, observedAtMs: START + 30 * MIN, quality: "warning", reconnect: false }],
  }), NOW);
  const times = s.timeline.map((e) => e.atMs);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "timeline must be chronological");
  for (const entry of s.timeline) {
    assert.ok(["schedule", "socket-ledger", "provider", "client-telemetry"].includes(entry.source));
  }
});

test("the teacher is listed first, because that is what a refund argues about", () => {
  const s = summarizeSessionProof(base(), NOW);
  assert.equal(s.people[0]!.role, "teacher");
});

test("no output contains a verdict, a recommendation or a refund", () => {
  const s = summarizeSessionProof(base({
    ledger: [],
    providerEvents: [],
    available: { ledger: true, provider: true, telemetry: true },
  }), NOW);
  const words = JSON.stringify(s).toLowerCase();
  for (const forbidden of ["refund", "recommend", "verdict", "should be", "at fault", "entitled"]) {
    assert.ok(!words.includes(forbidden), `"${forbidden}" must not appear in an evidence summary`);
  }
});

test("the summary is deterministic for the same input and clock", () => {
  assert.deepEqual(summarizeSessionProof(base(), NOW), summarizeSessionProof(base(), NOW));
});
