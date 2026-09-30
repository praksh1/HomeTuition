import assert from "node:assert/strict";
import test from "node:test";
import {
  LessonRemedyError,
  assessRemedyAcceptance,
  assessRemedyRequest,
  courtesyAllowanceUse,
  snapshotLessonRemedyPolicy,
} from "./lessonRemedies.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const start = Date.parse("2026-10-01T04:15:00Z");
const end = start + HOUR;
const policy = snapshotLessonRemedyPolicy("monthly_tuition", 30);
const request = {
  policy,
  reason: "student_missed" as const,
  originalLessonPurchased: true,
  originalIsReplacement: false,
  originalScheduledStartMs: start,
  originalScheduledEndMs: end,
  originalActualEndMs: null,
  nowMs: end + HOUR,
  courtesyUsedOrReserved: 0,
  allocationState: "delivered_pending",
};
const accepted = {
  reason: "student_missed" as const,
  status: "accepted" as const,
  acceptedAtMs: end,
  teacherFailedReplacement: false,
};
const acceptance = {
  status: "offered" as const,
  offerStatus: "proposed" as const,
  allocationState: "replacement_pending",
  nowMs: end,
  expiresAtMs: end + 7 * DAY,
  replacementStartsAtMs: end + DAY,
  replacementEndsAtMs: end + DAY + HOUR,
  originalScheduledEndMs: end,
  originalDurationMinutes: 60,
  acceptedReplacementSessionId: null,
  refundReviewPending: false,
};

test("corrupt ownership/replacement booleans cannot authorize a remedy request", () => {
  const corrupt = [undefined, null, 0, 1, "false", "true", {}, []] as unknown as boolean[];
  for (const value of corrupt) {
    assert.throws(() => assessRemedyRequest({ ...request, originalLessonPurchased: value }), LessonRemedyError);
    assert.throws(() => assessRemedyRequest({ ...request, originalIsReplacement: value }), LessonRemedyError);
  }
});

test("a corrupt teacher-failure flag cannot erase an accepted courtesy use", () => {
  const corrupt = [undefined, null, 0, 1, "false", "true", {}, []] as unknown as boolean[];
  for (const teacherFailedReplacement of corrupt) {
    assert.throws(() => courtesyAllowanceUse({ ...accepted, teacherFailedReplacement }), LessonRemedyError);
  }
  assert.equal(courtesyAllowanceUse(accepted), 1);
  assert.equal(courtesyAllowanceUse({ ...accepted, teacherFailedReplacement: true }), 0);
});

test("unknown refund-review status cannot grant replacement acceptance", () => {
  const corrupt = [undefined, null, 0, 1, "false", "true", {}, []] as unknown as boolean[];
  for (const refundReviewPending of corrupt) {
    assert.throws(() => assessRemedyAcceptance({ ...acceptance, refundReviewPending }), LessonRemedyError);
  }
  assert.equal(assessRemedyAcceptance(acceptance), "accept");
});
