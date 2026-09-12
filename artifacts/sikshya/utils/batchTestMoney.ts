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
    grossNpr?: number;
    teacherNpr?: number;
    state: string;
    stateChangedAt?: string;
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

const pendingEarningStates = new Set(["future", "delivered_pending", "eligible"]);

/** One arithmetic definition for the student and teacher summaries. */
export function participantTestTotals(receipts: ParticipantTestReceipt[]): ParticipantTestTotals {
  return receipts.reduce<ParticipantTestTotals>((totals, receipt) => {
    totals.grossNpr += receipt.grossNpr ?? 0;
    totals.teacherShareNpr += receipt.allocations
      .reduce((sum, allocation) => sum + (allocation.teacherNpr ?? 0), 0);
    totals.teacherHeldNpr += receipt.allocations
      .filter((allocation) => pendingEarningStates.has(allocation.state))
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

export interface ParticipantMoneyStatementRow {
  id: string;
  section: "pending" | "posted";
  title: string;
  detail: string;
  occurredAt: string;
  amountNpr: number;
  direction: "credit" | "debit" | "neutral";
  status: string;
}

export interface ParticipantMoneyStatement {
  pending: ParticipantMoneyStatementRow[];
  posted: ParticipantMoneyStatementRow[];
}

function newest(values: Array<string | undefined>, fallback: string): string {
  return values.filter((value): value is string => !!value)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? fallback;
}

function newestFirst(a: ParticipantMoneyStatementRow, b: ParticipantMoneyStatementRow): number {
  return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
}

function recordedMoney(value: number | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Turns participant-safe receipts into a bank-statement shape. A payment and its refund remain
 * separate transactions, so a refund never silently rewrites the amount the student originally
 * paid. Teacher pending money is separated from posted payouts and reversals.
 */
export function participantMoneyStatement(
  receipts: ParticipantTestReceipt[],
  role: "student" | "teacher",
): ParticipantMoneyStatement {
  const rows: ParticipantMoneyStatementRow[] = [];
  for (const receipt of receipts) {
    if (role === "student") {
      const payment = recordedMoney(receipt.grossNpr);
      if (payment !== null) {
        rows.push({
          id: `${receipt.bookingId}-payment`,
          section: "posted",
          title: receipt.classTitle,
          detail: `Test payment · Receipt ${receipt.reference}`,
          occurredAt: receipt.recordedAt,
          amountNpr: payment,
          direction: "debit",
          status: "Paid",
        });
      }
      for (const allocation of receipt.allocations.filter((row) => row.state === "refund_owed" || row.state === "refunded")) {
        const refund = recordedMoney(allocation.grossNpr);
        if (refund === null) continue;
        const posted = allocation.state === "refunded";
        rows.push({
          id: `${receipt.bookingId}-refund-${allocation.position}`,
          section: posted ? "posted" : "pending",
          title: receipt.classTitle,
          detail: `Test refund · Lesson ${allocation.position + 1} · Receipt ${receipt.reference}`,
          occurredAt: allocation.stateChangedAt ?? receipt.recordedAt,
          amountNpr: refund,
          direction: "credit",
          status: posted ? "Refunded" : "Refund pending",
        });
      }
      continue;
    }

    const pending = receipt.allocations.filter((row) => pendingEarningStates.has(row.state));
    const review = receipt.allocations.filter((row) => row.state === "disputed" || row.state === "replacement_pending");
    const reversalPending = receipt.allocations.filter((row) => row.state === "refund_owed");
    const paid = receipt.allocations.filter((row) => row.state === "paid_out");
    const reversed = receipt.allocations.filter((row) => row.state === "refunded");
    const student = receipt.studentName ?? "Student name unavailable";
    const teacherRow = (
      kind: string,
      source: typeof receipt.allocations,
      section: "pending" | "posted",
      direction: ParticipantMoneyStatementRow["direction"],
      status: string,
    ) => {
      if (!source.length) return;
      const amount = source.reduce((sum, row) => sum + (recordedMoney(row.teacherNpr) ?? 0), 0);
      if (amount <= 0) return;
      rows.push({
        id: `${receipt.bookingId}-${kind}`,
        section,
        title: receipt.classTitle,
        detail: `${student} · Receipt ${receipt.reference}`,
        occurredAt: newest(source.map((row) => row.stateChangedAt), receipt.recordedAt),
        amountNpr: amount,
        direction,
        status,
      });
    };
    teacherRow("pending", pending, "pending", "neutral", "Pending");
    teacherRow("review", review, "pending", "neutral", "Under review");
    teacherRow("reversal-pending", reversalPending, "pending", "debit", "Reversal pending");
    teacherRow("paid", paid, "posted", "credit", "Paid to you");
    teacherRow("reversed", reversed, "posted", "debit", "Reversed after refund");
  }
  return {
    pending: rows.filter((row) => row.section === "pending").sort(newestFirst),
    posted: rows.filter((row) => row.section === "posted").sort(newestFirst),
  };
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
