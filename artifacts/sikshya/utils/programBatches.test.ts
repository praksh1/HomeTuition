import assert from "node:assert/strict";
import test from "node:test";

import { fullBatchPrice, lessonDraft, nepalDate } from "./programBatches.ts";

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
