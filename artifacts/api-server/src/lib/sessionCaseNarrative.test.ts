import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionCaseNarrative, type NarrativeInput } from "./sessionCaseNarrative.ts";
import type { SessionProofSummary } from "./sessionProof/aggregate.ts";

const START = Date.parse("2026-08-31T08:15:00.000Z");
const fmt = (value: Date | string) => new Date(value).toISOString();

function input(over: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    session: {
      id: 91,
      teacherId: 3,
      teacherName: "Prakash Teacher",
      subject: "Mathematics",
      topic: "Fractions",
      date: new Date(START),
      duration: 60,
      price: 500,
      status: "completed",
      startedAt: new Date(START + 13 * 60_000),
      endedAt: new Date(START + 55 * 60_000),
      createdAt: new Date(START - 24 * 60 * 60_000),
      updatedAt: new Date(START - 12 * 60 * 60_000),
    },
    reporterId: 7,
    attendanceKnown: true,
    attendance: [{
      userId: 3,
      name: "Prakash Teacher",
      role: "teacher",
      firstJoinedAt: new Date(START + 13 * 60_000),
      lastSeenAt: new Date(START + 55 * 60_000),
      presentMs: 37 * 60_000,
      joinCount: 3,
      drawCount: 12,
      messageCount: 2,
    }],
    enrollments: [{
      userId: 7,
      name: "Sita",
      enrolledAt: new Date(START - 60 * 60_000),
      paymentStatus: "paid",
      paymentMethod: "khalti",
      paymentReference: "pay-123",
    }],
    scheduleChanges: [],
    messages: [{
      senderName: "Prakash Teacher",
      senderRole: "teacher",
      body: "Please bring your workbook.",
      createdAt: new Date(START - 30 * 60_000),
    }],
    formatTime: fmt,
    ...over,
  };
}

function detail(result: ReturnType<typeof buildSessionCaseNarrative>, code: string): string {
  return result.summary.find((line) => line.code === code)?.detail ?? "";
}

function proof(over: Partial<SessionProofSummary> = {}): SessionProofSummary {
  return {
    timeline: [],
    people: [{
      userId: 3,
      name: "Prakash Teacher",
      role: "teacher",
      presentMs: { available: true, value: 37 * 60_000 },
      joinCount: { available: true, value: 3 },
      drawCount: { available: true, value: 12 },
      messageCount: { available: true, value: 2 },
      providerJoinCount: { available: true, value: 1 },
      reportedReconnects: { available: false, because: "This device reported nothing." },
      qualityBuckets: { available: false, because: "This device reported nothing." },
      confidence: "corroborated",
    }],
    providerSawMeeting: { available: true, value: true },
    providerMeetings: [{
      meetingId: "internal-meeting-id",
      startedAtMs: START + 12 * 60_000,
      endedAtMs: START + 54 * 60_000,
      spanMs: { available: true, value: 42 * 60_000 },
    }],
    providerMeetingSpanMs: { available: true, value: 42 * 60_000 },
    sources: { ledger: true, provider: true, telemetry: false },
    caveats: ["Provider times are supporting evidence and may be approximate."],
    ...over,
  };
}

test("the summary is tied to the unique session and names its actual listing", () => {
  const result = buildSessionCaseNarrative(input());
  assert.equal(result.sessionId, 91);
  assert.match(detail(result, "created"), /session #91/);
  assert.match(detail(result, "created"), /“Fractions” in Mathematics/);
});

test("a stored payment reference is not called independent settlement confirmation", () => {
  const result = buildSessionCaseNarrative(input());
  assert.match(detail(result, "reporter_booking"), /marks NPR 500.*as paid/);
  assert.match(detail(result, "reporter_booking"), /has not independently reconciled/);
});

test("test access is never described as a payment", () => {
  const enrollment = { ...input().enrollments[0], paymentStatus: "test", paymentReference: null };
  const result = buildSessionCaseNarrative(input({ enrollments: [enrollment] }));
  assert.match(detail(result, "reporter_booking"), /No payment was processed/);
  assert.doesNotMatch(detail(result, "reporter_booking"), /marks NPR 500.*paid/);
});

test("late start and early end are measured against the booked slot", () => {
  const result = buildSessionCaseNarrative(input());
  assert.match(detail(result, "class_started"), /13 minutes late/);
  assert.match(detail(result, "class_ended"), /5 minutes early/);
});

test("connection gaps use presence rather than inventing quality labels", () => {
  const result = buildSessionCaseNarrative(input());
  assert.match(detail(result, "teacher_attendance"), /2 reconnections/);
  assert.match(detail(result, "teacher_attendance"), /5 disconnected minutes/);
  assert.ok(result.unavailable.some((line) => line.includes("device connection reports were not assembled")));
});

test("whiteboard activity states the limits of the existing counter", () => {
  const result = buildSessionCaseNarrative(input());
  assert.match(detail(result, "teacher_classroom_activity"), /12 accepted whiteboard changes/);
  assert.match(detail(result, "teacher_classroom_activity"), /does not store the first drawing time, clears, or tool types/);
});

test("persistent teacher messages before class are quoted and placed on the timeline", () => {
  const result = buildSessionCaseNarrative(input());
  assert.match(detail(result, "teacher_message_before_class"), /“Please bring your workbook.”/);
  assert.ok(result.timeline.some((entry) => entry.code === "class_message_sent"));
});

test("unreadable attendance is unavailable rather than nobody attended", () => {
  const result = buildSessionCaseNarrative(input({ attendanceKnown: false, attendance: [] }));
  assert.match(detail(result, "attendance_unavailable"), /not evidence that nobody attended/);
  assert.equal(detail(result, "teacher_not_in_ledger"), "");
});

test("a missing reporter booking is shown plainly", () => {
  const result = buildSessionCaseNarrative(input({ enrollments: [] }));
  assert.match(detail(result, "reporter_booking_missing"), /No booking record/);
});

test("timeline entries are sorted rather than grouped by database source", () => {
  const result = buildSessionCaseNarrative(input({
    scheduleChanges: [{
      previousDate: new Date(START - 60_000),
      newDate: new Date(START),
      affectedStudents: 1,
      changedAt: new Date(START - 2 * 60 * 60_000),
    }],
  }));
  const times = result.timeline.map((entry) => new Date(entry.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("the missing instrumentation is disclosed explicitly", () => {
  const result = buildSessionCaseNarrative(input());
  assert.ok(result.unavailable.some((line) => line.includes("Camera, microphone")));
  assert.ok(result.unavailable.some((line) => line.includes("read/seen")));
  assert.ok(result.unavailable.some((line) => line.includes("video-provider records")));
});

test("named socket and provider observations are explained as source agreement only", () => {
  const result = buildSessionCaseNarrative(input({ proof: proof({
    timeline: [
      {
        atMs: START + 13 * 60_000,
        code: "provider_participant_joined",
        source: "provider",
        userId: 3,
        detail: "The provider recorded user 3 joining (meeting internal-meeting-id).",
      },
      {
        atMs: START + 14 * 60_000,
        code: "connection_degraded",
        source: "client-telemetry",
        userId: 3,
        detail: "A device reported its connection as warning.",
      },
    ],
  }) }));
  const account = detail(result, "participant_source_account_1");
  assert.match(account, /Two sources recorded Prakash Teacher/);
  assert.match(account, /source agreement about presence only/);
  assert.ok(result.timeline.some((line) =>
    line.source === "video-provider" && line.detail === "The video provider recorded Prakash Teacher joining the meeting."));
  assert.ok(result.timeline.some((line) =>
    line.source === "device-report" && line.detail === "Prakash Teacher's device reported its connection as warning."));
  assert.doesNotMatch(JSON.stringify(result), /internal-meeting-id/);
});

test("a named-provider disagreement is prominent and does not guess the cause", () => {
  const disagreeing = proof({
    people: [{ ...proof().people[0]!, providerJoinCount: { available: true, value: 0 }, confidence: "single-source" }],
  });
  const result = buildSessionCaseNarrative(input({ proof: disagreeing }));
  const account = detail(result, "participant_source_account_1");
  assert.match(account, /sources do not agree/);
  assert.match(account, /does not identify why/);
});

test("unavailable provider and telemetry sources never become zero observations", () => {
  const unavailableProof = proof({
    people: [{
      ...proof().people[0]!,
      providerJoinCount: { available: false, because: "Provider events unavailable." },
      reportedReconnects: { available: false, because: "Device reports unavailable." },
      qualityBuckets: { available: false, because: "Device reports unavailable." },
      confidence: "single-source",
    }],
    providerSawMeeting: { available: false, because: "Provider events unavailable." },
    providerMeetings: [],
    providerMeetingSpanMs: { available: false, because: "Provider events unavailable." },
    sources: { ledger: true, provider: false, telemetry: false },
    caveats: [],
  });
  const result = buildSessionCaseNarrative(input({ proof: unavailableProof }));
  assert.ok(result.unavailable.some((line) => /video-provider record is unavailable/i.test(line)));
  assert.ok(result.unavailable.some((line) => /device connection reports are unavailable/i.test(line)));
  assert.doesNotMatch(result.summary.map((line) => line.detail).join(" "), /provider recorded 0|device reported 0/i);
});

test("an unavailable ledger is not described as a readable source conflict", () => {
  const providerOnly = proof({
    people: [{
      ...proof().people[0]!,
      presentMs: { available: false, because: "Ledger unavailable." },
      joinCount: { available: false, because: "Ledger unavailable." },
      drawCount: { available: false, because: "Ledger unavailable." },
      messageCount: { available: false, because: "Ledger unavailable." },
      providerJoinCount: { available: true, value: 1 },
      confidence: "single-source",
    }],
    sources: { ledger: false, provider: true, telemetry: false },
  });
  const result = buildSessionCaseNarrative(input({ proof: providerOnly }));
  const account = detail(result, "participant_source_account_1");
  assert.match(account, /video provider named Prakash Teacher/);
  assert.match(account, /ledger was unavailable/);
  assert.doesNotMatch(account, /sources do not agree/);
});

test("multiple provider meetings remain separate and use deterministic Nepal-time wording", () => {
  const multiple = proof({
    providerMeetings: [
      { meetingId: "first-private-id", startedAtMs: START, endedAtMs: START + 20 * 60_000, spanMs: { available: true, value: 20 * 60_000 } },
      { meetingId: "second-private-id", startedAtMs: START + 40 * 60_000, endedAtMs: null, spanMs: { available: false, because: "No end." } },
    ],
    providerMeetingSpanMs: { available: false, because: "Separate meetings." },
  });
  const result = buildSessionCaseNarrative(input({ proof: multiple, formatTime: undefined }));
  const repeated = buildSessionCaseNarrative(input({ proof: multiple, formatTime: undefined }));
  assert.deepEqual(result, repeated);
  assert.match(detail(result, "provider_meeting_count"), /2 separate meeting instances/);
  assert.match(detail(result, "provider_meeting_1"), /20 minutes/);
  assert.match(detail(result, "provider_meeting_2"), /end time was not supplied/);
  assert.match(detail(result, "provider_meeting_1"), /Nepal time/);
  assert.doesNotMatch(JSON.stringify(result), /first-private-id|second-private-id/);
});

test("coarse device evidence is labelled self-reported and never exposes diagnostics", () => {
  const teacher = {
    ...proof().people[0]!,
    reportedReconnects: { available: true as const, value: 2 },
    qualityBuckets: { available: true as const, value: { good: 3, warning: 1, bad: 2, unknown: 0 } },
  };
  const result = buildSessionCaseNarrative(input({
    proof: proof({ people: [teacher], sources: { ledger: true, provider: true, telemetry: true } }),
  }));
  const quality = detail(result, "device_quality_1");
  assert.match(quality, /3 good, 1 warning, 2 bad/);
  assert.match(quality, /own device/);
  assert.doesNotMatch(quality, /jitter|packet|bitrate|\bIP\b|device id/i);
});

test("the combined account contains no decision language", () => {
  const result = buildSessionCaseNarrative(input({ proof: proof() }));
  const words = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["refund", "recommend", "verdict", "should be", "at fault", "entitled"]) {
    assert.ok(!words.includes(forbidden), `"${forbidden}" must not appear in a session account`);
  }
});
