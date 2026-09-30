import assert from "node:assert/strict";
import { test } from "node:test";
import { assessMakeupOffer, makeupOfferStillAcceptable } from "./makeupPolicy.ts";

const DAY = 86_400_000;
const originalEndsAtMs = Date.parse("2026-10-01T12:00:00Z");
const nowMs = originalEndsAtMs + DAY;
const base = {
  bookingId: 17, originalSessionId: 41, originalEndsAtMs, nowMs,
  replacementStartsAtMs: nowMs + DAY,
  replacementEndsAtMs: nowMs + DAY + 3_600_000,
  reason: "student_missed" as const, teacherApproved: true, previousCourtesyOffers: 0,
};

test("one approved student courtesy offer has a seven-day acceptance window and held payout", () => {
  const result = assessMakeupOffer(base);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.offerExpiresAtMs, nowMs + 7 * DAY);
  assert.equal(result.replacementDeadlineMs, originalEndsAtMs + 30 * DAY);
  assert.equal(result.needsStudentAcceptance, true);
  assert.equal(result.payoutHeldUntilDeliveryAndReview, true);
  assert.equal(makeupOfferStillAcceptable(result.offerExpiresAtMs, base.replacementStartsAtMs, base.replacementStartsAtMs - 1), true);
  assert.equal(makeupOfferStillAcceptable(result.offerExpiresAtMs, base.replacementStartsAtMs, base.replacementStartsAtMs), false);
  assert.equal(makeupOfferStillAcceptable(result.offerExpiresAtMs, result.offerExpiresAtMs + DAY, result.offerExpiresAtMs), false);
});

test("a second courtesy offer or an unapproved one is refused", () => {
  assert.equal(assessMakeupOffer({ ...base, previousCourtesyOffers: 1 }).ok, false);
  assert.equal(assessMakeupOffer({ ...base, teacherApproved: false }).ok, false);
});

test("teacher non-delivery preserves refund review even when a replacement is offered", () => {
  const result = assessMakeupOffer({ ...base, reason: "teacher_missed" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.refundReviewPreserved, true);
});

test("replacement must be in the future and finish within 30 days", () => {
  assert.equal(assessMakeupOffer({ ...base, replacementStartsAtMs: nowMs }).ok, false);
  assert.equal(assessMakeupOffer({ ...base, replacementStartsAtMs: originalEndsAtMs }).ok, false);
  assert.equal(assessMakeupOffer({ ...base, replacementEndsAtMs: originalEndsAtMs + 30 * DAY + 1 }).ok, false);
  assert.equal(assessMakeupOffer({ ...base, replacementStartsAtMs: originalEndsAtMs + 30 * DAY - 3_600_000, replacementEndsAtMs: originalEndsAtMs + 30 * DAY }).ok, true);
});

test("invalid reasons and corrupt courtesy counts cannot authorize a replacement", () => {
  assert.equal(assessMakeupOffer({ ...base, reason: "other" as "student_missed" }).ok, false);
  assert.equal(assessMakeupOffer({ ...base, previousCourtesyOffers: -1 }).ok, false);
  assert.equal(assessMakeupOffer({ ...base, previousCourtesyOffers: Number.NaN }).ok, false);
});
