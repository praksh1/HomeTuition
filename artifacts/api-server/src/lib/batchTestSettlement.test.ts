import assert from "node:assert/strict";
import test from "node:test";
import { automaticBatchTestEvents, batchTestNeedsHumanAttention } from "./batchTestSettlement.ts";

const HOUR = 60 * 60_000;
const base = {
  state: "future" as const,
  sessionStatus: "upcoming",
  scheduledStartMs: 1_000_000,
  durationMinutes: 60,
  teacherPresenceRecorded: false,
  activeComplaint: false,
  nowMs: 1_000_000,
};

test("a requested, offered or unresolved make-up holds the original allocation", () => {
  for (const status of ["requested", "offered", "accepted", "review_required"] as const) {
    assert.deepEqual(automaticBatchTestEvents({ ...base, sessionStatus: "completed", teacherPresenceRecorded: true,
      nowMs: base.scheduledStartMs + 60 * HOUR, evidenceSessionId: 91,
      remedy: { status, originalSessionId: 17, acceptedReplacementSessionId: 91 } }), []);
  }
});

test("only confirmed replacement delivery uses replacement evidence and its fresh review clock", () => {
  const facts = { ...base, sessionStatus: "completed", teacherPresenceRecorded: true,
    remedy: { status: "delivered_review" as const, originalSessionId: 17, acceptedReplacementSessionId: 91 } };
  assert.deepEqual(automaticBatchTestEvents({ ...facts, evidenceSessionId: 17 }), []);
  assert.deepEqual(automaticBatchTestEvents(facts), []); // Missing target identity is not a fallback.
  assert.deepEqual(automaticBatchTestEvents({ ...facts, evidenceSessionId: 91 }), ["lesson_delivered"]);
  assert.deepEqual(automaticBatchTestEvents({ ...facts, evidenceSessionId: 91, nowMs: base.scheduledStartMs + 49 * HOUR }), ["lesson_delivered", "complaint_window_closed"]);
  assert.deepEqual(automaticBatchTestEvents({ ...facts, evidenceSessionId: 91, activeComplaint: true }), ["lesson_delivered", "complaint_opened"]);
});

test("a teacher or operator cannot manufacture delivery from a completed label alone", () => {
  assert.deepEqual(automaticBatchTestEvents({ ...base, sessionStatus: "completed" }), []);
});

test("recorded teacher presence plus completion starts the review automatically", () => {
  assert.deepEqual(automaticBatchTestEvents({ ...base, sessionStatus: "completed", teacherPresenceRecorded: true }), ["lesson_delivered"]);
});

test("a completed old lesson passes delivery and review in one deterministic sync", () => {
  assert.deepEqual(automaticBatchTestEvents({ ...base, sessionStatus: "completed", teacherPresenceRecorded: true, nowMs: base.scheduledStartMs + 49 * HOUR }), ["lesson_delivered", "complaint_window_closed"]);
});

test("the review stays open until exactly 48 hours after the scheduled finish", () => {
  const scheduledEnd = base.scheduledStartMs + HOUR;
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "delivered_pending", nowMs: scheduledEnd + 48 * HOUR - 1 }), []);
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "delivered_pending", nowMs: scheduledEnd + 48 * HOUR }), ["complaint_window_closed"]);
});

test("a lesson that ends late keeps the student's full 48-hour review window", () => {
  const scheduledEnd = base.scheduledStartMs + HOUR;
  const actualEnd = scheduledEnd + 3 * HOUR;
  assert.deepEqual(automaticBatchTestEvents({ ...base, sessionStatus: "completed", teacherPresenceRecorded: true, actualEndMs: actualEnd, nowMs: scheduledEnd + 48 * HOUR }), ["lesson_delivered"]);
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "delivered_pending", actualEndMs: actualEnd, nowMs: scheduledEnd + 48 * HOUR }), []);
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "delivered_pending", actualEndMs: actualEnd, nowMs: actualEnd + 48 * HOUR - 1 }), []);
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "delivered_pending", actualEndMs: actualEnd, nowMs: actualEnd + 48 * HOUR }), ["complaint_window_closed"]);
});

test("a student complaint freezes a delivered or eligible lesson", () => {
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "delivered_pending", activeComplaint: true }), ["complaint_opened"]);
  assert.deepEqual(automaticBatchTestEvents({ ...base, state: "eligible", activeComplaint: true }), ["complaint_opened"]);
});

test("teacher cancellation creates a replacement or refund exception", () => {
  assert.deepEqual(automaticBatchTestEvents({ ...base, sessionStatus: "cancelled" }), ["lesson_cancelled"]);
  assert.equal(batchTestNeedsHumanAttention("replacement_pending"), true);
});

test("ordinary states never appear in the operator exception queue", () => {
  for (const state of ["future", "delivered_pending", "eligible", "paid_out", "refund_owed", "refunded"]) {
    assert.equal(batchTestNeedsHumanAttention(state), false);
  }
  assert.equal(batchTestNeedsHumanAttention("disputed"), true);
});
