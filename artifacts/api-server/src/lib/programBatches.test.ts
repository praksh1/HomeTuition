import assert from "node:assert/strict";
import test from "node:test";

import { batchSnapshot, readBatchSnapshot, validateProgramBatch } from "./programBatches.ts";

const now = Date.parse("2026-09-10T00:00:00.000Z");

test("accepts ordered future Nepal lessons and derives the enrolment cutoff", () => {
  const result = validateProgramBatch({
    capacity: 10,
    totalTuitionNpr: 3000,
    lessons: [
      { date: "2026-09-12", time: "10:00", durationMinutes: 60 },
      { date: "2026-09-13", time: "10:00", durationMinutes: 90 },
    ],
  }, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const snapshot = batchSnapshot({ batchId: 4, version: 1, programId: 2, programVersion: 3, programTitle: "Algebra", ...result });
  assert.equal(snapshot.enrollmentClosesAt, snapshot.lessons[0]?.startsAt);
  assert.equal(readBatchSnapshot(snapshot)?.programTitle, "Algebra");
});

test("rejects invented, unsafe or ambiguous batch terms", () => {
  const result = validateProgramBatch({
    capacity: 11,
    totalTuitionNpr: 0,
    lessons: [
      { date: "2026-09-12", time: "10:00", durationMinutes: 20 },
      { date: "2026-09-11", time: "10:00", durationMinutes: 60 },
    ],
  }, now);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.includes("1 to 10")));
  assert.ok(result.issues.some((issue) => issue.includes("positive amount")));
  assert.ok(result.issues.some((issue) => issue.includes("30, 45, 60 or 90")));
});

test("rejects impossible calendar dates and past lessons", () => {
  const result = validateProgramBatch({
    capacity: 2,
    totalTuitionNpr: 500,
    lessons: [
      { date: "2026-02-31", time: "10:00", durationMinutes: 60 },
      { date: "2026-09-01", time: "10:00", durationMinutes: 60 },
    ],
  }, now);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.includes("valid Nepal date")));
  assert.ok(result.issues.some((issue) => issue.includes("future")));
});

test("a corrupt or version-skewed public snapshot is withheld", () => {
  const result = validateProgramBatch({ capacity: 3, totalTuitionNpr: 1200, lessons: [
    { date: "2026-09-12", time: "10:00", durationMinutes: 60 },
  ] }, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const snapshot = batchSnapshot({ batchId: 1, version: 1, programId: 2, programVersion: 1, programTitle: "Math", ...result });
  assert.equal(readBatchSnapshot({ ...snapshot, capacity: 45 }), null);
  assert.equal(readBatchSnapshot({ ...snapshot, enrollmentClosesAt: "2027-01-01T00:00:00.000Z" }), null);
  assert.equal(readBatchSnapshot({ ...snapshot, lessons: [{ ...snapshot.lessons[0]!, durationMinutes: 20 }] }), null);
});
