import assert from "node:assert/strict";
import test from "node:test";
import { tuitionPeriod, tuitionPeriodIssues, readTuitionPeriod, TUITION_PERIOD_MS } from "./tuitionPeriods.ts";
import { batchSnapshot, readBatchSnapshot, sameBatchOffer } from "./programBatches.ts";

test("shared periods are contiguous 30 days through leap years and DST elsewhere", () => {
  for (const anchor of ["2028-02-28T16:00:00+05:45", "2026-12-20T00:00:00+05:45", "2026-03-01T18:00:00+05:45"]) {
    const first = tuitionPeriod(9, 0, new Date(anchor));
    const next = tuitionPeriod(9, 1, new Date(anchor));
    assert.equal(first.endsAt, next.startsAt);
    assert.equal(Date.parse(next.endsAt) - Date.parse(first.startsAt), 2 * TUITION_PERIOD_MS);
    assert.equal(next.groupId, first.groupId);
    assert.deepEqual(readTuitionPeriod(next), next);
  }
});
test("whole lessons must fit; exact end boundary is allowed, start at boundary isn't", () => {
  const p = tuitionPeriod(1, 0, new Date("2028-01-01T00:00:00Z"));
  const end = Date.parse(p.endsAt);
  assert.deepEqual(tuitionPeriodIssues(p, [{ startsAt: new Date(end - 3600000), durationMinutes: 60 }]), []);
  for (const at of [Date.parse(p.startsAt) - 1, end, end - 3599999]) {
    assert.equal(tuitionPeriodIssues(p, [{ startsAt: new Date(at), durationMinutes: 60 }]).length, 1);
  }
});
test("corrupt periods cannot be published as valid public evidence", () => {
  const p = tuitionPeriod(4, 0, new Date("2028-01-01T00:00:00Z"));
  for (const bad of [{ ...p, index: -1 }, { ...p, groupId: 0 }, { ...p, endsAt: p.startsAt }, { ...p, startsAt: "bad" }, null]) assert.equal(readTuitionPeriod(bad), null);
  assert.throws(() => tuitionPeriod(1, -1, new Date()));
  const snapshot = batchSnapshot({ batchId: 1, version: 1, programId: 1, programVersion: 1, programTitle: "Maths", capacity: 6, totalTuitionNpr: 3000, tuitionPeriod: p, lessons: [{ position: 0, startsAt: new Date("2028-01-02T00:00:00Z"), durationMinutes: 60 }] });
  assert.equal(snapshot.enrollmentClosesAt, p.startsAt);
  assert.ok(readBatchSnapshot(snapshot));
  const reordered = { endsAt: p.endsAt, startsAt: p.startsAt, index: p.index, groupId: p.groupId };
  assert.equal(sameBatchOffer(snapshot, { ...snapshot, tuitionPeriod: reordered }), true, "PostgreSQL jsonb key order must not make an unchanged offer look edited");
  assert.equal(readBatchSnapshot({ ...snapshot, enrollmentClosesAt: snapshot.lessons[0]!.startsAt }), null);
  assert.equal(readBatchSnapshot({ ...snapshot, tuitionPeriod: { ...p, endsAt: p.startsAt } }), null);
  assert.equal(sameBatchOffer(snapshot, { ...snapshot, tuitionPeriod: { ...p, groupId: 5 } }), false);
});
