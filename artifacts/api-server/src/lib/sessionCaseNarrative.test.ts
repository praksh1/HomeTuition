import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionCaseNarrative, type NarrativeInput } from "./sessionCaseNarrative.ts";

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
  assert.ok(result.unavailable.some((line) => line.includes("strong, moderate or weak")));
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
  assert.ok(result.unavailable.some((line) => line.includes("Daily audio or video")));
});
