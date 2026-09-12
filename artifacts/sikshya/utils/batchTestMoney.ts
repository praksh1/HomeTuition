export interface ParticipantTestReceipt {
  bookingId: number;
  batchId: number;
  reference: string;
  classTitle: string;
  studentName: string;
  recordedAt: string;
  grossNpr: number;
  allocations: Array<{
    position: number;
    teacherNpr: number;
    state: string;
  }>;
  accounting: {
    heldGrossNpr: number;
    teacherPaidOutNpr: number;
    fadkoEarnedNpr: number;
    refundedGrossNpr: number;
    actualMoneyMovedNpr: number;
  };
}

export interface ParticipantTestTotals {
  grossNpr: number;
  heldGrossNpr: number;
  teacherHeldNpr: number;
  teacherPaidOutNpr: number;
  fadkoEarnedNpr: number;
  refundedGrossNpr: number;
  actualMoneyMovedNpr: number;
}

const terminal = new Set(["paid_out", "refunded"]);

/** One arithmetic definition for the student and teacher summaries. */
export function participantTestTotals(receipts: ParticipantTestReceipt[]): ParticipantTestTotals {
  return receipts.reduce<ParticipantTestTotals>((totals, receipt) => {
    totals.grossNpr += receipt.grossNpr;
    totals.heldGrossNpr += receipt.accounting.heldGrossNpr;
    totals.teacherHeldNpr += receipt.allocations
      .filter((allocation) => !terminal.has(allocation.state))
      .reduce((sum, allocation) => sum + allocation.teacherNpr, 0);
    totals.teacherPaidOutNpr += receipt.accounting.teacherPaidOutNpr;
    totals.fadkoEarnedNpr += receipt.accounting.fadkoEarnedNpr;
    totals.refundedGrossNpr += receipt.accounting.refundedGrossNpr;
    totals.actualMoneyMovedNpr += receipt.accounting.actualMoneyMovedNpr;
    return totals;
  }, {
    grossNpr: 0,
    heldGrossNpr: 0,
    teacherHeldNpr: 0,
    teacherPaidOutNpr: 0,
    fadkoEarnedNpr: 0,
    refundedGrossNpr: 0,
    actualMoneyMovedNpr: 0,
  });
}
