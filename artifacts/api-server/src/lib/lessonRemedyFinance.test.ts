import assert from "node:assert/strict";
import test from "node:test";
import { assertRemedyFinancialEvent, originalAllocationRefundEvents, remedyHoldsAllocation, replacementAllocationAdmits } from "./lessonRemedyFinance.ts";
import { transitionProgramAllocation, type ProgramAllocationState } from "./programCommerce.ts";

const remedy = { id: 1, originalSessionId: 2, status: "accepted", outcome: null, replacementSessionId: 3, replacementReviewClosesAt: null };
test("every unresolved case holds its original amount even when a lesson was completed", () => {
  for (const status of ["requested", "offered", "accepted", "review_required", "resolved", "unknown"]) {
    assert.equal(remedyHoldsAllocation({ ...remedy, status }, 100), true);
    assert.throws(() => assertRemedyFinancialEvent({ ...remedy, status }, "payout_confirmed", 100), /held/);
  }
});
test("confirmed replacement waits until its own exact review deadline", () => {
  const delivered = { ...remedy, status: "delivered_review", replacementReviewClosesAt: new Date(200) };
  assert.equal(remedyHoldsAllocation(delivered, 199), true);
  assert.equal(remedyHoldsAllocation(delivered, 200), false);
  assert.throws(() => assertRemedyFinancialEvent(delivered, "complaint_denied", 199));
  assert.doesNotThrow(() => assertRemedyFinancialEvent(delivered, "payout_confirmed", 200));
  assert.equal(remedyHoldsAllocation({ ...delivered, replacementSessionId: null }, 201), true);
  assert.equal(remedyHoldsAllocation({ ...delivered, replacementReviewClosesAt: new Date(NaN) }, 201), true);
});
test("withdrawal and explicit no-adjustment outcome release only the remedy overlay", () => {
  assert.equal(remedyHoldsAllocation({ ...remedy, status: "withdrawn" }), false);
  assert.equal(remedyHoldsAllocation({ ...remedy, status: "resolved", outcome: "no_adjustment" }), false);
  assert.equal(remedyHoldsAllocation({ ...remedy, status: "resolved", outcome: "refund_review" }), true);
});
test("generic ledger actions cannot fabricate make-up delivery", () => {
  for (const event of ["replacement_scheduled", "lesson_delivered", "complaint_window_closed", "makeup_review_restored"] as const) {
    assert.throws(() => assertRemedyFinancialEvent(remedy, event), /linked/);
  }
});
test("denied replacement complaint returns to its existing review, not instant eligibility", () => {
  assert.equal(transitionProgramAllocation("disputed", "makeup_review_restored"), "delivered_pending");
  assert.throws(() => transitionProgramAllocation("future", "makeup_review_restored"));
  const delivered = { ...remedy, status: "delivered_review", replacementReviewClosesAt: new Date(200) };
  assert.throws(() => assertRemedyFinancialEvent(delivered, "payout_confirmed", 199));
});
test("human refunds always transition the original state without creating another allocation", () => {
  for (const state of ["future", "replacement_pending", "delivered_pending", "eligible", "disputed"] as ProgramAllocationState[]) {
    assert.equal(originalAllocationRefundEvents(state).reduce(transitionProgramAllocation, state), "refund_owed");
  }
  assert.deepEqual(originalAllocationRefundEvents("refunded"), []);
  assert.throws(() => originalAllocationRefundEvents("paid_out"), /reconcile/);
});
test("original refund or already completed transfer cannot grant replacement access", () => {
  for (const state of ["refund_owed", "refunded", "paid_out", "unknown", ""]) assert.equal(replacementAllocationAdmits(state), false);
  for (const state of ["future", "replacement_pending", "delivered_pending", "disputed", "eligible"]) assert.equal(replacementAllocationAdmits(state), true);
});
