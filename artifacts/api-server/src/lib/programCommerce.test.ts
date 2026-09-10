import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROGRAM_ALLOCATION_EVENTS,
  PROGRAM_ALLOCATION_STATES,
  ProgramCommerceInputError,
  allocateProgramTuition,
  allocateProgramShares,
  allocationMayBeRefunded,
  allocationMayEnterPayout,
  transitionProgramAllocation,
  type ProgramAllocationEvent,
  type ProgramAllocationState,
} from "./programCommerce.ts";

test("the approved beta split preserves every rupee across uneven lessons", () => {
  const rows = allocateProgramShares(1_003, 4);
  assert.equal(rows.reduce((sum, row) => sum + row.teacherAmountNpr, 0), 702);
  assert.equal(rows.reduce((sum, row) => sum + row.platformAmountNpr, 0), 301);
  assert.equal(rows.reduce((sum, row) => sum + row.teacherAmountNpr + row.platformAmountNpr, 0), 1_003);
  assert.ok(rows.every((row) => row.teacherAmountNpr + row.platformAmountNpr === row.amountNpr));
});

test("a divisible program price becomes equal lesson allocations", () => {
  assert.deepEqual(allocateProgramTuition(4_000, 8), [
    { lessonNumber: 1, amountNpr: 500, state: "future" },
    { lessonNumber: 2, amountNpr: 500, state: "future" },
    { lessonNumber: 3, amountNpr: 500, state: "future" },
    { lessonNumber: 4, amountNpr: 500, state: "future" },
    { lessonNumber: 5, amountNpr: 500, state: "future" },
    { lessonNumber: 6, amountNpr: 500, state: "future" },
    { lessonNumber: 7, amountNpr: 500, state: "future" },
    { lessonNumber: 8, amountNpr: 500, state: "future" },
  ]);
});

test("a remainder is assigned deterministically and every rupee survives", () => {
  const rows = allocateProgramTuition(1_003, 4);
  assert.deepEqual(rows.map((row) => row.amountNpr), [251, 251, 251, 250]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountNpr, 0), 1_003);
});

test("the allocation invariant holds over awkward totals and lesson counts", () => {
  for (const total of [1, 7, 99, 1_001, 12_345]) {
    for (let lessons = 1; lessons <= Math.min(total, 40); lessons += 1) {
      const rows = allocateProgramTuition(total, lessons);
      assert.equal(rows.length, lessons);
      assert.equal(rows.reduce((sum, row) => sum + row.amountNpr, 0), total);
      assert.ok(rows.every((row) => row.amountNpr >= 1));
      assert.ok(Math.max(...rows.map((row) => row.amountNpr)) - Math.min(...rows.map((row) => row.amountNpr)) <= 1);
    }
  }
});

for (const [total, lessons] of [[0, 1], [-1, 1], [100, 0], [100, -2], [3, 4], [1.5, 1], [100, 2.5]]) {
  test(`invalid allocation input ${total}/${lessons} is refused`, () => {
    assert.throws(() => allocateProgramTuition(total, lessons), ProgramCommerceInputError);
  });
}

test("a delivered lesson waits before it can enter a payout", () => {
  const delivered = transitionProgramAllocation("future", "lesson_delivered");
  assert.equal(delivered, "delivered_pending");
  assert.equal(allocationMayEnterPayout(delivered), false);

  const eligible = transitionProgramAllocation(delivered, "complaint_window_closed");
  assert.equal(eligible, "eligible");
  assert.equal(allocationMayEnterPayout(eligible), true);
  assert.equal(transitionProgramAllocation(eligible, "payout_confirmed"), "paid_out");
});

test("one disputed lesson freezes only its own allocation", () => {
  const rows = allocateProgramTuition(2_001, 3);
  const states = rows.map((row) => transitionProgramAllocation(row.state, "lesson_delivered"));
  states[1] = transitionProgramAllocation(states[1]!, "complaint_opened");
  states[0] = transitionProgramAllocation(states[0]!, "complaint_window_closed");
  states[2] = transitionProgramAllocation(states[2]!, "complaint_window_closed");

  assert.deepEqual(states, ["eligible", "disputed", "eligible"]);
});

test("an upheld complaint becomes a refund debt, not a completed refund", () => {
  const disputed = transitionProgramAllocation("delivered_pending", "complaint_opened");
  const owed = transitionProgramAllocation(disputed, "complaint_upheld");
  assert.equal(owed, "refund_owed");
  assert.equal(allocationMayBeRefunded(owed), true);
  assert.equal(transitionProgramAllocation(owed, "refund_confirmed"), "refunded");
});

test("a teacher cancellation waits for a remedy and does not decide one", () => {
  const pending = transitionProgramAllocation("future", "lesson_cancelled");
  assert.equal(pending, "replacement_pending");
  assert.equal(allocationMayEnterPayout(pending), false);
  assert.equal(allocationMayBeRefunded(pending), false);
});

test("a make-up carries the same allocation forward instead of creating another", () => {
  const pending = transitionProgramAllocation("future", "lesson_cancelled");
  assert.equal(transitionProgramAllocation(pending, "replacement_scheduled"), "future");
});

test("a declined replacement becomes a refund debt only after approval", () => {
  const pending = transitionProgramAllocation("future", "lesson_cancelled");
  const owed = transitionProgramAllocation(pending, "refund_approved");
  assert.equal(owed, "refund_owed");
  assert.equal(allocationMayBeRefunded(owed), true);
});

test("a denied complaint releases the same allocation", () => {
  assert.equal(transitionProgramAllocation("disputed", "complaint_denied"), "eligible");
});

test("an exceptional complaint can freeze an eligible but unpaid allocation", () => {
  assert.equal(transitionProgramAllocation("eligible", "complaint_opened"), "disputed");
});

test("paid-out and refunded allocations are terminal", () => {
  for (const state of ["paid_out", "refunded"] as const) {
    for (const event of PROGRAM_ALLOCATION_EVENTS) {
      assert.throws(() => transitionProgramAllocation(state, event), ProgramCommerceInputError);
    }
  }
});

test("every non-terminal state exposes only the approved transitions", () => {
  const expected: Record<ProgramAllocationState, Partial<Record<ProgramAllocationEvent, ProgramAllocationState>>> = {
    future: { lesson_delivered: "delivered_pending", lesson_cancelled: "replacement_pending" },
    replacement_pending: { replacement_scheduled: "future", refund_approved: "refund_owed" },
    delivered_pending: { complaint_opened: "disputed", complaint_window_closed: "eligible" },
    disputed: { complaint_upheld: "refund_owed", complaint_denied: "eligible" },
    eligible: { complaint_opened: "disputed", payout_confirmed: "paid_out" },
    paid_out: {},
    refund_owed: { refund_confirmed: "refunded" },
    refunded: {},
  };

  for (const state of PROGRAM_ALLOCATION_STATES) {
    for (const event of PROGRAM_ALLOCATION_EVENTS) {
      const next = expected[state][event];
      if (next === undefined) {
        assert.throws(() => transitionProgramAllocation(state, event), ProgramCommerceInputError);
      } else {
        assert.equal(transitionProgramAllocation(state, event), next);
      }
    }
  }
});
