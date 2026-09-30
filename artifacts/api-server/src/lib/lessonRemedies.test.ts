import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LessonRemedyError, LESSON_REMEDY_STATUSES, assessRemedyAcceptance, assessRemedyRequest,
  courtesyAllowanceUse, lessonReviewClosesAt, readLessonRemedyPolicy, remedySettlementTarget,
  snapshotLessonRemedyPolicy, transitionLessonRemedy,
  type LessonRemedyActor, type LessonRemedyEvent,
} from "./lessonRemedies.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const start = Date.parse("2026-10-01T04:15:00Z"); // 10:00 Nepal time
const end = start + HOUR;
const policy = snapshotLessonRemedyPolicy("monthly_tuition", 30);
const base = {
  policy, reason: "student_missed" as const,
  originalLessonPurchased: true, originalIsReplacement: false,
  originalScheduledStartMs: start, originalScheduledEndMs: end, originalActualEndMs: null,
  nowMs: start - HOUR, courtesyUsedOrReserved: 0, allocationState: "future",
};

test("monthly allowance is two per purchased period, including a late-join purchase", () => {
  assert.equal(policy.courtesyLimit, 2);
  assert.equal(snapshotLessonRemedyPolicy("monthly_tuition", 7).courtesyLimit, 2);
  assert.equal(policy.noRollover, true);
  assert.equal(policy.teacherApprovalRequired, true);
  assert.equal(policy.missedReplacement, "human_review");
});

test("short-course allowance uses purchased lessons, rounds up and is capped at three", () => {
  for (const [lessons, expected] of [[1, 0], [2, 1], [10, 1], [11, 2], [20, 2], [21, 3], [30, 3], [60, 3]]) {
    assert.equal(snapshotLessonRemedyPolicy("short_course", lessons).courtesyLimit, expected);
  }
});

test("corrupt or later policy JSON cannot silently change the student's purchased allowance", () => {
  assert.deepEqual(readLessonRemedyPolicy({ ...policy }), policy);
  for (const raw of [null, [], {}, { ...policy, courtesyLimit: 99 }, { ...policy, noRollover: false },
    { ...policy, version: "future" }, { ...policy, reviewHours: 1 }, { ...policy, kind: "single" },
    { ...policy, purchasedLessonCount: 0 }, { ...policy, purchasedLessonCount: Number.NaN }]) {
    assert.equal(readLessonRemedyPolicy(raw), null);
  }
  for (const lessons of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.throws(() => snapshotLessonRemedyPolicy("monthly_tuition", lessons), LessonRemedyError);
  }
});

test("advance absence is a teacher-approved request, not an automatic booking or refund", () => {
  assert.deepEqual(assessRemedyRequest(base), {
    mode: "advance_absence", reviewClosesAtMs: end + 48 * HOUR,
    replacementDeadlineMs: end + 30 * DAY, remainingCourtesy: 2,
    teacherApprovalRequired: true, automaticRefund: false,
  });
  assert.equal(assessRemedyRequest({ ...base, nowMs: start }).mode, "missed_lesson");
});

test("the standard request window closes at exactly 48 hours, with support still named", () => {
  assert.equal(assessRemedyRequest({ ...base, nowMs: end + 48 * HOUR - 1 }).mode, "missed_lesson");
  assert.throws(() => assessRemedyRequest({ ...base, nowMs: end + 48 * HOUR }),
    (error: unknown) => error instanceof LessonRemedyError && error.code === "standard_window_closed" && /Support/.test(error.message));
  assert.equal(assessRemedyRequest({ ...base, originalActualEndMs: end + HOUR, nowMs: end + 48 * HOUR }).reviewClosesAtMs, end + 49 * HOUR);
});

test("one-lesson courtesy exclusion and exhausted allowance never block teacher-nondelivery review", () => {
  const single = snapshotLessonRemedyPolicy("short_course", 1);
  assert.throws(() => assessRemedyRequest({ ...base, policy: single }), /One-lesson/);
  assert.throws(() => assessRemedyRequest({ ...base, courtesyUsedOrReserved: 2 }), /allowance/);
  assert.equal(assessRemedyRequest({ ...base, policy: single, reason: "teacher_missed", courtesyUsedOrReserved: 10 }).automaticRefund, false);
});

test("unpaid/unpurchased lessons, replacement chains and corrupt facts fail closed", () => {
  assert.throws(() => assessRemedyRequest({ ...base, originalLessonPurchased: false }), /enrollment/);
  assert.throws(() => assessRemedyRequest({ ...base, originalIsReplacement: true }), /existing make-up/);
  for (const facts of [
    { ...base, originalScheduledEndMs: start }, { ...base, originalActualEndMs: Number.NaN },
    { ...base, originalActualEndMs: base.nowMs + 1 },
    { ...base, nowMs: Number.POSITIVE_INFINITY }, { ...base, courtesyUsedOrReserved: -1 },
    { ...base, courtesyUsedOrReserved: 0.5 }, { ...base, policy: { ...policy, reviewHours: 2 } as unknown as typeof policy },
  ]) assert.throws(() => assessRemedyRequest(facts), LessonRemedyError);
});

test("an already owed/completed transfer cannot be reopened by the request path", () => {
  for (const allocationState of ["refund_owed", "refunded", "paid_out", "unknown"]) {
    assert.throws(() => assessRemedyRequest({ ...base, allocationState }), /payment/);
  }
});

test("a single request follows teacher offer, student acceptance and review without a second sale", () => {
  let state = transitionLessonRemedy("requested", "offer", "teacher");
  state = transitionLessonRemedy(state, "accept", "student");
  assert.equal(state, "accepted");
  state = transitionLessonRemedy(state, "delivery_confirmed", "system");
  assert.equal(state, "delivered_review");
  state = transitionLessonRemedy(state, "resolve", "operator");
  assert.equal(state, "resolved");
  assert.throws(() => transitionLessonRemedy(state, "offer", "teacher"), LessonRemedyError);
});

test("neither teacher nor AI/system can accept for a student, deny a claim or resolve money", () => {
  for (const actor of ["teacher", "system", "operator"] as const) {
    assert.throws(() => transitionLessonRemedy("offered", "accept", actor), LessonRemedyError);
  }
  for (const actor of ["teacher", "system", "student"] as const) {
    assert.throws(() => transitionLessonRemedy("review_required", "resolve", actor), LessonRemedyError);
  }
  assert.throws(() => transitionLessonRemedy("accepted", "teacher_missed_replacement", "teacher"), LessonRemedyError);
});

test("decline, expiry and either no-show preserve the same case for review", () => {
  assert.equal(transitionLessonRemedy("offered", "decline", "student"), "review_required");
  assert.equal(transitionLessonRemedy("offered", "expire", "system"), "review_required");
  assert.equal(transitionLessonRemedy("accepted", "student_missed_replacement", "operator"), "review_required");
  assert.equal(transitionLessonRemedy("accepted", "teacher_missed_replacement", "operator"), "review_required");
  assert.equal(transitionLessonRemedy("accepted", "refund_review", "student"), "review_required");
  assert.throws(() => transitionLessonRemedy("review_required", "offer", "teacher"), /changed/);
});

test("the full actor/event matrix has no unlisted transitions", () => {
  const allowed: Record<LessonRemedyEvent, [LessonRemedyActor[], string[]]> = {
    offer: [["teacher"], ["requested"]], accept: [["student"], ["offered"]],
    decline: [["student"], ["offered"]], expire: [["system"], ["offered"]],
    withdraw: [["student"], ["requested", "offered"]],
    delivery_confirmed: [["operator", "system"], ["accepted"]],
    student_missed_replacement: [["operator"], ["accepted"]],
    teacher_missed_replacement: [["operator"], ["accepted", "delivered_review"]],
    refund_review: [["student", "operator"], ["requested", "offered", "accepted", "delivered_review"]],
    resolve: [["operator"], ["requested", "offered", "accepted", "delivered_review", "review_required", "withdrawn"]],
  };
  for (const status of LESSON_REMEDY_STATUSES) for (const [event, [actors, states]] of Object.entries(allowed)) {
    for (const actor of ["student", "teacher", "system", "operator"] as const) {
      const transition = () => transitionLessonRemedy(status, event as LessonRemedyEvent, actor);
      if (actors.includes(actor) && states.includes(status)) assert.doesNotThrow(transition);
      else assert.throws(transition, LessonRemedyError);
    }
  }
  for (const event of ["toString", "constructor", "__proto__"]) {
    assert.throws(() => transitionLessonRemedy("requested", event as LessonRemedyEvent, "teacher"), LessonRemedyError);
  }
});

test("original-session evidence cannot settle an open make-up", () => {
  for (const status of ["requested", "offered", "review_required", "withdrawn", "resolved"] as const) {
    assert.deepEqual(remedySettlementTarget({ status, originalSessionId: 17, acceptedReplacementSessionId: 91 }), { sessionId: null, hold: true });
  }
  for (const status of ["accepted", "delivered_review"] as const) {
    assert.deepEqual(remedySettlementTarget({ status, originalSessionId: 17, acceptedReplacementSessionId: 91 }), { sessionId: 91, hold: false });
    assert.deepEqual(remedySettlementTarget({ status, originalSessionId: 17, acceptedReplacementSessionId: null }), { sessionId: null, hold: true });
  }
  assert.throws(() => remedySettlementTarget({ status: "accepted", originalSessionId: 17, acceptedReplacementSessionId: 17 }), LessonRemedyError);
});

test("quota reservations release on decline/expiry, accepted no-shows count, teacher failure never counts", () => {
  const facts = { reason: "student_missed" as const, status: "offered" as const, acceptedAtMs: null, teacherFailedReplacement: false };
  assert.equal(courtesyAllowanceUse(facts), 1);
  assert.equal(courtesyAllowanceUse({ ...facts, status: "requested" }), 1);
  for (const status of ["review_required", "withdrawn", "resolved"] as const) assert.equal(courtesyAllowanceUse({ ...facts, status }), 0);
  for (const status of ["accepted", "delivered_review", "review_required", "resolved"] as const) {
    assert.equal(courtesyAllowanceUse({ ...facts, status, acceptedAtMs: start }), 1);
    assert.equal(courtesyAllowanceUse({ ...facts, status, acceptedAtMs: start, teacherFailedReplacement: true }), 0);
    assert.equal(courtesyAllowanceUse({ ...facts, status, acceptedAtMs: start, reason: "teacher_missed" }), 0);
  }
  assert.throws(() => courtesyAllowanceUse({ ...facts, status: "accepted" }), /incomplete/);
});

test("two submitted monthly courtesy requests exhaust the allowance before either teacher offer", () => {
  const request = { reason: "student_missed" as const, status: "requested" as const, acceptedAtMs: null, teacherFailedReplacement: false };
  const used = [request, request].reduce((total, facts) => total + courtesyAllowanceUse(facts), 0);
  assert.equal(used, 2);
  assert.equal(assessRemedyRequest({ ...base, courtesyUsedOrReserved: courtesyAllowanceUse(request) }).remainingCourtesy, 1);
  assert.throws(() => assessRemedyRequest({ ...base, courtesyUsedOrReserved: used }),
    (error: unknown) => error instanceof LessonRemedyError && error.code === "allowance_used");
  assert.equal(assessRemedyRequest({ ...base, reason: "teacher_missed", courtesyUsedOrReserved: used }).teacherApprovalRequired, true);
  for (const status of ["requested", "offered"] as const) {
    assert.equal(courtesyAllowanceUse({ ...request, status, reason: "teacher_missed" }), 0);
    assert.equal(courtesyAllowanceUse({ ...request, status, teacherFailedReplacement: true }), 0);
  }
});

test("unaccepted requests release their slot on withdrawal, rejection, declined offer or expiry", () => {
  const request = { reason: "student_missed" as const, status: "requested" as const, acceptedAtMs: null, teacherFailedReplacement: false };
  const offered = transitionLessonRemedy(request.status, "offer", "teacher");
  const releasedStatuses = [
    transitionLessonRemedy(request.status, "withdraw", "student"),
    transitionLessonRemedy(request.status, "resolve", "operator"),
    transitionLessonRemedy(offered, "decline", "student"),
    transitionLessonRemedy(offered, "expire", "system"),
  ];
  for (const status of releasedStatuses) {
    const used = courtesyAllowanceUse(request) + courtesyAllowanceUse({ ...request, status });
    assert.equal(used, 1);
    assert.equal(assessRemedyRequest({ ...base, courtesyUsedOrReserved: used }).remainingCourtesy, 1);
  }
});

test("one original case keeps one reservation through offer, acceptance and student no-show review", () => {
  const request = { reason: "student_missed" as const, acceptedAtMs: null, teacherFailedReplacement: false };
  assert.equal(courtesyAllowanceUse({ ...request, status: "requested" }), 1);
  const offered = transitionLessonRemedy("requested", "offer", "teacher");
  assert.equal(courtesyAllowanceUse({ ...request, status: offered }), 1);
  const accepted = transitionLessonRemedy(offered, "accept", "student");
  const acceptedFacts = { ...request, acceptedAtMs: start };
  assert.equal(courtesyAllowanceUse({ ...acceptedFacts, status: accepted }), 1);
  const review = transitionLessonRemedy(accepted, "student_missed_replacement", "operator");
  assert.equal(courtesyAllowanceUse({ ...acceptedFacts, status: review }), 1);
  const resolved = transitionLessonRemedy(review, "resolve", "operator");
  assert.equal(courtesyAllowanceUse({ ...acceptedFacts, status: resolved }), 1);
  assert.equal(courtesyAllowanceUse({ ...acceptedFacts, status: resolved, teacherFailedReplacement: true }), 0);
});

const acceptance = {
  status: "offered" as const, offerStatus: "proposed" as const, allocationState: "replacement_pending",
  nowMs: end, expiresAtMs: end + 7 * DAY, replacementStartsAtMs: end + DAY,
  replacementEndsAtMs: end + DAY + HOUR, originalScheduledEndMs: end, originalDurationMinutes: 60,
  acceptedReplacementSessionId: null, refundReviewPending: false,
};

test("acceptance uses actual offer expiry/start and exact promised duration", () => {
  assert.equal(assessRemedyAcceptance(acceptance), "accept");
  assert.equal(assessRemedyAcceptance({ ...acceptance, nowMs: acceptance.replacementStartsAtMs - 1 }), "accept");
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, nowMs: acceptance.replacementStartsAtMs }), /expired/);
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, expiresAtMs: acceptance.nowMs }), /expired/);
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, replacementEndsAtMs: acceptance.replacementEndsAtMs + 1 }), /length/);
  assert.equal(assessRemedyAcceptance({ ...acceptance, replacementStartsAtMs: end + 30 * DAY - HOUR, replacementEndsAtMs: end + 30 * DAY }), "accept");
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, replacementStartsAtMs: end + 30 * DAY, replacementEndsAtMs: end + 30 * DAY + HOUR }), /deadline/);
});

test("refund-versus-accept race must be checked under the payment lock; retries cannot create a second room", () => {
  for (const allocationState of ["refund_owed", "refunded", "paid_out", "unknown"]) {
    assert.throws(() => assessRemedyAcceptance({ ...acceptance, allocationState }), /payment/);
  }
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, refundReviewPending: true }), /payment/);
  assert.equal(assessRemedyAcceptance({ ...acceptance, status: "accepted", offerStatus: "accepted", acceptedReplacementSessionId: 91, nowMs: end + 20 * DAY }), "already_accepted");
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, status: "accepted", offerStatus: "accepted" }), /changed/);
  assert.throws(() => assessRemedyAcceptance({ ...acceptance, offerStatus: "declined" }), /changed/);
});

test("a replacement has a fresh two-day review clock; early exit never shortens the promised slot", () => {
  assert.equal(lessonReviewClosesAt(end, end - HOUR), end + 48 * HOUR);
  assert.equal(lessonReviewClosesAt(end, end + HOUR), end + 49 * HOUR);
  assert.throws(() => lessonReviewClosesAt(Number.NaN, null), LessonRemedyError);
});

test("both generic operator ledger routes refuse a ledger-only replacement", () => {
  for (const route of ["programCommerce.ts", "batchTesting.ts"]) {
    const source = readFileSync(new URL(`../routes/${route}`, import.meta.url), "utf8");
    const guard = source.indexOf('if (event === "replacement_scheduled")');
    assert.ok(guard >= 0, `${route} must not release a hold without accepted session linkage`);
    assert.ok(source.slice(guard, guard + 450).includes("res.status(409)"));
  }
});
