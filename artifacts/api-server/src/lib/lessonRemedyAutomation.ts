import { createHash } from "node:crypto";

/** Prospective terms only. V1 purchases and cases continue to use their frozen human-review policy. */
export const REMEDY_AUTOMATION_VERSION = "2026-09-30-v2";
export const COURTESY_ABSENCE_WARNING_VERSION = "courtesy-noshow-70-30-v1";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_NPR = 2_147_483_647; // The existing money columns are PostgreSQL integer, not floating-point rupees.

export interface AutomatedRemedyPolicy {
  version: typeof REMEDY_AUTOMATION_VERSION;
  teacherResponseHours: 48;
  offerResponseDays: 7;
  replacementWithinDays: 30;
  deliveredReviewHours: 48;
  studentNoShowRefundBps: 7000;
  studentNoShowPlatformBps: 3000;
  studentNoShowTeacherBps: 0;
  uncertainEvidence: "human_review";
  noRetroactiveChanges: true;
}
export function snapshotAutomatedRemedyPolicy(): AutomatedRemedyPolicy {
  return { version: REMEDY_AUTOMATION_VERSION, teacherResponseHours: 48, offerResponseDays: 7,
    replacementWithinDays: 30, deliveredReviewHours: 48, studentNoShowRefundBps: 7000,
    studentNoShowPlatformBps: 3000, studentNoShowTeacherBps: 0,
    uncertainEvidence: "human_review", noRetroactiveChanges: true };
}
export function readAutomatedRemedyPolicy(value: unknown): AutomatedRemedyPolicy | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const expected = snapshotAutomatedRemedyPolicy();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== Object.keys(expected).length || Object.keys(expected).some(
    key => row[key] !== expected[key as keyof AutomatedRemedyPolicy])) return null;
  return expected;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function id(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function time(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function amount(value: number): boolean { return Number.isSafeInteger(value) && value > 0 && value <= MAX_NPR; }
const digestPattern = /^[a-f0-9]{64}$/;

/** Issued by the server, accepted at checkout and frozen atomically with the purchase. */
export function automatedRemedyPurchaseDigest(input: {
  studentId: number; bookingId: number; policy: AutomatedRemedyPolicy;
}): string {
  if (!id(input.studentId) || !id(input.bookingId) || !readAutomatedRemedyPolicy(input.policy)) throw Error("Invalid make-up purchase terms.");
  return digest({ studentId: input.studentId, bookingId: input.bookingId, policy: readAutomatedRemedyPolicy(input.policy) });
}
export interface AutomatedPurchaseConsent {
  studentId: number;
  bookingId: number;
  policy: unknown;
  /** Server receipt time; it must precede or equal the original booking creation. */
  acceptedAtMs: number;
  termsDigest: string;
}
export interface CourtesyWarningIdentity {
  bookingId: number; position: number; studentId: number; originalSessionId: number;
  offerId: number; offerStartsAtMs: number; offerEndsAtMs: number; grossNpr: number;
}
export interface CourtesyWarningConsent extends CourtesyWarningIdentity {
  /** Filled server-side only after acceptance creates the replacement. Not needed to issue the warning. */
  replacementSessionId: number;
  policyVersion: typeof REMEDY_AUTOMATION_VERSION;
  warningVersion: typeof COURTESY_ABSENCE_WARNING_VERSION;
  digest: string;
  accepted: true;
  /** Set by the server in the same acceptance transaction, never supplied by the client. */
  acceptedAtMs: number;
}
/** Bind the warning to this exact student, accepted offer and original allocation, not a generic checkbox. */
export function courtesyAbsenceWarningDigest(input: CourtesyWarningIdentity): string {
  if (![input.bookingId, input.studentId, input.originalSessionId, input.offerId].every(id)
    || !Number.isSafeInteger(input.position) || input.position < 0 || !amount(input.grossNpr)
    || !time(input.offerStartsAtMs) || !time(input.offerEndsAtMs) || input.offerEndsAtMs <= input.offerStartsAtMs) throw Error("Invalid make-up warning identity.");
  return digest({ policyVersion: REMEDY_AUTOMATION_VERSION, warningVersion: COURTESY_ABSENCE_WARNING_VERSION,
    bookingId: input.bookingId, position: input.position, studentId: input.studentId,
    originalSessionId: input.originalSessionId, offerId: input.offerId,
    offerStartsAtMs: input.offerStartsAtMs, offerEndsAtMs: input.offerEndsAtMs, grossNpr: input.grossNpr });
}
export function courtesyAbsenceWarningAmounts(grossNpr: number): { studentRefundNpr: number; platformRetainedNpr: number; teacherNpr: 0 } {
  if (!amount(grossNpr)) throw Error("The original lesson amount is invalid.");
  // Integer arithmetic only. Current storage is whole NPR; its residual favours the student.
  // A future paisa boundary must supply/rename that unit explicitly, never reinterpret these columns.
  const studentRefundNpr = Number((BigInt(grossNpr) * 7_000n + 9_999n) / 10_000n);
  return { studentRefundNpr, platformRetainedNpr: grossNpr - studentRefundNpr, teacherNpr: 0 };
}

export type AutomatedEvidenceVerdict = "teacher_absent" | "student_absent" | "delivered" | "uncertain";
export interface VerifiedRemedyEvidence {
  sessionId: number;
  /** Per purchased student: delivered = they received the lesson; student_absent = the
   * teacher fulfilled the promised availability but this student did not attend. Merely
   * observing teacher presence is not a delivered or student_absent verdict. */
  verdict: AutomatedEvidenceVerdict;
  /** Never client text, silence, camera status, lack of drawing, or lack of rows. */
  source: "covered_server_records" | "teacher_acknowledgement" | "operator_review" | "unverified";
  referenceDigest: string;
  finalizedAtMs: number;
  /** A complete signed/provider + classroom observation window must be independently attested. */
  entireScheduledWindowCovered: boolean;
  outageDuringWindow: boolean;
  contradictory: boolean;
}
export interface AutomatedRemedyOffer {
  id: number; createdAtMs: number; startsAtMs: number; endsAtMs: number; expiresAtMs: number;
  state: "proposed" | "accepted" | "declined" | "expired" | "withdrawn";
  acceptedAtMs: number | null; replacementSessionId: number | null;
}
export interface AutomatedRemedyCase {
  id: number;
  policyVersion: string;
  reason: "student_missed" | "teacher_missed";
  state: "requested" | "offered" | "accepted" | "delivered_review" | "review_required" | "resolved" | "withdrawn";
  requestedAtMs: number;
  /** Original non-delivery is exempt only once independently verified; an allegation is not fault. */
  teacherNonDeliveryConfirmed: boolean;
  offer: AutomatedRemedyOffer | null;
  warningConsent: CourtesyWarningConsent | null;
}
export interface AutomatedRemedyFacts {
  bookingId: number; position: number; studentId: number; originalSessionId: number;
  bookingCreatedAtMs: number; originalStartsAtMs: number; originalEndsAtMs: number;
  grossNpr: number;
  allocationState: "future" | "replacement_pending" | "delivered_pending" | "disputed" | "eligible" | "paid_out" | "refund_owed" | "refunded";
  /** Simulated capture is never genuine money. Gateway execution requires a separate provider adapter. */
  paymentMode: "simulation" | "gateway";
  purchaseConsent: AutomatedPurchaseConsent | null;
  originalEvidence: VerifiedRemedyEvidence | null;
  replacementEvidence: VerifiedRemedyEvidence | null;
  remedy: AutomatedRemedyCase | null;
  humanFinancialReviewOpen: boolean;
  nowMs: number;
}
export type AutomatedRemedyDecision =
  | { kind: "none"; reason: "disabled" | "legacy_terms" | "not_due" | "closed" | "waiting_for_offer" | "waiting_for_acceptance" | "waiting_for_lesson" }
  | { kind: "review"; reason: "invalid_records" | "unverified_original" | "uncertain_evidence" | "original_attended" | "existing_financial_review" | "already_paid_out" | "missing_warning_consent" | "student_declined_courtesy"; holdOriginalAllocation: true }
  | { kind: "open_teacher_failure"; teacherResponseDueAtMs: number; holdOriginalAllocation: true }
  | { kind: "delivered_review"; reviewClosesAtMs: number; holdOriginalAllocation: true }
  | { kind: "payout_eligible"; reviewClosesAtMs: number; holdOriginalAllocation: false }
  | { kind: "refund_intent"; reason: "teacher_did_not_offer" | "teacher_offer_not_accepted" | "replacement_deadline_passed" | "teacher_missed_replacement" | "student_missed_teacher_fault_replacement" | "student_missed_courtesy_replacement";
      studentRefundNpr: number; platformRetainedNpr: number; teacherNpr: 0; holdOriginalAllocation: true;
      paymentMoved: false; requiresProviderConfirmation: true };

/** Off unless an explicit shadow integration is requested. This module never sends or confirms cash. */
export function remedyAutomationMode(env: Record<string, string | undefined> = process.env): "disabled" | "shadow" {
  return env.LESSON_REMEDY_AUTOMATION_MODE === "shadow" ? "shadow" : "disabled";
}
function evidenceUsable(evidence: VerifiedRemedyEvidence | null, sessionId: number, endMs: number, nowMs: number): boolean {
  if (!evidence || evidence.sessionId !== sessionId || !digestPattern.test(evidence.referenceDigest)
    || !time(evidence.finalizedAtMs) || evidence.finalizedAtMs < endMs || evidence.finalizedAtMs > nowMs
    || evidence.verdict === "uncertain" || evidence.source === "unverified"
    || evidence.outageDuringWindow !== false || evidence.contradictory !== false) return false;
  if (evidence.source === "teacher_acknowledgement") return evidence.verdict === "teacher_absent";
  return evidence.source === "operator_review" || evidence.source === "covered_server_records" && evidence.entireScheduledWindowCovered === true;
}
function validWarning(facts: AutomatedRemedyFacts, offer: AutomatedRemedyOffer): boolean {
  const c = facts.remedy?.warningConsent;
  if (!c || !offer.replacementSessionId || c.accepted !== true || c.policyVersion !== REMEDY_AUTOMATION_VERSION
    || c.warningVersion !== COURTESY_ABSENCE_WARNING_VERSION || c.acceptedAtMs !== offer.acceptedAtMs
    || c.bookingId !== facts.bookingId || c.position !== facts.position || c.studentId !== facts.studentId
    || c.originalSessionId !== facts.originalSessionId || c.offerId !== offer.id
    || c.offerStartsAtMs !== offer.startsAtMs || c.offerEndsAtMs !== offer.endsAtMs
    || c.replacementSessionId !== offer.replacementSessionId || c.grossNpr !== facts.grossNpr) return false;
  return c.digest === courtesyAbsenceWarningDigest(c);
}
function review(reason: Extract<AutomatedRemedyDecision, { kind: "review" }>["reason"]): AutomatedRemedyDecision {
  return { kind: "review", reason, holdOriginalAllocation: true };
}
function refund(facts: AutomatedRemedyFacts, reason: Extract<AutomatedRemedyDecision, { kind: "refund_intent" }>["reason"], partial = false): AutomatedRemedyDecision {
  return { kind: "refund_intent", reason, ...(partial ? courtesyAbsenceWarningAmounts(facts.grossNpr)
    : { studentRefundNpr: facts.grossNpr, platformRetainedNpr: 0, teacherNpr: 0 as const }),
    holdOriginalAllocation: true, paymentMoved: false, requiresProviderConfirmation: true };
}

/**
 * Deterministic and prospective. The privileged loader must supply frozen purchase records,
 * durable evidence attestations and case history under the SAME original payment-row lock as
 * refund/payout/acceptance. It must never translate a client's allegation into verified evidence.
 * This is an executable shadow policy, not an active route, background job or payment gateway.
 */
export function assessAutomatedLessonRemedy(facts: AutomatedRemedyFacts,
  env: Record<string, string | undefined> = process.env): AutomatedRemedyDecision {
  if (remedyAutomationMode(env) === "disabled") return { kind: "none", reason: "disabled" };
  const policy = readAutomatedRemedyPolicy(facts.purchaseConsent?.policy);
  if (!policy || !facts.purchaseConsent) return { kind: "none", reason: "legacy_terms" };
  if (![facts.bookingId, facts.studentId, facts.originalSessionId].every(id) || !amount(facts.grossNpr)
    || !Number.isSafeInteger(facts.position) || facts.position < 0
    || ![facts.bookingCreatedAtMs, facts.originalStartsAtMs, facts.originalEndsAtMs, facts.nowMs].every(time)
    || facts.originalEndsAtMs <= facts.originalStartsAtMs || facts.bookingCreatedAtMs > facts.nowMs
    || !["future", "replacement_pending", "delivered_pending", "disputed", "eligible", "paid_out", "refund_owed", "refunded"].includes(facts.allocationState)
    || !["simulation", "gateway"].includes(facts.paymentMode)
    || typeof facts.humanFinancialReviewOpen !== "boolean") return review("invalid_records");
  const consent = facts.purchaseConsent;
  if (consent.studentId !== facts.studentId || consent.bookingId !== facts.bookingId
    || !time(consent.acceptedAtMs) || consent.acceptedAtMs > facts.bookingCreatedAtMs
    || consent.termsDigest !== automatedRemedyPurchaseDigest({ studentId: facts.studentId, bookingId: facts.bookingId, policy })) return review("invalid_records");
  if (["refunded", "refund_owed"].includes(facts.allocationState)) return { kind: "none", reason: "closed" };
  if (facts.allocationState === "paid_out") return review("already_paid_out");
  if (facts.humanFinancialReviewOpen) return review("existing_financial_review");
  if (facts.nowMs < facts.originalEndsAtMs) return { kind: "none", reason: "not_due" };
  if (facts.originalEvidence?.outageDuringWindow || facts.originalEvidence?.contradictory
    || facts.replacementEvidence?.outageDuringWindow || facts.replacementEvidence?.contradictory) return review("uncertain_evidence");
  const originalVerified = evidenceUsable(facts.originalEvidence, facts.originalSessionId, facts.originalEndsAtMs, facts.nowMs);
  const verifiedTeacherFault = originalVerified && facts.originalEvidence!.verdict === "teacher_absent";
  const c = facts.remedy;
  if (!c) {
    if (verifiedTeacherFault) return { kind: "open_teacher_failure", teacherResponseDueAtMs: facts.nowMs + policy.teacherResponseHours * HOUR, holdOriginalAllocation: true };
    return originalVerified ? { kind: "none", reason: "closed" } : review("uncertain_evidence");
  }
  if (c.policyVersion !== REMEDY_AUTOMATION_VERSION) return { kind: "none", reason: "legacy_terms" };
  if (!id(c.id) || !time(c.requestedAtMs) || c.requestedAtMs > facts.nowMs
    || !["student_missed", "teacher_missed"].includes(c.reason)
    || !["requested", "offered", "accepted", "delivered_review", "review_required", "resolved", "withdrawn"].includes(c.state)
    || typeof c.teacherNonDeliveryConfirmed !== "boolean") return review("invalid_records");
  if (c.state === "resolved" || c.state === "withdrawn") return { kind: "none", reason: "closed" };
  if (c.reason === "teacher_missed" && !verifiedTeacherFault) return review("unverified_original");
  // A teacher-fault flag must agree with independently recorded evidence, not a client reason.
  if (c.teacherNonDeliveryConfirmed && !verifiedTeacherFault) return review("unverified_original");
  // An unknown original delivery cannot be reclassified as student fault merely because
  // the request used the courtesy reason. Missing coverage never authorizes a retained fee.
  if (!originalVerified) return review("uncertain_evidence");
  // A planned absence is only a request. If this student actually received the original
  // lesson, no courtesy refund or forfeiture is owed; resolve/cancel the obsolete case.
  if (c.reason === "student_missed" && facts.originalEvidence!.verdict === "delivered") return review("original_attended");
  const teacherFault = verifiedTeacherFault;
  const deadline = facts.originalEndsAtMs + policy.replacementWithinDays * DAY;
  const offer = c.offer;
  if (!offer) {
    if (!["requested", "review_required"].includes(c.state)) return review("invalid_records");
    if (facts.nowMs >= Math.min(c.requestedAtMs + policy.teacherResponseHours * HOUR, deadline)) return refund(facts, "teacher_did_not_offer");
    return { kind: "none", reason: "waiting_for_offer" };
  }
  if (!id(offer.id) || ![offer.createdAtMs, offer.startsAtMs, offer.endsAtMs, offer.expiresAtMs].every(time)
    || offer.startsAtMs <= facts.originalEndsAtMs || offer.endsAtMs - offer.startsAtMs !== facts.originalEndsAtMs - facts.originalStartsAtMs
    || offer.endsAtMs > deadline || offer.expiresAtMs > offer.startsAtMs
    || offer.createdAtMs < c.requestedAtMs || offer.createdAtMs > facts.nowMs || offer.expiresAtMs <= offer.createdAtMs
    || offer.expiresAtMs > offer.createdAtMs + policy.offerResponseDays * DAY
    || !["proposed", "accepted", "declined", "expired", "withdrawn"].includes(offer.state)) return review("invalid_records");
  if (offer.createdAtMs >= c.requestedAtMs + policy.teacherResponseHours * HOUR) return refund(facts, "teacher_did_not_offer");
  if (offer.state !== "accepted") {
    if (offer.acceptedAtMs !== null || offer.replacementSessionId !== null || c.state === "accepted" || c.state === "delivered_review") return review("invalid_records");
    if (["declined", "expired", "withdrawn"].includes(offer.state) || facts.nowMs >= offer.expiresAtMs) {
      return teacherFault ? refund(facts, "teacher_offer_not_accepted") : review("student_declined_courtesy");
    }
    return { kind: "none", reason: "waiting_for_acceptance" };
  }
  if (!id(offer.replacementSessionId!) || !time(offer.acceptedAtMs!)
    || offer.acceptedAtMs! >= Math.min(offer.expiresAtMs, offer.startsAtMs) || offer.acceptedAtMs! < offer.createdAtMs
    || offer.acceptedAtMs! > facts.nowMs || !["accepted", "delivered_review", "review_required"].includes(c.state)) return review("invalid_records");
  if (facts.nowMs < offer.endsAtMs) return { kind: "none", reason: "waiting_for_lesson" };
  if (!evidenceUsable(facts.replacementEvidence, offer.replacementSessionId!, offer.endsAtMs, facts.nowMs)) return review("uncertain_evidence");
  const evidence = facts.replacementEvidence!;
  if (evidence.verdict === "teacher_absent") return refund(facts, "teacher_missed_replacement");
  if (evidence.verdict === "student_absent") {
    if (teacherFault) return refund(facts, "student_missed_teacher_fault_replacement");
    if (!validWarning(facts, offer)) return review("missing_warning_consent");
    return refund(facts, "student_missed_courtesy_replacement", true);
  }
  if (evidence.verdict !== "delivered") return review("uncertain_evidence");
  const reviewClosesAtMs = Math.max(offer.endsAtMs, evidence.finalizedAtMs) + policy.deliveredReviewHours * HOUR;
  return facts.nowMs >= reviewClosesAtMs
    ? { kind: "payout_eligible", reviewClosesAtMs, holdOriginalAllocation: false }
    : { kind: "delivered_review", reviewClosesAtMs, holdOriginalAllocation: true };
}

/** One terminal refund identity per original lesson, never per replacement or retry attempt. */
export function automatedRemedyActionKey(facts: Pick<AutomatedRemedyFacts, "bookingId" | "position">,
  decision: AutomatedRemedyDecision): string {
  if (!id(facts.bookingId) || !Number.isSafeInteger(facts.position) || facts.position < 0) throw Error("Invalid original allocation identity.");
  const type = decision.kind === "refund_intent" ? "refund" : decision.kind;
  return `${REMEDY_AUTOMATION_VERSION}:${facts.bookingId}:${facts.position}:${type}`;
}

export interface AutomatedRemedyTransaction {
  /** Acquire the original payment first, then booking/case, and load server-only immutable facts. */
  loadLockedFacts(bookingId: number, position: number, nowMs: number): Promise<AutomatedRemedyFacts>;
  readAction(key: string): Promise<AutomatedRemedyDecision | null>;
  /** Insert under a unique action key and the same row locks, not a fire-and-forget promise. */
  appendShadowAction(key: string, facts: AutomatedRemedyFacts, decision: AutomatedRemedyDecision): Promise<void>;
}
export interface AutomatedRemedyAdapter {
  transaction<T>(run: (tx: AutomatedRemedyTransaction) => Promise<T>): Promise<T>;
}
/** Re-evaluated under the shared financial lock. No provider calls, receipt changes or payout occur. */
export async function recordAutomatedRemedyShadow(adapter: AutomatedRemedyAdapter, input: {
  bookingId: number; position: number; nowMs: number;
}, env: Record<string, string | undefined> = process.env): Promise<{ changed: boolean; decision: AutomatedRemedyDecision }> {
  if (remedyAutomationMode(env) === "disabled") return { changed: false, decision: { kind: "none", reason: "disabled" } };
  if (!id(input.bookingId) || !Number.isSafeInteger(input.position) || input.position < 0 || !time(input.nowMs)) throw Error("Invalid original allocation identity.");
  return adapter.transaction(async tx => {
    const facts = await tx.loadLockedFacts(input.bookingId, input.position, input.nowMs);
    if (facts.bookingId !== input.bookingId || facts.position !== input.position || facts.nowMs !== input.nowMs) throw Error("The locked original allocation changed.");
    const decision = assessAutomatedLessonRemedy(facts, env);
    if (decision.kind === "none") return { changed: false, decision };
    const key = automatedRemedyActionKey(facts, decision);
    const previous = await tx.readAction(key);
    // A committed action is history. Later evidence can require human reconciliation, not a second refund.
    if (previous) return { changed: false, decision: previous };
    await tx.appendShadowAction(key, facts, decision);
    return { changed: true, decision };
  });
}
