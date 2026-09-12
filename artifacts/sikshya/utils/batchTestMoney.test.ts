import assert from "node:assert/strict";
import test from "node:test";
import { participantTestTotals, type ParticipantTestReceipt } from "./batchTestMoney.ts";

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
      { position: 0, teacherNpr: 350, state: "future" },
      { position: 1, teacherNpr: 350, state: "paid_out" },
    ],
    accounting: {
      heldGrossNpr: 500,
      teacherPaidOutNpr: 350,
      fadkoEarnedNpr: 150,
      refundedGrossNpr: 0,
      actualMoneyMovedNpr: 0,
    },
    ...over,
  };
}

test("participant summary adds captured, held, paid and refunded values", () => {
  const totals = participantTestTotals([
    receipt(),
    receipt({
      bookingId: 2,
      grossNpr: 600,
      allocations: [{ position: 0, teacherNpr: 420, state: "refunded" }],
      accounting: {
        heldGrossNpr: 0,
        teacherPaidOutNpr: 0,
        fadkoEarnedNpr: 0,
        refundedGrossNpr: 600,
        actualMoneyMovedNpr: 0,
      },
    }),
  ]);
  assert.deepEqual(totals, {
    grossNpr: 1_600,
    heldGrossNpr: 500,
    teacherHeldNpr: 350,
    teacherPaidOutNpr: 350,
    fadkoEarnedNpr: 150,
    refundedGrossNpr: 600,
    actualMoneyMovedNpr: 0,
  });
});

test("an empty real result stays an honest zero summary", () => {
  assert.deepEqual(participantTestTotals([]), {
    grossNpr: 0,
    heldGrossNpr: 0,
    teacherHeldNpr: 0,
    teacherPaidOutNpr: 0,
    fadkoEarnedNpr: 0,
    refundedGrossNpr: 0,
    actualMoneyMovedNpr: 0,
  });
});
