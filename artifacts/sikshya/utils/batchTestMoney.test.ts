import assert from "node:assert/strict";
import test from "node:test";
import {
  participantMoneyStatement,
  participantReceiptStatus,
  participantTestTotals,
  testReceiptNepalTime,
  type ParticipantTestReceipt,
} from "./batchTestMoney.ts";

function receipt(over: Partial<ParticipantTestReceipt> = {}): ParticipantTestReceipt {
  return {
    bookingId: 1,
    batchId: 2,
    reference: "TEST-1",
    classTitle: "SEE Maths",
    studentName: "Asha",
    recordedAt: "2026-09-12T00:00:00.000Z",
    grossNpr: 1_000,
    allocations: [
      { position: 0, grossNpr: 500, teacherNpr: 350, state: "future" },
      { position: 1, grossNpr: 500, teacherNpr: 350, state: "paid_out", stateChangedAt: "2026-09-13T00:00:00.000Z" },
    ],
    accounting: {
      teacherPaidOutNpr: 350,
      refundedGrossNpr: 0,
      actualMoneyMovedNpr: 0,
    },
    ...over,
  };
}

test("participant summary adds student payments and teacher pending, paid and reversed shares", () => {
  const totals = participantTestTotals([
    receipt(),
    receipt({
      bookingId: 2,
      grossNpr: 600,
      allocations: [{ position: 0, grossNpr: 600, teacherNpr: 420, state: "refunded" }],
      accounting: {
        teacherPaidOutNpr: 0,
        refundedGrossNpr: 600,
        actualMoneyMovedNpr: 0,
      },
    }),
  ]);
  assert.deepEqual(totals, {
    grossNpr: 1_600,
    teacherShareNpr: 1_120,
    teacherHeldNpr: 350,
    teacherPaidOutNpr: 350,
    teacherRefundedNpr: 420,
    refundedGrossNpr: 600,
    actualMoneyMovedNpr: 0,
  });
});

test("an empty real result stays an honest zero summary", () => {
  assert.deepEqual(participantTestTotals([]), {
    grossNpr: 0,
    teacherShareNpr: 0,
    teacherHeldNpr: 0,
    teacherPaidOutNpr: 0,
    teacherRefundedNpr: 0,
    refundedGrossNpr: 0,
    actualMoneyMovedNpr: 0,
  });
});

test("participant history describes the user's outcome without exposing internal custody", () => {
  assert.equal(participantReceiptStatus(receipt(), "student"), "Test booking confirmed");
  assert.equal(participantReceiptStatus(receipt(), "teacher"), "Expected earnings pending");
  assert.equal(participantReceiptStatus(receipt({
    allocations: [{ position: 0, teacherNpr: 700, state: "disputed" }],
  }), "student"), "Support review in progress");
  assert.equal(participantReceiptStatus(receipt({
    allocations: [{ position: 0, teacherNpr: 700, state: "refunded" }],
  }), "teacher"), "Test earnings reversed");
});

test("receipt dates use the named Nepal clock", () => {
  assert.match(testReceiptNepalTime("2026-09-12T00:00:00.000Z"), /Nepal time$/);
  assert.equal(testReceiptNepalTime("not-a-date"), "Date unavailable");
});

test("teacher statement puts pending earnings before posted payouts and reversals", () => {
  const statement = participantMoneyStatement([
    receipt(),
    receipt({
      bookingId: 2,
      reference: "TEST-2",
      allocations: [{
        position: 0,
        teacherNpr: 420,
        state: "refunded",
        stateChangedAt: "2026-09-14T00:00:00.000Z",
      }],
      accounting: { teacherPaidOutNpr: 0, actualMoneyMovedNpr: 0 },
    }),
  ], "teacher");
  assert.deepEqual(statement.pending.map((row) => [row.status, row.amountNpr]), [["Pending", 350]]);
  assert.deepEqual(statement.posted.map((row) => [row.status, row.amountNpr]), [
    ["Reversed after refund", 420],
    ["Paid to you", 350],
  ]);
});

test("student statement keeps the original payment and each class refund as separate rows", () => {
  const statement = participantMoneyStatement([receipt({
    allocations: [
      { position: 0, grossNpr: 500, state: "refund_owed", stateChangedAt: "2026-09-13T00:00:00.000Z" },
      { position: 1, grossNpr: 500, state: "refunded", stateChangedAt: "2026-09-14T00:00:00.000Z" },
    ],
    accounting: { refundedGrossNpr: 500, actualMoneyMovedNpr: 0 },
  })], "student");
  assert.deepEqual(statement.pending.map((row) => [row.status, row.amountNpr]), [["Refund pending", 500]]);
  assert.deepEqual(statement.posted.map((row) => [row.status, row.amountNpr]), [
    ["Refunded", 500],
    ["Paid", 1_000],
  ]);
  assert.match(statement.posted[0].detail, /Lesson 2.*TEST-1/);
  assert.equal(statement.posted[0].title, "SEE Maths");
});

test("a malformed participant response never fabricates an NPR zero transaction", () => {
  const student = participantMoneyStatement([receipt({
    grossNpr: undefined,
    allocations: [{ position: 0, state: "refunded" }],
  })], "student");
  const teacher = participantMoneyStatement([receipt({
    allocations: [{ position: 0, state: "future" }],
  })], "teacher");
  assert.deepEqual(student, { pending: [], posted: [] });
  assert.deepEqual(teacher, { pending: [], posted: [] });
});
