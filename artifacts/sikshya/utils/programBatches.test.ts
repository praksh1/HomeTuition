import assert from "node:assert/strict";
import test from "node:test";

import {
  batchDateValue,
  batchMatchesPublication,
  batchTemplate,
  batchTimeDraft,
  batchTimeValue,
  fullBatchPrice,
  lessonDraft,
  nepalDate,
  type OwnerProgramBatch,
} from "./programBatches.ts";

test("program batch copy always names the full-price unit", () => {
  assert.equal(fullBatchPrice(3000), "NPR 3,000 total for the full batch");
});

test("published UI compares actual saved terms and the current Program version", () => {
  const lessons = [{ id: 1, position: 0, startsAt: "2028-01-01T04:15:00Z", durationMinutes: 60 }];
  const batch: OwnerProgramBatch = { id: 1, programId: 2, currentProgramVersion: 1, status: "published", capacity: 6, totalTuitionNpr: 3000, version: 1, publishedAt: "2026-09-11", updatedAt: "2026-09-11", lessons, published: { batchId: 1, programId: 2, programVersion: 1, programTitle: "Guitar", version: 1, capacity: 6, totalTuitionNpr: 3000, lessons, timeZone: "Asia/Kathmandu", enrollmentClosesAt: lessons[0]!.startsAt } };
  assert.equal(batchMatchesPublication(batch), true);
  assert.equal(batchMatchesPublication({ ...batch, currentProgramVersion: 2 }), false);
  assert.equal(batchMatchesPublication({ ...batch, totalTuitionNpr: 4000 }), false);
  assert.equal(batchMatchesPublication({ ...batch, lessons: [{ ...lessons[0]!, durationMinutes: 90 }] }), false);
  assert.equal(batchMatchesPublication({ ...batch, status: "draft" }), false);
  assert.deepEqual(batchTemplate(batch), { capacity: "6", totalTuitionNpr: "3000", lessons: [{ date: "", time: "10:00", durationMinutes: 60 }] });
  assert.equal(batch.lessons[0]!.startsAt, "2028-01-01T04:15:00Z");
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
