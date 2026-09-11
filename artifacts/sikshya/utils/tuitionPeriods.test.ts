import assert from "node:assert/strict";
import test from "node:test";
import { draftTuitionPeriod, draftPeriodIssues, fullBatchPrice, TUITION_PERIOD_MS, type OwnerProgramBatch } from "./programBatches.ts";
import { repeatPeriodLessons } from "./batchSchedule.ts";

const first = { date: "2028-02-28", time: "16:00", durationMinutes: 60 };
const batch = { format: "ongoing", tuitionGroupId: 4, periodAnchorLocked: false } as OwnerProgramBatch;
test("preview follows first lesson until publication, then keeps shared group boundaries", () => {
  const period = draftTuitionPeriod(batch, first)!;
  assert.equal(Date.parse(period.endsAt) - Date.parse(period.startsAt), TUITION_PERIOD_MS);
  assert.equal(draftTuitionPeriod({ ...batch, periodAnchorLocked: true, tuitionPeriod: period }, { ...first, date: "2028-03-10" }), period);
  assert.equal(draftTuitionPeriod({ ...batch, format: "fixed" }, first), null);
  assert.equal(draftTuitionPeriod(batch, { ...first, date: "" }), null);
});
test("weekly tuition fits the period instead of inventing thirty lessons", () => {
  const period = draftTuitionPeriod(batch, first)!;
  const weekly = repeatPeriodLessons(first, [1], period);
  assert.ok(weekly.ok);
  if (weekly.ok) { assert.equal(weekly.lessons.length, 5); assert.deepEqual(draftPeriodIssues(period, weekly.lessons), []); }
  const daily = repeatPeriodLessons(first, [0, 1, 2, 3, 4, 5, 6], period);
  assert.ok(daily.ok); if (daily.ok) assert.equal(daily.lessons.length, 30);
  assert.equal(repeatPeriodLessons({ ...first, date: "2028-03-30" }, [4], period).ok, false);
  assert.equal(draftPeriodIssues(period, [{ ...first, date: "2028-03-29" }]).length, 1);
  assert.match(fullBatchPrice(3000, period), /30-day period/);
  assert.match(fullBatchPrice(3000), /full batch/);
});
