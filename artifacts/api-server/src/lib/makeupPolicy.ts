/**
 * A replacement is a remedy for one booked student's original lesson, never a second sale.
 * This module only validates an offer; a database transaction must still lock the original
 * booking/allocation, create the linked lesson, check timetable conflicts and hold payout.
 */
export const MAKEUP_OFFER_HOURS = 7 * 24;
export const MAKEUP_LESSON_DAYS = 30;

export type MakeupReason = "student_missed" | "teacher_missed";

export interface MakeupOfferFacts {
  bookingId: number;
  originalSessionId: number;
  originalEndsAtMs: number;
  replacementStartsAtMs: number;
  replacementEndsAtMs: number;
  nowMs: number;
  reason: MakeupReason;
  teacherApproved: boolean;
  previousCourtesyOffers: number;
}

export type MakeupOfferDecision =
  | { ok: false; reason: string }
  | {
      ok: true;
      offerExpiresAtMs: number;
      replacementDeadlineMs: number;
      needsStudentAcceptance: true;
      payoutHeldUntilDeliveryAndReview: true;
      /** Review remains available; this is not a promise that a student no-show earns a refund. */
      refundReviewPreserved: true;
    };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function assessMakeupOffer(facts: MakeupOfferFacts): MakeupOfferDecision {
  if (![facts.bookingId, facts.originalSessionId].every((value) => Number.isSafeInteger(value) && value > 0) ||
      ![facts.originalEndsAtMs, facts.replacementStartsAtMs, facts.replacementEndsAtMs, facts.nowMs]
        .every(Number.isFinite) ||
      !Number.isSafeInteger(facts.previousCourtesyOffers) || facts.previousCourtesyOffers < 0 ||
      !["student_missed", "teacher_missed"].includes(facts.reason)) {
    return { ok: false, reason: "Choose a valid booked lesson and replacement time." };
  }
  if (facts.reason === "student_missed" && (!facts.teacherApproved || facts.previousCourtesyOffers > 0)) {
    return { ok: false, reason: "A missed student lesson needs the teacher's approval and has one courtesy offer maximum." };
  }
  if (facts.reason === "teacher_missed" && !facts.teacherApproved) {
    return { ok: false, reason: "The teacher must confirm a replacement offer; the student's refund-review option remains open." };
  }
  if (facts.replacementStartsAtMs <= Math.max(facts.nowMs, facts.originalEndsAtMs) ||
      facts.replacementEndsAtMs <= facts.replacementStartsAtMs) {
    return { ok: false, reason: "Choose a future replacement lesson with an end time." };
  }
  const deadline = facts.originalEndsAtMs + MAKEUP_LESSON_DAYS * DAY;
  if (facts.replacementEndsAtMs > deadline) {
    return { ok: false, reason: "The replacement must finish within 30 days of the original lesson." };
  }
  return {
    ok: true,
    offerExpiresAtMs: facts.nowMs + MAKEUP_OFFER_HOURS * HOUR,
    replacementDeadlineMs: deadline,
    needsStudentAcceptance: true,
    payoutHeldUntilDeliveryAndReview: true,
    refundReviewPreserved: true,
  };
}

/** Expiry never counts as a delivered lesson or an automatic refund. */
export function makeupOfferStillAcceptable(expiresAtMs: number, replacementStartsAtMs: number, nowMs: number): boolean {
  return [expiresAtMs, replacementStartsAtMs, nowMs].every(Number.isFinite) &&
    nowMs < Math.min(expiresAtMs, replacementStartsAtMs);
}
