export interface ParticipantTestReceipt {
  bookingId: number;
  batchId: number;
  reference: string;
  classTitle: string;
  studentName?: string;
  recordedAt: string;
  grossNpr?: number;
  allocations: Array<{
    position: number;
    teacherNpr?: number;
    state: string;
  }>;
  accounting: {
    teacherPaidOutNpr?: number;
    refundedGrossNpr?: number;
    actualMoneyMovedNpr: number;
  };
}

export interface ParticipantTestTotals {
  grossNpr: number;
  teacherShareNpr: number;
  teacherHeldNpr: number;
  teacherPaidOutNpr: number;
  teacherRefundedNpr: number;
  refundedGrossNpr: number;
  actualMoneyMovedNpr: number;
}

const terminal = new Set(["paid_out", "refunded"]);

/** One arithmetic definition for the student and teacher summaries. */
export function participantTestTotals(receipts: ParticipantTestReceipt[]): ParticipantTestTotals {
  return receipts.reduce<ParticipantTestTotals>((totals, receipt) => {
    totals.grossNpr += receipt.grossNpr ?? 0;
    totals.teacherShareNpr += receipt.allocations
      .reduce((sum, allocation) => sum + (allocation.teacherNpr ?? 0), 0);
    totals.teacherHeldNpr += receipt.allocations
      .filter((allocation) => !terminal.has(allocation.state))
      .reduce((sum, allocation) => sum + (allocation.teacherNpr ?? 0), 0);
    totals.teacherPaidOutNpr += receipt.accounting.teacherPaidOutNpr ?? 0;
    totals.teacherRefundedNpr += receipt.allocations
      .filter((allocation) => allocation.state === "refunded")
      .reduce((sum, allocation) => sum + (allocation.teacherNpr ?? 0), 0);
    totals.refundedGrossNpr += receipt.accounting.refundedGrossNpr ?? 0;
    totals.actualMoneyMovedNpr += receipt.accounting.actualMoneyMovedNpr;
    return totals;
  }, {
    grossNpr: 0,
    teacherShareNpr: 0,
    teacherHeldNpr: 0,
    teacherPaidOutNpr: 0,
    teacherRefundedNpr: 0,
    refundedGrossNpr: 0,
    actualMoneyMovedNpr: 0,
  });
}

export function participantReceiptStatus(
  receipt: ParticipantTestReceipt,
  role: "student" | "teacher",
): string {
  const states = new Set(receipt.allocations.map((allocation) => allocation.state));
  if (states.has("disputed")) return "Support review in progress";
  if (states.has("refund_owed")) return "Refund approved in this test";
  if (states.size === 1 && states.has("refunded")) return role === "teacher" ? "Test earnings reversed" : "Test refund completed";
  if (states.size === 1 && states.has("paid_out")) return role === "teacher" ? "Test-paid" : "Lessons completed";
  if (states.has("replacement_pending")) return "Replacement or refund needed";
  if (states.has("delivered_pending")) return "Lesson review period";
  if (states.has("eligible")) return role === "teacher" ? "Ready for test payout" : "Lesson completed";
  return role === "teacher" ? "Expected earnings pending" : "Test booking confirmed";
}

export function testReceiptNepalTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "Date unavailable";
  return `${new Intl.DateTimeFormat("en-NP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kathmandu",
  }).format(instant)} Nepal time`;
}
