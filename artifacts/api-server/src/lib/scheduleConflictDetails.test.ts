import assert from "node:assert/strict";
import test from "node:test";
import { conflictDetails, type TeachingSlot } from "./scheduleIntervals.ts";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute));
const slot = (minute: number): TeachingSlot => ({ startsAt: at(minute), durationMinutes: 30, label: "lesson" });
test("conflict identity is structured, including a paid other class", () => {
  const rows = conflictDetails([slot(0)], [{ ...slot(15), source: { kind: "session", id: 9, title: "Maths", locked: "paid" } }]);
  assert.equal(rows[0]?.lessonIndex, 0);
  assert.equal(rows[0]?.source?.id, 9);
  assert.equal(rows[0]?.source?.locked, "paid");
  assert.equal(rows[0]?.otherTitle, "Maths");
  assert.equal(rows[0]?.otherLessonIndex, null);
});
test("internal conflicts name both editable positions, adjacency is not conflict", () => {
  assert.equal(conflictDetails([slot(0), slot(30)], []).length, 0);
  const rows = conflictDetails([slot(0), slot(15)], []);
  assert.equal(rows[0]?.lessonIndex, 1);
  assert.equal(rows[0]?.otherLessonIndex, 0);
  assert.equal(rows[0]?.source, null);
});
test("conflict display is bounded without changing the underlying overlap rule", () => {
  assert.equal(conflictDetails(Array.from({ length: 60 }, () => slot(0)), [slot(0)]).length, 10);
});
