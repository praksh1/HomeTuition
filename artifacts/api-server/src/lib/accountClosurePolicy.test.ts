import { test } from "node:test";
import assert from "node:assert/strict";
import { closureBlockers, mayCompleteClosure } from "./accountClosurePolicy.ts";
const commitments = { complete: true, upcomingLessons: 0, pendingPayments: 0, openDisputes: 0, pendingMakeups: 0 };
const review = { status: "requested", version: 2, expectedVersion: 2, requestedBy: 1, reviewedBy: 2, confirmed: true, commitments };
test("closure needs a current, independent, explicit human review",()=>{
  assert.equal(mayCompleteClosure(review).allowed,true);
  for (const changed of [{confirmed:false},{expectedVersion:1},{status:'cancelled'},{status:'closed'},{reviewedBy:1},{reviewedBy:0}])
    assert.equal(mayCompleteClosure({...review,...changed}).allowed,false);
});
test("all unresolved obligations are returned together",()=>{
  assert.deepEqual(closureBlockers({complete:true,upcomingLessons:1,pendingPayments:2,openDisputes:1,pendingMakeups:3}),
    ['upcoming_lessons','pending_payments','open_disputes','pending_makeups']);
});
test("missing or invalid commitment evidence blocks closure",()=>{
  for (const changed of [{complete:false},{pendingPayments:NaN},{upcomingLessons:-1},{openDisputes:0.5}])
    assert.deepEqual(closureBlockers({...commitments,...changed}),['review_unavailable']);
});
