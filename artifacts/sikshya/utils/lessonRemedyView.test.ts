import assert from "node:assert/strict";
import test from "node:test";
import {
  remedyGroup,
  remedyOfferInstant,
  remedyQuotaLabel,
  remedyStatusLabel,
  remedyVisibleLessons,
  type RemedyLesson,
} from "./lessonRemedyView.ts";
const lesson = (status?: string): RemedyLesson => ({
  bookingId: 10,
  batchId: 12,
  classTitle: "Math",
  originalPosition: 4,
  originalSessionId: 105,
  title: "Lesson 5",
  startsAt: "2026-09-30T03:15:00Z",
  endsAt: "2026-09-30T04:15:00Z",
  canRequest: true,
  canReportTeacherMissed: false,
  quota: { limit: 2, used: 0, remaining: 2 },
  case: status
    ? {
        id: 1,
        status,
        reason: "student_missed",
        teacherNonDeliveryConfirmed: false,
        requestedAt: "2026-09-30T01:00:00Z",
        replacementDeadlineAt: "2026-10-30T04:15:00Z",
        replacementReviewClosesAt: null,
        outcome: null,
        offer: null,
        actions: {
          withdraw: false,
          offer: false,
          reject: false,
          accept: false,
          decline: false,
          confirmDelivery: false,
          resolve: false,
        },
      }
    : null,
});
test("Nepal offer time is independent of the user's device zone", () => {
  assert.equal(
    remedyOfferInstant("2026-10-01", "09:00"),
    "2026-10-01T03:15:00.000Z",
  );
  assert.equal(
    remedyOfferInstant("2026-10-01", "00:00"),
    "2026-09-30T18:15:00.000Z",
  );
});
test("reject malformed and impossible dates before sending", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-2-01", "", "garbage"])
    assert.equal(remedyOfferInstant(date, "09:00"), null);
  for (const time of ["24:00", "09:60", "9:00", "", "garbage"])
    assert.equal(remedyOfferInstant("2026-10-01", time), null);
});
test("the screen uses supplied quota, never counts attendance or assumes renewal", () => {
  assert.equal(
    remedyQuotaLabel({ limit: 2, used: 2, remaining: 0 }),
    "0 of 2 courtesy make-ups available",
  );
  assert.equal(
    remedyQuotaLabel({ limit: 0, used: 0, remaining: 0 }),
    "No courtesy allowance for this purchase",
  );
});
test("pending, assigned, review and closed states remain distinct", () => {
  assert.equal(remedyGroup(lesson()), "attention");
  assert.equal(remedyGroup(lesson("requested")), "attention");
  assert.equal(remedyGroup(lesson("accepted")), "scheduled");
  assert.equal(remedyGroup(lesson("review_required")), "attention");
  assert.equal(remedyGroup(lesson("withdrawn")), "history");
  assert.equal(remedyStatusLabel(lesson("accepted").case!), "Make-up assigned");
  assert.equal(remedyStatusLabel(lesson("resolved").case!), "Review completed");
});
test("an ended offer must not look accept-ready and resolved delivery is explicit", () => {
  assert.equal(
    remedyStatusLabel(lesson("offered").case!),
    "Offer ended — needs review",
  );
  const value = lesson("resolved").case!;
  value.outcome = "replacement_delivered";
  assert.equal(remedyStatusLabel(value), "Make-up completed");
});
test("deep link retains the exact original session and status filter", () => {
  const lessons = [lesson(), { ...lesson("accepted"), originalSessionId: 106 }];
  assert.equal(remedyVisibleLessons(lessons, "all", 105).length, 1);
  assert.equal(remedyVisibleLessons(lessons, "attention", 106).length, 0);
  assert.equal(
    remedyVisibleLessons(lessons, "scheduled")[0]?.originalSessionId,
    106,
  );
});
