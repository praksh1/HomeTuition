import { MAKEUP_LESSON_DAYS, MAKEUP_OFFER_HOURS, type MakeupReason } from "./makeupPolicy.ts";

/** Frozen per purchase. Never reinterpret an old contract when the launch policy changes. */
export const LESSON_REMEDY_POLICY_VERSION = "2026-09-29-v1";
export const LESSON_REMEDY_REVIEW_HOURS = 48;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type RemedyProgramKind = "monthly_tuition" | "short_course";
export interface LessonRemedyPolicy {
  version: typeof LESSON_REMEDY_POLICY_VERSION;
  kind: RemedyProgramKind;
  purchasedLessonCount: number;
  courtesyLimit: number;
  noRollover: true;
  teacherApprovalRequired: true;
  offerResponseHours: typeof MAKEUP_OFFER_HOURS;
  replacementWithinDays: typeof MAKEUP_LESSON_DAYS;
  reviewHours: typeof LESSON_REMEDY_REVIEW_HOURS;
  missedReplacement: "human_review";
}

export class LessonRemedyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LessonRemedyError";
  }
}

function whole(value: number, minimum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new LessonRemedyError("invalid_facts", `${label} is unavailable. Reload before continuing.`);
  }
}

/** The tuition allowance belongs to one paid period, not a calendar month or the account. */
export function snapshotLessonRemedyPolicy(kind: RemedyProgramKind, purchasedLessonCount: number): LessonRemedyPolicy {
  whole(purchasedLessonCount, 1, "The purchased lesson count");
  if (kind !== "monthly_tuition" && kind !== "short_course") {
    throw new LessonRemedyError("invalid_facts", "Choose a valid class format.");
  }
  return {
    version: LESSON_REMEDY_POLICY_VERSION,
    kind,
    purchasedLessonCount,
    courtesyLimit: kind === "monthly_tuition" ? 2
      : purchasedLessonCount === 1 ? 0 : Math.min(3, Math.ceil(purchasedLessonCount / 10)),
    noRollover: true,
    teacherApprovalRequired: true,
    offerResponseHours: MAKEUP_OFFER_HOURS,
    replacementWithinDays: MAKEUP_LESSON_DAYS,
    reviewHours: LESSON_REMEDY_REVIEW_HOURS,
    missedReplacement: "human_review",
  };
}

/** Persisted JSON must be checked, rather than trusted because TypeScript calls it a policy. */
export function readLessonRemedyPolicy(raw: unknown): LessonRemedyPolicy | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Partial<LessonRemedyPolicy>;
  try {
    const expected = snapshotLessonRemedyPolicy(row.kind!, row.purchasedLessonCount!);
    if (Object.keys(expected).some((key) => row[key as keyof LessonRemedyPolicy] !== expected[key as keyof LessonRemedyPolicy])) return null;
    return expected;
  } catch { return null; }
}

export interface RemedyRequestFacts {
  policy: LessonRemedyPolicy;
  reason: MakeupReason;
  originalLessonPurchased: boolean;
  originalIsReplacement: boolean;
  originalScheduledStartMs: number;
  originalScheduledEndMs: number;
  originalActualEndMs: number | null;
  nowMs: number;
  /** Requested/offered reservations + accepted courtesy make-ups for this booking/paid period. */
  courtesyUsedOrReserved: number;
  allocationState: string;
}

export interface RemedyRequestDecision {
  mode: "advance_absence" | "missed_lesson";
  reviewClosesAtMs: number;
  replacementDeadlineMs: number;
  remainingCourtesy: number;
  teacherApprovalRequired: true;
  automaticRefund: false;
}

/** Support remains reachable after this deadline; this validates the standard remedy path only. */
export function assessRemedyRequest(facts: RemedyRequestFacts): RemedyRequestDecision {
  const policy = readLessonRemedyPolicy(facts.policy);
  whole(facts.courtesyUsedOrReserved, 0, "The make-up allowance");
  if (!policy || !["student_missed", "teacher_missed"].includes(facts.reason) ||
      typeof facts.originalLessonPurchased !== "boolean" || typeof facts.originalIsReplacement !== "boolean" ||
      ![facts.originalScheduledStartMs, facts.originalScheduledEndMs, facts.nowMs].every(Number.isFinite) ||
      (facts.originalActualEndMs !== null && !Number.isFinite(facts.originalActualEndMs)) ||
      facts.originalScheduledEndMs <= facts.originalScheduledStartMs) {
    throw new LessonRemedyError("invalid_facts", "The lesson details are unavailable. Reload before continuing.");
  }
  if (facts.originalActualEndMs !== null && facts.originalActualEndMs > facts.nowMs) {
    throw new LessonRemedyError("invalid_facts", "The recorded lesson end time needs Support review.");
  }
  if (!facts.originalLessonPurchased) throw new LessonRemedyError("not_purchased", "Choose a lesson included in your enrollment.");
  if (facts.originalIsReplacement) throw new LessonRemedyError("replacement_chain", "Get help with the existing make-up request. A replacement cannot create another courtesy allowance.");
  // Transfers already owed or completed must be reconciled by Support, not reopened by a client.
  if (!["future", "replacement_pending", "delivered_pending", "disputed", "eligible"].includes(facts.allocationState)) {
    throw new LessonRemedyError("financial_review", "Support must review this lesson's payment before arranging a make-up.");
  }
  const reviewStarts = Math.max(facts.originalScheduledEndMs, facts.originalActualEndMs ?? facts.originalScheduledEndMs);
  const reviewClosesAtMs = reviewStarts + policy.reviewHours * HOUR;
  if (facts.nowMs >= reviewClosesAtMs) {
    throw new LessonRemedyError("standard_window_closed", "The two-day lesson review window has ended. You can still contact Support for help.");
  }
  if (facts.reason === "student_missed") {
    if (policy.courtesyLimit === 0) throw new LessonRemedyError("single_lesson", "One-lesson courses do not include courtesy make-ups. You can still request help or refund review.");
    if (facts.courtesyUsedOrReserved >= policy.courtesyLimit) {
      throw new LessonRemedyError("allowance_used", "Your courtesy make-up allowance for this paid period or course is used. You can still contact Support.");
    }
  }
  return {
    mode: facts.nowMs < facts.originalScheduledStartMs ? "advance_absence" : "missed_lesson",
    reviewClosesAtMs,
    replacementDeadlineMs: facts.originalScheduledEndMs + policy.replacementWithinDays * DAY,
    remainingCourtesy: Math.max(0, policy.courtesyLimit - facts.courtesyUsedOrReserved),
    teacherApprovalRequired: true,
    automaticRefund: false,
  };
}

export const LESSON_REMEDY_STATUSES = ["requested", "offered", "accepted", "delivered_review", "review_required", "resolved", "withdrawn"] as const;
export type LessonRemedyStatus = (typeof LESSON_REMEDY_STATUSES)[number];
export type LessonRemedyActor = "student" | "teacher" | "operator" | "system";
export type LessonRemedyEvent = "offer" | "accept" | "decline" | "expire" | "withdraw" | "delivery_confirmed"
  | "student_missed_replacement" | "teacher_missed_replacement" | "refund_review" | "resolve";

const ALLOWED: Record<LessonRemedyEvent, { actors: LessonRemedyActor[]; from: LessonRemedyStatus[]; to: LessonRemedyStatus }> = {
  offer: { actors: ["teacher"], from: ["requested"], to: "offered" },
  accept: { actors: ["student"], from: ["offered"], to: "accepted" },
  decline: { actors: ["student"], from: ["offered"], to: "review_required" },
  expire: { actors: ["system"], from: ["offered"], to: "review_required" },
  withdraw: { actors: ["student"], from: ["requested", "offered"], to: "withdrawn" },
  delivery_confirmed: { actors: ["operator", "system"], from: ["accepted"], to: "delivered_review" },
  student_missed_replacement: { actors: ["operator"], from: ["accepted"], to: "review_required" },
  teacher_missed_replacement: { actors: ["operator"], from: ["accepted", "delivered_review"], to: "review_required" },
  refund_review: { actors: ["student", "operator"], from: ["requested", "offered", "accepted", "delivered_review"], to: "review_required" },
  resolve: { actors: ["operator"], from: ["requested", "offered", "accepted", "delivered_review", "review_required", "withdrawn"], to: "resolved" },
};

/** Ownership, attendance evidence, expiry, quota and financial locks must precede this transition. */
export function transitionLessonRemedy(status: LessonRemedyStatus, event: LessonRemedyEvent, actor: LessonRemedyActor): LessonRemedyStatus {
  const rule = Object.hasOwn(ALLOWED, event) ? ALLOWED[event] : undefined;
  if (!rule || !rule.actors.includes(actor) || !rule.from.includes(status)) {
    throw new LessonRemedyError("invalid_transition", "This request has changed, or this action is unavailable. Reload to see its current status.");
  }
  return rule.to;
}

export interface RemedyFulfillment {
  status: LessonRemedyStatus;
  originalSessionId: number;
  /** Only populated by the atomic accepted offer -> session enrollment transaction. */
  acceptedReplacementSessionId: number | null;
}

/**
 * An open remedy prevents original-session evidence from releasing the original allocation.
 * No target means HOLD, not "fall back to the original". A resolved case needs the separately
 * recorded operator outcome; this function must never infer a payout or refund from its label.
 */
export function remedySettlementTarget(remedy: RemedyFulfillment): { sessionId: number | null; hold: boolean } {
  whole(remedy.originalSessionId, 1, "The original lesson");
  if (!LESSON_REMEDY_STATUSES.includes(remedy.status)) throw new LessonRemedyError("invalid_facts", "The make-up status is unavailable.");
  if ((remedy.status === "accepted" || remedy.status === "delivered_review") && remedy.acceptedReplacementSessionId !== null) {
    whole(remedy.acceptedReplacementSessionId, 1, "The accepted make-up lesson");
    if (remedy.acceptedReplacementSessionId === remedy.originalSessionId) {
      throw new LessonRemedyError("invalid_facts", "A make-up must be a separate lesson linked to the original.");
    }
    return { sessionId: remedy.acceptedReplacementSessionId, hold: false };
  }
  return { sessionId: null, hold: true };
}

/** Count once per original case: submission reserves a slot before a teacher offers a replacement. */
export function courtesyAllowanceUse(facts: {
  reason: MakeupReason;
  status: LessonRemedyStatus;
  acceptedAtMs: number | null;
  teacherFailedReplacement: boolean;
}): 0 | 1 {
  if (!LESSON_REMEDY_STATUSES.includes(facts.status) || !["student_missed", "teacher_missed"].includes(facts.reason) ||
      typeof facts.teacherFailedReplacement !== "boolean" ||
      (facts.acceptedAtMs !== null && !Number.isFinite(facts.acceptedAtMs))) {
    throw new LessonRemedyError("invalid_facts", "The make-up allowance is unavailable.");
  }
  if ((facts.status === "accepted" || facts.status === "delivered_review") && facts.acceptedAtMs === null) {
    throw new LessonRemedyError("invalid_facts", "The accepted make-up record is incomplete. Support must review it.");
  }
  if (facts.reason === "teacher_missed" || facts.teacherFailedReplacement) return 0;
  if (facts.acceptedAtMs !== null || facts.status === "requested" || facts.status === "offered") return 1;
  return 0;
}

export interface RemedyAcceptanceFacts {
  status: LessonRemedyStatus;
  offerStatus: "proposed" | "accepted" | "declined" | "expired" | "withdrawn";
  allocationState: string;
  nowMs: number;
  expiresAtMs: number;
  replacementStartsAtMs: number;
  replacementEndsAtMs: number;
  originalScheduledEndMs: number;
  originalDurationMinutes: number;
  acceptedReplacementSessionId: number | null;
  refundReviewPending: boolean;
}

/** Recheck under the SAME payment-row lock used by refund approval. Never grants access itself. */
export function assessRemedyAcceptance(facts: RemedyAcceptanceFacts): "accept" | "already_accepted" {
  if (!LESSON_REMEDY_STATUSES.includes(facts.status) ||
      typeof facts.refundReviewPending !== "boolean" ||
      !["proposed", "accepted", "declined", "expired", "withdrawn"].includes(facts.offerStatus) ||
      ![facts.nowMs, facts.expiresAtMs, facts.replacementStartsAtMs, facts.replacementEndsAtMs, facts.originalScheduledEndMs].every(Number.isFinite) ||
      !Number.isSafeInteger(facts.originalDurationMinutes) || facts.originalDurationMinutes <= 0) {
    throw new LessonRemedyError("invalid_facts", "The make-up offer is incomplete. Reload before accepting.");
  }
  // A refunded, already-paid-out or refund-approved allocation cannot also grant replacement access.
  if (!["future", "replacement_pending", "delivered_pending", "disputed", "eligible"].includes(facts.allocationState) || facts.refundReviewPending) {
    throw new LessonRemedyError("financial_review", "Support is reviewing this lesson's payment. A make-up cannot be accepted until that review is resolved.");
  }
  if (facts.status === "accepted" && facts.offerStatus === "accepted" && facts.acceptedReplacementSessionId !== null) {
    whole(facts.acceptedReplacementSessionId, 1, "The accepted make-up lesson");
    return "already_accepted";
  }
  if (facts.status !== "offered" || facts.offerStatus !== "proposed" || facts.acceptedReplacementSessionId !== null) {
    throw new LessonRemedyError("invalid_transition", "This offer has changed. Reload your lesson request.");
  }
  if (facts.nowMs >= Math.min(facts.expiresAtMs, facts.replacementStartsAtMs)) {
    throw new LessonRemedyError("offer_expired", "This offer has expired or the make-up has started. Your request remains available for Support review.");
  }
  if (facts.replacementStartsAtMs <= facts.originalScheduledEndMs ||
      facts.replacementEndsAtMs - facts.replacementStartsAtMs !== facts.originalDurationMinutes * 60_000 ||
      facts.replacementEndsAtMs > facts.originalScheduledEndMs + MAKEUP_LESSON_DAYS * DAY) {
    throw new LessonRemedyError("invalid_offer", "This offer no longer matches the original lesson's length or make-up deadline. Ask the teacher to review it.");
  }
  return "accept";
}

/** One authoritative end anchor shared by original and replacement review, never browser time. */
export function lessonReviewClosesAt(scheduledEndMs: number, recordedEndMs: number | null): number {
  if (!Number.isFinite(scheduledEndMs) || (recordedEndMs !== null && !Number.isFinite(recordedEndMs))) {
    throw new LessonRemedyError("invalid_facts", "The lesson end time is unavailable.");
  }
  return Math.max(scheduledEndMs, recordedEndMs ?? scheduledEndMs) + LESSON_REMEDY_REVIEW_HOURS * HOUR;
}
