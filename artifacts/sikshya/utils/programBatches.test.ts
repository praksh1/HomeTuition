import assert from "node:assert/strict";
import test from "node:test";

import {
  batchDateValue,
  batchTimeDraft,
  batchTimeValue,
  fullBatchPrice,
  lessonDraft,
  nepalDate,
} from "./programBatches.ts";

test("program batch copy always names the full-price unit", () => {
  assert.equal(fullBatchPrice(3000), "NPR 3,000 total for the full batch");
});

test("lesson editing and display are pinned to Nepal time", () => {
  const instant = "2026-09-12T04:15:00.000Z";
  assert.deepEqual(lessonDraft({ startsAt: instant, durationMinutes: 60 }), {
    date: "2026-09-12",
    time: "10:00",
    durationMinutes: 60,
  });
  assert.match(nepalDate(instant), /Nepal time$/);
});

test("batch schedule pickers round-trip the stored wall-clock values", () => {
  assert.equal(batchDateValue("2026-10-15")?.getDate(), 15);
  assert.equal(batchDateValue("not-a-date"), null);
  assert.equal(batchDateValue("2027-02-29"), null);
  assert.equal(batchTimeDraft(batchTimeValue("16:30")), "16:30");
  assert.equal(batchTimeDraft(batchTimeValue("bad")), "09:00");
});
