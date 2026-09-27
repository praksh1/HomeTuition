/** Closure is a customer request, not a suspension, refund, or automatic data wipe. */
export interface ClosureCommitments {
  upcomingLessons: number;
  pendingPayments: number;
  openDisputes: number;
  pendingMakeups: number;
  /** Every source must be checked; missing data is never zero obligations. */
  complete: boolean;
}
export function closureBlockers(value: ClosureCommitments): string[] {
  if (!value.complete || [value.upcomingLessons,value.pendingPayments,value.openDisputes,value.pendingMakeups]
    .some(n => !Number.isSafeInteger(n) || n < 0)) return ["review_unavailable"];
  const blockers: string[] = [];
  if (value.upcomingLessons) blockers.push("upcoming_lessons");
  if (value.pendingPayments) blockers.push("pending_payments");
  if (value.openDisputes) blockers.push("open_disputes");
  if (value.pendingMakeups) blockers.push("pending_makeups");
  return blockers;
}
export function mayCompleteClosure(input: {
  status: string; version: number; expectedVersion: number;
  requestedBy: number; reviewedBy: number; confirmed: boolean; commitments: ClosureCommitments;
}) {
  if (!input.confirmed || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    || input.version !== input.expectedVersion) return { allowed: false, blockers: ["review_again"] };
  if (input.status !== "requested") return { allowed: false, blockers: ["request_not_open"] };
  if (!Number.isSafeInteger(input.reviewedBy) || input.reviewedBy <= 0 || input.requestedBy === input.reviewedBy)
    return { allowed: false, blockers: ["independent_review_required"] };
  const blockers = closureBlockers(input.commitments);
  return { allowed: blockers.length === 0, blockers };
}
