import test from "node:test";
import assert from "node:assert/strict";
import { simulatedBatchReceipt } from "./batchTestPayment.ts";

test("test receipt freezes gross and 70/30 shares, with no real money", () => {
  const r = simulatedBatchReceipt(19, 6000, [0, 1]);
  assert.equal(r.reference, "TEST-BATCH-19");
  assert.equal(r.teacherNpr, 4200); assert.equal(r.fadkoNpr, 1800);
  assert.equal(r.actualMoneyCollectedNpr, 0); assert.equal(r.actualMoneyPaidOutNpr, 0);
  assert.ok(r.allocations.every(a => a.state === "held"));
});
test("odd totals conserve every rupee and retain actual late-join positions", () => {
  for (const total of [1, 11, 101, 6001, Number.MAX_SAFE_INTEGER]) {
    const r = simulatedBatchReceipt(20, total, [7, 9, 12]);
    assert.deepEqual(r.allocations.map(a => a.position), [7, 9, 12]);
    assert.equal(r.allocations.reduce((n, a) => n + a.grossNpr, 0), total);
    assert.equal(r.teacherNpr + r.fadkoNpr, total);
    assert.ok(r.allocations.every(a => a.teacherNpr + a.fadkoNpr === a.grossNpr && a.fadkoNpr >= 0));
  }
});
test("invalid identities, money and subsets refused", () => {
  for (const args of [[0, 10, [0]], [1, 0, [0]], [1, 1.1, [0]], [1, 10, []], [1, 10, [0, 0]], [1, 10, [-1]]] as [number, number, number[]][]) {
    assert.throws(() => simulatedBatchReceipt(...args));
  }
});
