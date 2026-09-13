import assert from "node:assert/strict";
import test from "node:test";
import { readHomeworkDeadline } from "./classHomeworkDeadline.ts";

const now = Date.parse("2026-09-12T12:00:00.000Z");

test("homework deadline is optional", () => {
  assert.deepEqual(readHomeworkDeadline(undefined, now), { ok: true, dueAt: null });
  assert.deepEqual(readHomeworkDeadline(null, now), { ok: true, dueAt: null });
});

test("homework deadline accepts a future instant", () => {
  const result = readHomeworkDeadline("2026-09-13T12:00:00.000Z", now);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.dueAt?.toISOString(), "2026-09-13T12:00:00.000Z");
});

test("homework deadline rejects invalid and expired client values", () => {
  assert.equal(readHomeworkDeadline("tomorrow", now).ok, false);
  assert.equal(readHomeworkDeadline(123, now).ok, false);
  assert.equal(readHomeworkDeadline("2026-09-12T12:00:00.000Z", now).ok, false);
});
