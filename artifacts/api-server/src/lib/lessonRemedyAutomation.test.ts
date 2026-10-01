import assert from "node:assert/strict";
import test from "node:test";
import { assessAutomatedLessonRemedy, automatedRemedyPurchaseDigest, courtesyAbsenceWarningAmounts,
  courtesyAbsenceWarningDigest, recordAutomatedRemedyShadow, readAutomatedRemedyPolicy,
  snapshotAutomatedRemedyPolicy, remedyAutomationMode, REMEDY_AUTOMATION_VERSION,
  COURTESY_ABSENCE_WARNING_VERSION, type AutomatedRemedyFacts, type AutomatedRemedyDecision,
  type AutomatedRemedyAdapter, type VerifiedRemedyEvidence, type CourtesyWarningConsent } from "./lessonRemedyAutomation.ts";

const HOUR = 3_600_000; const DAY = HOUR * 24;
const start = Date.parse("2026-10-01T04:15:00Z"); const end = start + HOUR;
const shadow = { LESSON_REMEDY_AUTOMATION_MODE: "shadow" };
const policy = snapshotAutomatedRemedyPolicy();
function evidence(sessionId: number, verdict: VerifiedRemedyEvidence["verdict"], finalizedAtMs = end): VerifiedRemedyEvidence {
  return { sessionId, verdict, source: "covered_server_records", referenceDigest: "a".repeat(64),
    finalizedAtMs, entireScheduledWindowCovered: true, outageDuringWindow: false, contradictory: false };
}
function base(): AutomatedRemedyFacts {
  return { bookingId: 1, position: 0, studentId: 2, originalSessionId: 3,
    bookingCreatedAtMs: start - DAY, originalStartsAtMs: start, originalEndsAtMs: end,
    grossNpr: 1000, allocationState: "replacement_pending", paymentMode: "simulation",
    purchaseConsent: { bookingId: 1, studentId: 2, policy, acceptedAtMs: start - DAY,
      termsDigest: automatedRemedyPurchaseDigest({ bookingId: 1, studentId: 2, policy }) },
    originalEvidence: evidence(3, "student_absent"), replacementEvidence: null,
    remedy: { id: 4, policyVersion: REMEDY_AUTOMATION_VERSION, reason: "student_missed", state: "requested", requestedAtMs: end,
      teacherNonDeliveryConfirmed: false, offer: null, warningConsent: null },
    humanFinancialReviewOpen: false, nowMs: end + HOUR };
}
function replacement(verdict: VerifiedRemedyEvidence["verdict"]): AutomatedRemedyFacts {
  const facts = base();
  const starts = end + 3 * DAY; const ends = starts + HOUR; const accepted = end + 2 * HOUR;
  facts.remedy!.state = "accepted";
  facts.remedy!.offer = { id: 5, createdAtMs: end + HOUR, startsAtMs: starts, endsAtMs: ends,
    expiresAtMs: starts, state: "accepted", acceptedAtMs: accepted, replacementSessionId: 6 };
  const identity = { bookingId: 1, position: 0, studentId: 2, originalSessionId: 3, offerId: 5,
    offerStartsAtMs: starts, offerEndsAtMs: ends, grossNpr: 1000 };
  facts.remedy!.warningConsent = { ...identity, replacementSessionId: 6,
    policyVersion: REMEDY_AUTOMATION_VERSION, warningVersion: COURTESY_ABSENCE_WARNING_VERSION,
    digest: courtesyAbsenceWarningDigest(identity), accepted: true, acceptedAtMs: accepted };
  facts.replacementEvidence = evidence(6, verdict, ends);
  facts.nowMs = ends + 1;
  return facts;
}
const decision = (facts: AutomatedRemedyFacts) => assessAutomatedLessonRemedy(facts, shadow);

test("automation defaults off and only an explicit shadow setting is recognized", () => {
  for (const flag of [undefined, "1", "true", "live", "simulation", "gateway", "SHADOW"]) {
    assert.equal(remedyAutomationMode({ LESSON_REMEDY_AUTOMATION_MODE: flag }), "disabled");
    assert.equal(assessAutomatedLessonRemedy(base(), { LESSON_REMEDY_AUTOMATION_MODE: flag }).kind, "none");
  }
  assert.equal(remedyAutomationMode(shadow), "shadow");
});
test("the new policy is strict and versioned; v1 and modified JSON never gain financial automation", () => {
  assert.deepEqual(readAutomatedRemedyPolicy(policy), policy);
  for (const raw of [null, [], {}, { ...policy, version: "2026-09-29-v1" },
    { ...policy, teacherResponseHours: 0 }, { ...policy, studentNoShowRefundBps: 0 },
    { ...policy, extra: true }, { ...policy, noRetroactiveChanges: false }]) {
    assert.equal(readAutomatedRemedyPolicy(raw), null);
    assert.deepEqual(decision({ ...base(), purchaseConsent: { ...base().purchaseConsent!, policy: raw } }), { kind: "none", reason: "legacy_terms" });
  }
});
test("old bookings without prospective checkout consent stay under their established terms", () => {
  const facts = base(); facts.purchaseConsent = null; facts.nowMs = end + 100 * DAY;
  assert.deepEqual(decision(facts), { kind: "none", reason: "legacy_terms" });
  const oldCase = replacement("student_absent"); oldCase.remedy!.policyVersion = "2026-09-29-v1";
  assert.deepEqual(decision(oldCase), { kind: "none", reason: "legacy_terms" });
});
test("checkout consent is bound to the student and purchase, and cannot be added after buying", () => {
  for (const change of [{ studentId: 99 }, { bookingId: 99 }, { acceptedAtMs: start }, { termsDigest: "b".repeat(64) }]) {
    const facts = base(); Object.assign(facts.purchaseConsent!, change);
    assert.deepEqual(decision(facts), { kind: "review", reason: "invalid_records", holdOriginalAllocation: true });
  }
});
test("no future original lesson is automatically refunded, even if an advance request aged past 48 hours", () => {
  const facts = base(); facts.remedy!.requestedAtMs = start - 4 * DAY;
  for (const nowMs of [start - HOUR, start, end - 1]) assert.deepEqual(decision({ ...facts, nowMs }), { kind: "none", reason: "not_due" });
});
test("teacher scheduling deadline is exactly 48 hours from the request", () => {
  const facts = base(); facts.nowMs = end + 48 * HOUR - 1;
  assert.deepEqual(decision(facts), { kind: "none", reason: "waiting_for_offer" });
  facts.nowMs++;
  assert.deepEqual(decision(facts), { kind: "refund_intent", reason: "teacher_did_not_offer",
    studentRefundNpr: 1000, platformRetainedNpr: 0, teacherNpr: 0,
    holdOriginalAllocation: true, paymentMoved: false, requiresProviderConfirmation: true });
});
test("verified teacher absence opens its own protected case instead of consuming courtesy allowance", () => {
  const facts = base(); facts.remedy = null; facts.originalEvidence = evidence(3, "teacher_absent");
  assert.deepEqual(decision(facts), { kind: "open_teacher_failure", teacherResponseDueAtMs: facts.nowMs + 48 * HOUR, holdOriginalAllocation: true });
});
test("missing rows, partial coverage, an outage or conflicting evidence never prove absence", () => {
  for (const change of [{ entireScheduledWindowCovered: false }, { outageDuringWindow: true }, { contradictory: true },
    { source: "unverified" }, { verdict: "uncertain" }, { sessionId: 999 }, { finalizedAtMs: end - 1 }, { referenceDigest: "not-a-proof" }]) {
    const facts = base(); facts.remedy = null; facts.originalEvidence = { ...evidence(3, "teacher_absent"), ...change } as VerifiedRemedyEvidence;
    assert.deepEqual(decision(facts), { kind: "review", reason: "uncertain_evidence", holdOriginalAllocation: true });
  }
  const absent = base(); absent.remedy = null; absent.originalEvidence = null;
  assert.equal(decision(absent).kind, "review");
});
test("a claimed teacher absence or client-like teacher-fault flag is not a money verdict", () => {
  const facts = base(); facts.remedy!.reason = "teacher_missed"; facts.remedy!.teacherNonDeliveryConfirmed = true;
  assert.deepEqual(decision(facts), { kind: "review", reason: "unverified_original", holdOriginalAllocation: true });
});
test("a recorded teacher acknowledgement can prove their absence but never student absence", () => {
  const facts = base(); facts.remedy = null;
  facts.originalEvidence = { ...evidence(3, "teacher_absent"), source: "teacher_acknowledgement", entireScheduledWindowCovered: false };
  assert.equal(decision(facts).kind, "open_teacher_failure");
  const student = replacement("student_absent"); student.replacementEvidence!.source = "teacher_acknowledgement";
  assert.deepEqual(decision(student), { kind: "review", reason: "uncertain_evidence", holdOriginalAllocation: true });
});
test("teacher failure to deliver any accepted replacement gives a full original-lesson refund intent", () => {
  for (const reason of ["student_missed", "teacher_missed"] as const) {
    const facts = replacement("teacher_absent"); facts.remedy!.reason = reason;
    if (reason === "teacher_missed") { facts.originalEvidence = evidence(3, "teacher_absent"); facts.remedy!.teacherNonDeliveryConfirmed = true; }
    const result = decision(facts); assert.equal(result.kind, "refund_intent");
    if (result.kind === "refund_intent") {
      assert.equal(result.reason, "teacher_missed_replacement"); assert.equal(result.studentRefundNpr, 1000);
      assert.equal(result.teacherNpr, 0); assert.equal(result.platformRetainedNpr, 0);
      assert.equal(result.paymentMoved, false);
    }
  }
});
test("student absence in a teacher-fault replacement preserves the full refund, without a courtesy warning", () => {
  const facts = replacement("student_absent"); facts.originalEvidence = evidence(3, "teacher_absent");
  facts.remedy!.reason = "teacher_missed"; facts.remedy!.teacherNonDeliveryConfirmed = true; facts.remedy!.warningConsent = null;
  const result = decision(facts); assert.equal(result.kind, "refund_intent");
  if (result.kind === "refund_intent") { assert.equal(result.studentRefundNpr, 1000); assert.equal(result.platformRetainedNpr, 0); }
});
test("accepted courtesy no-show splits only this original allocation 70/30, with nothing for the teacher", () => {
  const result = decision(replacement("student_absent"));
  assert.deepEqual(result, { kind: "refund_intent", reason: "student_missed_courtesy_replacement",
    studentRefundNpr: 700, platformRetainedNpr: 300, teacherNpr: 0,
    holdOriginalAllocation: true, paymentMoved: false, requiresProviderConfirmation: true });
});
test("uncertain original delivery cannot turn an accepted courtesy no-show into a retained platform fee", () => {
  for (const originalEvidence of [null, { ...evidence(3, "delivered"), entireScheduledWindowCovered: false },
    { ...evidence(3, "delivered"), verdict: "uncertain" as const }]) {
    const facts = replacement("student_absent"); facts.originalEvidence = originalEvidence;
    assert.deepEqual(decision(facts), { kind: "review", reason: "uncertain_evidence", holdOriginalAllocation: true });
  }
});
test("attending the original lesson invalidates a planned courtesy absence rather than awarding a refund", () => {
  const noOffer = base(); noOffer.originalEvidence = evidence(3, "delivered"); noOffer.nowMs = end + 48 * HOUR;
  assert.deepEqual(decision(noOffer), { kind: "review", reason: "original_attended", holdOriginalAllocation: true });
  for (const verdict of ["student_absent", "teacher_absent", "delivered"] as const) {
    const accepted = replacement(verdict); accepted.originalEvidence = evidence(3, "delivered");
    assert.deepEqual(decision(accepted), { kind: "review", reason: "original_attended", holdOriginalAllocation: true });
  }
});
test("generic or stale warning consent cannot authorize the 30% retention", () => {
  const variants = [null, { studentId: 999 }, { offerId: 999 }, { replacementSessionId: 999 },
    { originalSessionId: 999 }, { bookingId: 999 }, { position: 1 }, { grossNpr: 999 }, { offerStartsAtMs: end },
    { accepted: false }, { acceptedAtMs: end }, { warningVersion: "generic-terms" },
    { policyVersion: "2026-09-29-v1" }, { digest: "b".repeat(64) }];
  for (const change of variants) {
    const facts = replacement("student_absent");
    facts.remedy!.warningConsent = change === null ? null : { ...facts.remedy!.warningConsent!, ...change } as CourtesyWarningConsent;
    assert.deepEqual(decision(facts), { kind: "review", reason: "missing_warning_consent", holdOriginalAllocation: true });
  }
});
test("refund rounding balances every original NPR once, including small and maximum values", () => {
  for (const gross of [1, 2, 3, 9, 10, 11, 999, 1000, 1001, 2_147_483_647]) {
    const parts = courtesyAbsenceWarningAmounts(gross);
    assert.equal(parts.studentRefundNpr + parts.platformRetainedNpr + parts.teacherNpr, gross);
    assert.equal(parts.studentRefundNpr, Math.ceil(gross * 0.7));
  }
  for (const gross of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) assert.throws(() => courtesyAbsenceWarningAmounts(gross));
});
test("odd-NPR partial-refund rounding favours the student, never exceeds the allocation", () => {
  assert.deepEqual(courtesyAbsenceWarningAmounts(11), { studentRefundNpr: 8, platformRetainedNpr: 3, teacherNpr: 0 });
  assert.deepEqual(courtesyAbsenceWarningAmounts(1001), { studentRefundNpr: 701, platformRetainedNpr: 300, teacherNpr: 0 });
});
test("an offer created after the response deadline cannot rescue a delayed refund decision", () => {
  const facts = replacement("student_absent");
  facts.remedy!.offer!.createdAtMs = end + 48 * HOUR;
  facts.remedy!.offer!.acceptedAtMs = end + 49 * HOUR;
  const result = decision(facts); assert.equal(result.kind, "refund_intent");
  if (result.kind === "refund_intent") assert.equal(result.reason, "teacher_did_not_offer");
});
test("completed replacement retains a fresh exact 48-hour review before payout eligibility, not a transfer", () => {
  const facts = replacement("delivered"); const closes = facts.replacementEvidence!.finalizedAtMs + 48 * HOUR;
  assert.deepEqual(decision(facts), { kind: "delivered_review", reviewClosesAtMs: closes, holdOriginalAllocation: true });
  facts.nowMs = closes - 1; assert.equal(decision(facts).kind, "delivered_review");
  facts.nowMs++; assert.deepEqual(decision(facts), { kind: "payout_eligible", reviewClosesAtMs: closes, holdOriginalAllocation: false });
});
test("an active financial review or already paid-out allocation cannot be overridden automatically", () => {
  const facts = replacement("student_absent");
  assert.deepEqual(decision({ ...facts, humanFinancialReviewOpen: true }), { kind: "review", reason: "existing_financial_review", holdOriginalAllocation: true });
  assert.deepEqual(decision({ ...facts, allocationState: "paid_out" }), { kind: "review", reason: "already_paid_out", holdOriginalAllocation: true });
  for (const state of ["refund_owed", "refunded"] as const) assert.deepEqual(decision({ ...facts, allocationState: state }), { kind: "none", reason: "closed" });
});
test("unaccepted teacher-fault offers refund fully; unaccepted courtesy offers require review rather than invent a forfeiture", () => {
  for (const state of ["declined", "expired", "withdrawn"] as const) {
    const facts = replacement("student_absent"); facts.remedy!.state = "review_required";
    Object.assign(facts.remedy!.offer!, { state, acceptedAtMs: null, replacementSessionId: null });
    assert.deepEqual(decision(facts), { kind: "review", reason: "student_declined_courtesy", holdOriginalAllocation: true });
    facts.originalEvidence = evidence(3, "teacher_absent"); facts.remedy!.reason = "teacher_missed";
    assert.equal(decision(facts).kind, "refund_intent");
  }
});
test("invalid identity, money, clocks, schedules or accepted records fail closed", () => {
  for (const change of [{ position: -1 }, { grossNpr: 0 }, { studentId: 0 }, { originalEndsAtMs: start },
    { originalStartsAtMs: NaN }, { allocationState: "unknown" }, { paymentMode: "free" }]) {
    assert.equal(decision({ ...base(), ...change } as AutomatedRemedyFacts).kind, "review");
  }
  for (const change of [{ endsAtMs: end + 40 * DAY }, { expiresAtMs: end + 40 * DAY },
    { endsAtMs: end + 3 * DAY + 2 * HOUR }, { acceptedAtMs: end + 3 * DAY }, { replacementSessionId: null }]) {
    const facts = replacement("student_absent"); Object.assign(facts.remedy!.offer!, change);
    assert.equal(decision(facts).kind, "review");
  }
});

function serializedFixture(initial: AutomatedRemedyFacts) {
  let facts = initial; let lock = Promise.resolve(); const actions = new Map<string, AutomatedRemedyDecision>();
  const adapter: AutomatedRemedyAdapter = { async transaction(run) {
    let unlock!: () => void; const previous = lock; lock = new Promise<void>(resolve => { unlock = resolve; }); await previous;
    try { return await run({ async loadLockedFacts(bookingId, position, nowMs) {
      assert.equal(bookingId, facts.bookingId); assert.equal(position, facts.position); return { ...facts, nowMs };
    }, async readAction(key) { return actions.get(key) ?? null; }, async appendShadowAction(key, locked, result) {
      assert.equal(locked.bookingId, facts.bookingId); assert.ok(!actions.has(key)); actions.set(key, result);
    } }); } finally { unlock(); }
  } };
  return { adapter, actions, setFacts(value: AutomatedRemedyFacts) { facts = value; } };
}
test("100 concurrent retries append one financial shadow action, never 100 refunds", async () => {
  const facts = replacement("student_absent"); const fixture = serializedFixture(facts);
  const responses = await Promise.all(Array.from({ length: 100 }, () => recordAutomatedRemedyShadow(fixture.adapter,
    { bookingId: 1, position: 0, nowMs: facts.nowMs }, shadow)));
  assert.equal(responses.filter(result => result.changed).length, 1); assert.equal(fixture.actions.size, 1);
  assert.ok(responses.every(result => result.decision.kind === "refund_intent"));
});
test("changed later evidence cannot create a second terminal refund action or rewrite the first", async () => {
  const facts = replacement("student_absent"); const fixture = serializedFixture(facts);
  await recordAutomatedRemedyShadow(fixture.adapter, { bookingId: 1, position: 0, nowMs: facts.nowMs }, shadow);
  facts.replacementEvidence = { ...facts.replacementEvidence!, verdict: "teacher_absent" }; fixture.setFacts(facts);
  const replay = await recordAutomatedRemedyShadow(fixture.adapter, { bookingId: 1, position: 0, nowMs: facts.nowMs }, shadow);
  assert.equal(replay.changed, false); assert.equal(fixture.actions.size, 1);
  assert.equal(replay.decision.kind === "refund_intent" && replay.decision.studentRefundNpr, 700);
});
test("refund-versus-payout is re-evaluated under the same payment lock, not stale preflight facts", async () => {
  const facts = replacement("student_absent"); const fixture = serializedFixture(facts);
  fixture.setFacts({ ...facts, allocationState: "paid_out" });
  const result = await recordAutomatedRemedyShadow(fixture.adapter, { bookingId: 1, position: 0, nowMs: facts.nowMs }, shadow);
  assert.equal(result.decision.kind, "review"); assert.equal(fixture.actions.size, 1);
  assert.ok([...fixture.actions.values()].every(action => action.kind !== "refund_intent"));
});
test("disabled automation never enters a transaction or reads a database", async () => {
  const adapter: AutomatedRemedyAdapter = { async transaction() { throw Error("must not run"); } };
  assert.deepEqual(await recordAutomatedRemedyShadow(adapter, { bookingId: 1, position: 0, nowMs: end }, {}),
    { changed: false, decision: { kind: "none", reason: "disabled" } });
});
