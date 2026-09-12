import test from "node:test";
import assert from "node:assert/strict";
import { classEarningsEstimate, classPriceBreakdown, classPublishSummary } from "./classPrice.ts";

test("full price displays actual count and average, not thirty assumed lessons", () => {
  assert.match(classPriceBreakdown(5000, 15), /15 live lessons.*333\.33/);
  assert.match(classPriceBreakdown(5000, 15), /not pay-per-lesson/);
});
test("missing or invalid price never invents free tuition", () => {
  for (const [price, count] of [[0, 15], [5000, 0], [NaN, 15], [5000, 1.5]])
    assert.match(classPriceBreakdown(price!, count!), /Choose lesson dates/);
});
test("teacher estimate uses the current server terms and actual lesson count", () => {
  assert.deepEqual(classEarningsEstimate(5000, 15, 7000), {
    totalNpr: 3500,
    averagePerLessonNpr: 3500 / 15,
  });
});
test("teacher estimate refuses missing or malformed commercial terms", () => {
  const invalid: Array<[number, number, number]> = [
    [0, 15, 7000], [5000, 0, 7000], [5000, 15, 0], [5000, 15, 10001], [5000.5, 15, 7000],
  ];
  for (const [total, lessons, share] of invalid)
    assert.equal(classEarningsEstimate(total, lessons, share), null);
});
test("one-lesson tuition warning names the actual purchase", () => {
  const message = classPublishSummary(5000, 1, true).join(" ");
  assert.match(message, /1 lesson for NPR 5,000 per student/);
  assert.match(message, /single lesson/);
  assert.match(message, /Joining and payment remain unavailable/);
  assert.ok(!classPublishSummary(5000, 15, true).join(" ").includes("Only 1"));
  assert.ok(!classPublishSummary(5000, 1, false).join(" ").includes("30-day"));
});
