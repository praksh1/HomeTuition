import type { ProgramAllocationEvent, ProgramAllocationState } from "./programCommerce.ts";

/** A case label alone is never a payment verdict. This projection contains no private notes. */
export interface RemedyFinancialFacts {
  id: number;
  originalSessionId: number;
  status: string;
  outcome: string | null;
  replacementSessionId: number | null;
  replacementReviewClosesAt: Date | null;
}

export function remedyHoldsAllocation(remedy: RemedyFinancialFacts, nowMs = Date.now()): boolean {
  if (remedy.status === "withdrawn") return false;
  if (remedy.status === "resolved" && remedy.outcome === "no_adjustment") return false;
  const delivered = remedy.status === "delivered_review" ||
    (remedy.status === "resolved" && remedy.outcome === "replacement_delivered");
  return !delivered || remedy.replacementSessionId === null ||
    !remedy.replacementReviewClosesAt || !Number.isFinite(remedy.replacementReviewClosesAt.getTime()) ||
    nowMs < remedy.replacementReviewClosesAt.getTime();
}

/** All generic operator actions must obey the case's independently recorded review clock. */
export function assertRemedyFinancialEvent(remedy: RemedyFinancialFacts | undefined, event: ProgramAllocationEvent, nowMs = Date.now()): void {
  if (!remedy) return;
  if (["replacement_scheduled", "lesson_delivered", "complaint_window_closed", "makeup_requested", "makeup_delivery_confirmed", "makeup_withdrawn", "makeup_review_restored"].includes(event)) {
    throw Error("Use the linked make-up review, not a ledger-only delivery or replacement action.");
  }
  if ((event === "payout_confirmed" || event === "complaint_denied") && remedyHoldsAllocation(remedy, nowMs)) {
    throw Error("This lesson's original allocation is held for its make-up or review. No payout was recorded.");
  }
}

/** Human refund decisions use the original allocation, never the replacement's zero price. */
export function originalAllocationRefundEvents(state: ProgramAllocationState): ProgramAllocationEvent[] {
  switch (state) {
    case "future": return ["lesson_cancelled", "refund_approved"];
    case "replacement_pending": return ["refund_approved"];
    case "delivered_pending":
    case "eligible": return ["complaint_opened", "complaint_upheld"];
    case "disputed": return ["complaint_upheld"];
    case "refund_owed":
    case "refunded": return [];
    case "paid_out": throw Error("Support must reconcile the already-paid allocation before a refund can be recorded.");
  }
}

export function replacementAllocationAdmits(state: string): boolean {
  // Unknown/corrupt states fail closed; an accepted seat cannot survive original refund approval.
  return ["future", "replacement_pending", "delivered_pending", "disputed", "eligible"].includes(state);
}
