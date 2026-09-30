import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("financial review pre-lock uses only the authenticated student's exact original allocation", () => {
  const source = readFileSync(new URL("./lessonRemedyIntegration.ts", import.meta.url), "utf8");
  const lock = source.slice(source.indexOf("export async function lockOriginalPaymentForReview"), source.indexOf("export async function freezeOriginalPaymentForReview"));
  assert.match(lock, /input\.sessionId === null \|\| input\.actorRole !== "student"/);
  assert.match(lock, /!\["Payment Issue", "Refund Request"\]\.includes\(input\.reason\)/);
  assert.match(lock, /originalAllocationForSession\(input\.sessionId, input\.studentId, tx\)/);
  assert.match(lock, /if \(!identity\) return null/);
  assert.match(lock, /eq\(batchTestPaymentsTable\.bookingId, identity\.bookingId\)\)\.for\("update"\)/);
  assert.match(lock, /if \(!payment\) throw Error/);
  assert.doesNotMatch(lock, /usersTable|insert\(|update\(/);
  const freeze = source.slice(source.indexOf("export async function freezeOriginalPaymentForReview"));
  assert.match(freeze, /const locked = await lockOriginalPaymentForReview\(tx, input\)/);
  assert.match(freeze, /if \(!locked\) return/);
  assert.match(freeze, /disputeId: input\.disputeId, paymentMoved: false/);
});

for (const route of ["disputes.ts", "supportAssistant.ts"]) {
  test(`${route} takes the original financial lock before the ticket FK, then records the hold with the new ticket ID`, () => {
    const source = readFileSync(new URL(`../routes/${route}`, import.meta.url), "utf8");
    const start = route === "disputes.ts" ? "const dispute = await db.transaction" : 'router.post("/support/assistant/conversations/:id/request"';
    const branch = source.slice(source.indexOf(start));
    const lock = branch.indexOf("await lockOriginalPaymentForReview(tx,");
    const insert = branch.indexOf("await tx.insert(disputesTable)");
    const freeze = branch.indexOf("await freezeOriginalPaymentForReview(tx,");
    assert.ok(lock >= 0 && lock < insert && insert < freeze);
    assert.match(branch.slice(lock, insert), /studentId: userId/);
    assert.match(branch.slice(lock, insert), /actorRole: req\.user!\.role, reason/);
    assert.match(branch.slice(freeze, freeze + 250), /disputeId: created!\.id/);
  });
}

test("disposable concurrency coverage exercises both financial routes against request and acceptance", () => {
  const source = readFileSync(new URL("../../scripts/lesson-remedies/financeChecks.mjs", import.meta.url), "utf8");
  assert.match(source, /assertFinancialTicketLockOrder\(path, operation\)/);
  assert.match(source, /for \(const path of \["direct", "assistant"\]\)/);
  assert.match(source, /for \(const operation of \["request", "accept"\]\)/);
  assert.match(source, /SELECT id FROM users WHERE id=\$1 FOR UPDATE/);
  assert.match(source, /assertFinancialTicketLockOrder\(path, operation\)/);
});

