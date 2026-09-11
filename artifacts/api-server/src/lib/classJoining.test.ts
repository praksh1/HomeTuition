import test from "node:test";
import assert from "node:assert/strict";
import { classJoiningPreview } from "./classJoining.ts";
import { batchSnapshot, readBatchSnapshot, sameBatchOffer } from "./programBatches.ts";

const start = Date.parse("2026-10-01T10:00:00Z");
const day = 86400000;
function offer(enabled = true, total = 5000) {
  return batchSnapshot({ batchId: 1, version: 1, programId: 1, programVersion: 1,
    programTitle: "Maths", capacity: 10, totalTuitionNpr: total, allowLateJoining: enabled,
    tuitionPeriod: { groupId: 1, index: 0, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 30 * day).toISOString() },
    lessons: Array.from({ length: 18 }, (_, position) => ({ position, startsAt: new Date(start + position * day), durationMinutes: 60 })),
  });
}
test("7 begun lessons leave 11, cost 3056 NPR, and never reset the shared period", () => {
  const snapshot = offer();
  const quote = classJoiningPreview(snapshot, start + 6 * day + 1);
  assert.equal(quote.remainingLessonCount, 11);
  assert.equal(quote.startedLessonCount, 7);
  assert.equal(quote.amountNpr, 3056);
  assert.deepEqual(quote.lessonPositions, Array.from({ length: 11 }, (_, n) => n + 7));
  assert.equal(quote.periodEndsAt, snapshot.tuitionPeriod!.endsAt);
  assert.equal(quote.previewOnly, true);
});
test("full advance price, exact-start exclusion, final-start closure", () => {
  const snapshot = offer();
  assert.equal(classJoiningPreview(snapshot, start - 1).amountNpr, 5000);
  assert.equal(classJoiningPreview(snapshot, start - 1).status, "full_offer");
  assert.equal(classJoiningPreview(snapshot, start).remainingLessonCount, 17);
  const last = classJoiningPreview(snapshot, start + 17 * day);
  assert.equal(last.status, "closed");
  assert.equal(last.amountNpr, null);
  assert.deepEqual(last.lessonPositions, []);
});
test("old policies and fixed courses never acquire late access", () => {
  const closed = offer(false);
  assert.equal(classJoiningPreview(closed, start).status, "closed");
  const fixed = { ...closed, tuitionPeriod: undefined };
  assert.equal(classJoiningPreview(fixed, start).status, "closed");
  assert.equal(readBatchSnapshot({ ...fixed, allowLateJoining: true }), null);
});
test("snapshot policy is validated and a real publication change", () => {
  const enabled = offer(), disabled = offer(false);
  assert.ok(readBatchSnapshot(enabled));
  assert.ok(readBatchSnapshot(disabled));
  assert.equal(readBatchSnapshot({ ...enabled, allowLateJoining: "true" }), null);
  assert.equal(readBatchSnapshot({ ...enabled, enrollmentClosesAt: enabled.tuitionPeriod!.startsAt }), null);
  assert.equal(sameBatchOffer(enabled, disabled), false);
});
test("round once, no unsafe intermediate multiplication or free fallback", () => {
  const large = classJoiningPreview(offer(true, Number.MAX_SAFE_INTEGER), start + 6 * day);
  assert.ok(Number.isSafeInteger(large.amountNpr));
  assert.equal(classJoiningPreview(offer(true, 1), start + 16 * day).amountNpr, null);
  assert.throws(() => classJoiningPreview(offer(), NaN));
});
test("prices decrease monotonically and quote expires at next lesson", () => {
  const snapshot = offer();
  let prior = 5000;
  for (let i = 0; i < 17; i++) {
    const quote = classJoiningPreview(snapshot, start + i * day);
    assert.ok(quote.amountNpr! <= prior && quote.amountNpr! > 0);
    assert.equal(quote.validBefore, snapshot.lessons[i + 1]!.startsAt);
    prior = quote.amountNpr!;
  }
});
