import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RemedyRefusal, validRemedyRequestKey, remedyNote, remedyRequestFingerprint, canOpenLessonRemedyRequest } from "./lessonRemedyRules.ts";

test("only withdrawn or unaccepted review-required cases can re-request, never an accepted replacement or refund review", () => {
  assert.equal(canOpenLessonRemedyRequest(null), true);
  for (const status of ["requested", "offered", "accepted", "delivered_review", "review_required", "withdrawn", "resolved", "unknown"]) {
    for (const acceptedEver of [true, false]) {
      for (const outcome of [null, "refund_review", "teacher_no_show", "student_no_show"]) {
        assert.equal(canOpenLessonRemedyRequest({ status, outcome, acceptedEver }),
          !acceptedEver && ["withdrawn", "review_required"].includes(status) && outcome !== "refund_review");
      }
    }
  }
  assert.equal(canOpenLessonRemedyRequest({ status: "withdrawn", outcome: null } as never), false);
});

test("DTO re-request uses the same lifecycle guard and still assesses current purchase and financial/account restrictions", () => {
  const source = readFileSync(new URL("./lessonRemedyStore.ts", import.meta.url), "utf8");
  const write = source.slice(source.indexOf("export async function requestLessonMakeup"), source.indexOf("export async function offerLessonMakeup"));
  const read = source.slice(source.indexOf("export async function listLessonRemedies"));
  assert.match(write, /canOpenLessonRemedyRequest\(\{ status: existing\.status, outcome: existing\.outcome, acceptedEver: !!accepted \}\)/);
  assert.match(read, /status: currentCase!\.status, outcome: c\.outcome/);
  assert.match(read, /offer\.caseId === c\.id && offer\.acceptedAt !== null/);
  assert.match(read, /if \(!requestLifecycleOpen\)/);
  assert.match(read, /assessRemedyRequest\(facts\)/);
  assert.match(read, /assessRemedyRequest\(\{ \.\.\.facts, reason: "teacher_missed" \}\)/);
  assert.match(read, /hasFinancialReview\(p\)/);
  assert.match(read, /!openAccountIds\.has\(p\.studentId\) \|\| !openAccountIds\.has\(p\.teacherId\)/);
  assert.match(read, /p\.paymentStatus === "refunded"/);
  assert.match(read, /if \(!writeEnabled\)/);
  assert.match(write, /await openAccounts\(tx, p\)/);
  assert.match(write, /await activeRefundReview\(tx, p\)/);
  assert.match(write, /const decision = assessRemedyRequest\(facts\)/);
});

test("remedy action keys are bounded and cannot become path/query or SQL text", () => {
  for (const key of ["12345678", "a".repeat(100), "case_1-withdraw_2"]) assert.equal(validRemedyRequestKey(key), true);
  for (const key of [null, {}, 1, "short", "a".repeat(101), "x/../../session", "a?b=1234", "key'--1234", " key12345"]) assert.equal(validRemedyRequestKey(key), false);
});
test("operator decisions require clear bounded reasoning while student notes are optional", () => {
  assert.equal(remedyNote(undefined), ""); assert.equal(remedyNote("  Clear explanation.  ", true), "Clear explanation.");
  for (const input of [undefined, {}, "", "ok"]) assert.throws(() => remedyNote(input, true), RemedyRefusal);
  assert.throws(() => remedyNote("a".repeat(1501)), (error) => error instanceof RemedyRefusal && error.status === 400 && error.code === "note_too_long");
  assert.equal(remedyNote("a".repeat(1500)).length, 1500);
});
test("same idempotency key cannot silently apply different normalized decision details", () => {
  const first = remedyRequestFingerprint({ outcome: "refund_approved", note: "Reviewed original allocation", confirmed: true });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, remedyRequestFingerprint({ outcome: "refund_approved", note: "Reviewed original allocation", confirmed: true }));
  assert.notEqual(first, remedyRequestFingerprint({ outcome: "replacement_delivered", note: "Reviewed original allocation", confirmed: true }));
  assert.notEqual(first, remedyRequestFingerprint({ outcome: "refund_approved", note: "Different evidence", confirmed: true }));
});
test("live store serializes original payment before quota and all accepted seats stay out of batch mapping", () => {
  const source = readFileSync(new URL("./lessonRemedyStore.ts", import.meta.url), "utf8");
  const payment = source.indexOf("const [payment] = await tx.select().from(batchTestPaymentsTable)");
  const booking = source.indexOf("const [booking] = await tx.select().from(batchTestBookingsTable)");
  assert.ok(payment >= 0 && booking > payment);
  assert.match(source.slice(payment, booking), /for\("update"\)/);
  assert.match(source.slice(booking, booking + 350), /for\("update"\)/);
  assert.doesNotMatch(source, /insert\(batchTestSessionsTable\)/);
  assert.match(source, /price: 0/); assert.match(source, /paymentMethod: "linked_makeup"/);
  assert.match(source, /previous\.actorId !== actor\.userId/);
});
test("private participant DTO cannot return raw case events or operator notes", () => {
  const view = readFileSync(new URL("./lessonRemedyView.ts", import.meta.url), "utf8");
  assert.doesNotMatch(view, /\b(passwordHash|email|phone|dateOfBirth|detail|events|operatorNote)\??:/);
  assert.match(view, /teacherNonDeliveryConfirmed: boolean/);
});
test("make-up offers and acceptance take the teacher schedule advisory before account-row closure locks", () => {
  const source = readFileSync(new URL("./lessonRemedyStore.ts", import.meta.url), "utf8");
  for (const [start, end] of [["export async function offerLessonMakeup", "export async function acceptLessonMakeup"],
    ["export async function acceptLessonMakeup", "export async function actOnLessonMakeup"]]) {
    const branch = source.slice(source.indexOf(start!), source.indexOf(end!));
    const advisory = branch.indexOf("await lockTeacherSchedule(tx, p.teacherId)");
    const accounts = branch.indexOf("await openAccounts(tx, p)");
    assert.ok(advisory >= 0 && advisory < accounts, "teacher advisory must precede user FOR UPDATE");
  }
});
test("database harness rejects shared URLs before fixture queries and only uses local synthetic service", () => {
  const harness = readFileSync(new URL("../../scripts/lesson-remedies/run.mjs", import.meta.url), "utf8");
  assert.ok(harness.indexOf("Remote/shared databases are forbidden") < harness.indexOf("const pool"));
  assert.match(harness, /fadko_makeup_test/); assert.match(harness, /VIDEO_PROVIDER: "echo"/);
  assert.match(harness, /LIVEKIT_API_KEY: ""/); assert.match(harness, /RESEND_API_KEY: ""/);
});
