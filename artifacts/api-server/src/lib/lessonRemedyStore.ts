import { and, asc, desc, eq, gt, inArray, sql, lt, gte } from "drizzle-orm";
import {
  db, batchTestBookingsTable, batchTestPaymentsTable, batchTestSessionsTable, batchTestContractsTable,
  batchTestLedgerEntriesTable, sessionsTable, sessionEnrollmentsTable, usersTable, sessionActivityTable,
  sessionParticipationTable, disputesTable, lessonRemedyCasesTable, lessonRemedyOffersTable,
  lessonRemedyEventsTable, testClassesTable, teacherLeaveTable, type LessonRemedyCaseRow, type LessonRemedyOfferRow,
} from "@workspace/db";
import { assessRemedyRequest, assessRemedyAcceptance, courtesyAllowanceUse, lessonReviewClosesAt,
  establishedLessonRemedyPolicy, LessonRemedyError, type LessonRemedyStatus } from "./lessonRemedies";
import { readBatchSnapshot, type ProgramBatchSnapshot } from "./programBatches";
import type { SimulatedBatchReceipt } from "./batchTestPayment";
import { transitionProgramAllocation, type ProgramAllocationEvent, type ProgramAllocationState } from "./programCommerce";
import { originalAllocationRefundEvents } from "./lessonRemedyFinance";
import { assertTeacherSchedule, lockTeacherSchedule } from "./teacherSchedule";
import { accountClosureCompleted } from "./accountClosureStore";
import { lessonRemediesEnabled, ensureLessonRemedySchema, lessonRemedySchemaReady } from "./lessonRemedySchema";
import type { LessonRemedyListView, LessonRemedyCaseView, LessonRemedyLessonView } from "./lessonRemedyView";
import { RemedyRefusal, validRemedyRequestKey, remedyNote, remedyRequestFingerprint as fingerprint, canOpenLessonRemedyRequest } from "./lessonRemedyRules";
import { lessonRemedyParticipantContext, type RemedyContextEvent } from "./lessonRemedyContext.ts";
export { RemedyRefusal, validRemedyRequestKey, remedyNote } from "./lessonRemedyRules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export interface RemedyActor { userId: number; role: string }
const ACTIVE_DISPUTES = ["open", "opened", "assigned", "processing", "in_review"] as const;
const ALLOCATIONS_OPEN = ["future", "replacement_pending", "delivered_pending", "disputed", "eligible"];
const DAY = 86_400_000;
const HOUR = 3_600_000;
function refuse(code: string, message: string, status = 409): never { throw new RemedyRefusal(status, code, message); }
async function enabled() {
  if (!lessonRemediesEnabled()) refuse("makeups_paused", "Make-up requests are paused. Your existing lesson and refund-review options remain available.", 503);
  try { await ensureLessonRemedySchema(); }
  catch { refuse("makeups_unavailable", "Make-up records are temporarily unavailable. Please try again or contact Support.", 503); }
}
interface Purchase {
  bookingId: number; batchId: number; studentId: number; studentName: string; teacherId: number;
  teacherName: string; position: number; session: typeof sessionsTable.$inferSelect;
  paymentStatus: string; receipt: SimulatedBatchReceipt; snapshot: ProgramBatchSnapshot;
  actualEnd: Date | null;
}
const PURCHASE_COLUMNS = { booking: batchTestBookingsTable, payment: batchTestPaymentsTable,
  mapping: batchTestSessionsTable, contract: batchTestContractsTable, session: sessionsTable,
  enrollment: sessionEnrollmentsTable, studentName: usersTable.name, endedAt: sessionActivityTable.endedAt };
type PurchaseRow = { booking: typeof batchTestBookingsTable.$inferSelect; payment: typeof batchTestPaymentsTable.$inferSelect;
  mapping: typeof batchTestSessionsTable.$inferSelect; contract: typeof batchTestContractsTable.$inferSelect;
  session: typeof sessionsTable.$inferSelect; enrollment: typeof sessionEnrollmentsTable.$inferSelect;
  studentName: string; endedAt: Date | null };
function readPurchase(row: PurchaseRow, historicalRead = false): Purchase {
  if (!["paid", "test", ...(historicalRead ? ["refunded"] : [])].includes(row.enrollment.paymentStatus)) refuse("not_purchased", "Choose a lesson included in your enrollment.", 404);
  const snapshot = readBatchSnapshot(row.contract.snapshot); const receipt = row.payment.receipt as SimulatedBatchReceipt;
  const promised = snapshot?.lessons.find((lesson) => lesson.position === row.mapping.position);
  if (!snapshot || !promised || !Array.isArray(receipt?.allocations) ||
      !receipt.allocations.some((allocation) => allocation.position === row.mapping.position) ||
      receipt.allocations.some((a) => ![a.grossNpr, a.teacherNpr, a.fadkoNpr].every((v) => Number.isSafeInteger(v) && v >= 0) || a.teacherNpr + a.fadkoNpr !== a.grossNpr) ||
      new Set(receipt.allocations.map((allocation) => allocation.position)).size !== receipt.allocations.length ||
      Date.parse(promised.startsAt) !== row.session.date.getTime() || promised.durationMinutes !== row.session.duration) {
    refuse("purchase_needs_review", "Support must check this lesson's original enrollment record.");
  }
  return { bookingId: row.booking.id, batchId: row.booking.batchId, studentId: row.booking.studentId, studentName: row.studentName,
    teacherId: row.session.teacherId, teacherName: row.session.teacherName, position: row.mapping.position,
    session: row.session, receipt, snapshot, paymentStatus: row.enrollment.paymentStatus, actualEnd: row.endedAt };
}
/** Frozen purchase, not merely a profile-level enrollment or a mutable program listing. */
async function purchase(reader: Pick<Tx, "select">, sessionId: number, studentId: number, historicalRead = false): Promise<Purchase> {
  const [row] = await reader.select(PURCHASE_COLUMNS).from(batchTestSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, batchTestSessionsTable.sessionId))
    .innerJoin(batchTestBookingsTable, and(eq(batchTestBookingsTable.batchId, batchTestSessionsTable.batchId), eq(batchTestBookingsTable.studentId, studentId)))
    .innerJoin(batchTestPaymentsTable, eq(batchTestPaymentsTable.bookingId, batchTestBookingsTable.id))
    .innerJoin(batchTestContractsTable, eq(batchTestContractsTable.batchId, batchTestBookingsTable.batchId))
    .innerJoin(sessionEnrollmentsTable, and(eq(sessionEnrollmentsTable.sessionId, sessionsTable.id), eq(sessionEnrollmentsTable.studentId, studentId)))
    .innerJoin(usersTable, eq(usersTable.id, studentId))
    .leftJoin(sessionActivityTable, eq(sessionActivityTable.sessionId, sessionsTable.id))
    .where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!row) refuse("not_purchased", "Choose a lesson included in your enrollment.", 404);
  return readPurchase(row, historicalRead);
}

/** Payment first is shared with operator refunds and settlement; booking lock serializes quota. */
async function lockPurchase(tx: Tx, bookingId: number) {
  const [payment] = await tx.select().from(batchTestPaymentsTable).where(eq(batchTestPaymentsTable.bookingId, bookingId)).for("update");
  const [booking] = await tx.select().from(batchTestBookingsTable).where(eq(batchTestBookingsTable.id, bookingId)).for("update");
  if (!payment || !booking) refuse("purchase_needs_review", "This enrollment needs Support review.");
}
async function openAccounts(tx: Tx, p: Purchase) {
  // Account closure takes the same account row; never create a commitment after closure wins.
  const ids = [...new Set([p.teacherId, p.studentId])].sort((a, b) => a - b);
  const rows = await tx.select({ id: usersTable.id, suspendedAt: usersTable.suspendedAt }).from(usersTable)
    .where(inArray(usersTable.id, ids)).orderBy(asc(usersTable.id)).for("update");
  if (rows.length !== ids.length || rows.some((row) => row.suspendedAt)) refuse("account_unavailable", "A participant account cannot arrange this make-up right now.");
  for (const id of ids) if (await accountClosureCompleted(id, tx)) refuse("account_closed", "A closed account cannot arrange a new make-up.");
}
async function allocationState(tx: Pick<Tx, "select">, p: Purchase): Promise<ProgramAllocationState> {
  const [entry] = await tx.select({ state: batchTestLedgerEntriesTable.toState }).from(batchTestLedgerEntriesTable)
    .where(and(eq(batchTestLedgerEntriesTable.bookingId, p.bookingId), eq(batchTestLedgerEntriesTable.position, p.position)))
    .orderBy(desc(batchTestLedgerEntriesTable.id)).limit(1);
  return (entry?.state ?? "future") as ProgramAllocationState;
}
async function activeRefundReview(tx: Pick<Tx, "select">, p: Purchase): Promise<boolean> {
  const [complaint] = await tx.select({ id: disputesTable.id }).from(disputesTable)
    .where(and(eq(disputesTable.userId, p.studentId), sql`(${disputesTable.sessionId}=${p.session.id} OR EXISTS(
      SELECT 1 FROM lesson_remedy_cases c JOIN lesson_remedy_offers o ON o.case_id=c.id
      WHERE c.original_booking_id=${p.bookingId} AND c.original_position=${p.position}
        AND o.accepted_at IS NOT NULL AND o.replacement_session_id=${disputesTable.sessionId}))`,
      inArray(disputesTable.status, ACTIVE_DISPUTES), inArray(disputesTable.reason, ["Payment Issue", "Refund Request"]))).limit(1);
  return !!complaint;
}
async function ledger(tx: Tx, p: Purchase, actorId: number, event: ProgramAllocationEvent, detail: Record<string, unknown>) {
  const allocation = p.receipt.allocations.find((entry) => entry.position === p.position)!;
  const fromState = await allocationState(tx, p);
  const toState = transitionProgramAllocation(fromState, event);
  await tx.insert(batchTestLedgerEntriesTable).values({ bookingId: p.bookingId, position: p.position, actorId,
    event, fromState, toState, grossNpr: allocation.grossNpr, teacherNpr: allocation.teacherNpr,
    fadkoNpr: allocation.fadkoNpr, detail: { ...detail, paymentMoved: false, originalSessionId: p.session.id } });
}
function policy(p: Purchase, recorded: Array<{ policyVersion: string; policySnapshot: unknown }> = []) {
  return establishedLessonRemedyPolicy(p.snapshot.tuitionPeriod ? "monthly_tuition" : "short_course", p.receipt.allocations.length, recorded);
}
async function bookingPolicy(tx: Pick<Tx, "select">, p: Purchase) {
  const recorded = await tx.select({ policyVersion: lessonRemedyCasesTable.policyVersion, policySnapshot: lessonRemedyCasesTable.policySnapshot })
    .from(lessonRemedyCasesTable).where(eq(lessonRemedyCasesTable.originalBookingId, p.bookingId)).orderBy(asc(lessonRemedyCasesTable.id));
  return policy(p, recorded);
}
function requireOpenEnrollment(p: Purchase) {
  if (p.paymentStatus === "refunded") refuse("enrollment_closed", "This enrollment is closed. Its make-up history remains available, but it cannot create new commitments.");
}
async function availableTeacher(tx: Tx, p: Purchase, startsAt: Date, endsAt: Date) {
  await lockTeacherSchedule(tx, p.teacherId);
  await assertTeacherSchedule(tx, p.teacherId, [{ startsAt, durationMinutes: p.session.duration, label: "Make-up lesson" }]);
  const [leave] = await tx.select({ id: teacherLeaveTable.id }).from(teacherLeaveTable)
    .where(and(eq(teacherLeaveTable.teacherId, p.teacherId), lt(teacherLeaveTable.startsAt, endsAt), gte(teacherLeaveTable.endsAt, startsAt))).limit(1);
  if (leave) refuse("teacher_leave_conflict", "This time falls within your declared leave. Choose a time when you can teach.");
}
async function used(tx: Pick<Tx, "select">, bookingId: number): Promise<number> {
  const cases = await tx.select().from(lessonRemedyCasesTable).where(eq(lessonRemedyCasesTable.originalBookingId, bookingId));
  if (!cases.length) return 0;
  const offers = await tx.select().from(lessonRemedyOffersTable).where(inArray(lessonRemedyOffersTable.caseId, cases.map((c) => c.id)));
  return cases.reduce((total, c) => total + courtesyAllowanceUse({
    reason: c.reason === "teacher_missed" && c.teacherNonDeliveryConfirmed ? "teacher_missed" : "student_missed",
    status: caseView(c, offers, { userId: 0, role: "system" }, Date.now()).status,
    acceptedAtMs: offers.find((o) => o.caseId === c.id && o.acceptedAt)?.acceptedAt?.getTime() ?? null,
    teacherFailedReplacement: c.teacherFailedReplacement,
  }), 0);
}
async function trail(tx: Tx, c: LessonRemedyCaseRow, actor: RemedyActor, event: string,
  toStatus: LessonRemedyStatus, requestKey: string | null, detail: Record<string, unknown> = {}, offerId?: number) {
  await tx.insert(lessonRemedyEventsTable).values({ caseId: c.id, offerId, actorId: actor.userId,
    actorRole: actor.role === "admin" ? "operator" : actor.role, event, fromStatus: c.status,
    toStatus, requestKey, detail });
}
async function replay(tx: Tx, c: LessonRemedyCaseRow, actor: RemedyActor, event: string, requestKey: string, requestFingerprint: string) {
  const [previous] = await tx.select().from(lessonRemedyEventsTable)
    .where(and(eq(lessonRemedyEventsTable.caseId, c.id), eq(lessonRemedyEventsTable.requestKey, requestKey))).limit(1);
  if (!previous) return false;
  if (previous.actorId !== actor.userId || previous.event !== event ||
      (previous.detail as Record<string, unknown>).requestFingerprint !== requestFingerprint) refuse("request_key_reused", "This action key already belongs to different details. Refresh and try again.");
  return true;
}
async function expired(tx: Tx, c: LessonRemedyCaseRow, now: number): Promise<LessonRemedyCaseRow> {
  if (c.status !== "offered") return c;
  const [offer] = await tx.select().from(lessonRemedyOffersTable)
    .where(and(eq(lessonRemedyOffersTable.caseId, c.id), eq(lessonRemedyOffersTable.status, "proposed"))).for("update");
  if (!offer || now < Math.min(offer.expiresAt.getTime(), offer.startsAt.getTime())) return c;
  await tx.update(lessonRemedyOffersTable).set({ status: "expired" }).where(eq(lessonRemedyOffersTable.id, offer.id));
  const [changed] = await tx.update(lessonRemedyCasesTable).set({ status: "review_required", updatedAt: new Date(now) })
    .where(eq(lessonRemedyCasesTable.id, c.id)).returning();
  await tx.insert(lessonRemedyEventsTable).values({ caseId: c.id, offerId: offer.id, actorRole: "system", event: "expire",
    fromStatus: c.status, toStatus: "review_required", detail: { noAutomaticRefund: true } });
  return changed!;
}
function result(c: LessonRemedyCaseRow, replacementSessionId: number | null = null) {
  return { caseId: c.id, batchId: null as number | null, originalSessionId: c.originalSessionId, replacementSessionId, changed: true };
}

export async function requestLessonMakeup(actor: RemedyActor, sessionId: number,
  input: { reason: "student_missed" | "teacher_missed"; note?: string; requestKey: string }) {
  await enabled();
  if (actor.role !== "student") refuse("student_only", "Only the enrolled student can request a make-up.", 403);
  const preliminary = await purchase(db, sessionId, actor.userId);
  return db.transaction(async (tx) => {
    await lockPurchase(tx, preliminary.bookingId);
    const p = await purchase(tx, sessionId, actor.userId);
    await openAccounts(tx, p);
    const requestFingerprint = fingerprint({ reason: input.reason, note: remedyNote(input.note) });
    const [old] = await tx.select().from(lessonRemedyCasesTable)
      .where(and(eq(lessonRemedyCasesTable.originalBookingId, p.bookingId), eq(lessonRemedyCasesTable.originalPosition, p.position))).for("update");
    if (old && await replay(tx, old, actor, "request", input.requestKey, requestFingerprint)) return { ...result(old), batchId: p.batchId, changed: false };
    const existing = old ? await expired(tx, old, Date.now()) : null;
    if (existing) {
      const [accepted] = await tx.select({ id: lessonRemedyOffersTable.id }).from(lessonRemedyOffersTable)
        .where(and(eq(lessonRemedyOffersTable.caseId, existing.id), sql`${lessonRemedyOffersTable.acceptedAt} IS NOT NULL`));
      if (!canOpenLessonRemedyRequest({ status: existing.status, outcome: existing.outcome, acceptedEver: !!accepted })) {
        refuse("request_exists", "This lesson already has a make-up request. Open its existing record.");
      }
    }
    if (await activeRefundReview(tx, p)) refuse("refund_review_pending", "Your lesson is already being reviewed by Support. Continue through that request before arranging a make-up.");
    const terms = await bookingPolicy(tx, p); const allowanceUsed = await used(tx, p.bookingId);
    const facts = { policy: terms, reason: input.reason, originalLessonPurchased: true, originalIsReplacement: false,
      originalScheduledStartMs: p.session.date.getTime(), originalScheduledEndMs: p.session.date.getTime() + p.session.duration * 60_000,
      originalActualEndMs: p.actualEnd?.getTime() ?? null, nowMs: Date.now(), courtesyUsedOrReserved: allowanceUsed,
      allocationState: await allocationState(tx, p) };
    // Teacher absence is an allegation. It can enter review when the courtesy limit is used,
    // but no exemption or replacement is granted until the teacher/operator confirms it.
    const decision = assessRemedyRequest(facts);
    const now = new Date();
    const fields = { reason: input.reason, teacherNonDeliveryConfirmed: false, status: "requested",
      policyVersion: terms.version, policySnapshot: terms, requestedBeforeStart: decision.mode === "advance_absence",
      originalClaimClosesAt: new Date(decision.reviewClosesAtMs), replacementDeadlineAt: new Date(decision.replacementDeadlineMs),
      outcome: null, resolvedAt: null, resolvedBy: null, updatedAt: now };
    const [c] = existing
      ? await tx.update(lessonRemedyCasesTable).set(fields).where(eq(lessonRemedyCasesTable.id, existing.id)).returning()
      : await tx.insert(lessonRemedyCasesTable).values({ ...fields, originalBookingId: p.bookingId,
          originalPosition: p.position, originalSessionId: sessionId, studentId: actor.userId, teacherId: p.teacherId }).returning();
    await ledger(tx, p, actor.userId, "makeup_requested", { caseId: c!.id, allegedReason: input.reason });
    await trail(tx, c!, actor, "request", "requested", input.requestKey, { note: remedyNote(input.note), allegedReason: input.reason, requestFingerprint });
    return { ...result(c!), batchId: p.batchId };
  });
}

async function withCase<T>(actor: RemedyActor, caseId: number, run: (tx: Tx, c: LessonRemedyCaseRow, p: Purchase) => Promise<T>): Promise<T> {
  await enabled();
  const [hint] = await db.select().from(lessonRemedyCasesTable).where(eq(lessonRemedyCasesTable.id, caseId));
  if (!hint || !(actor.role === "admin" || actor.role === "student" && hint.studentId === actor.userId || actor.role === "teacher" && hint.teacherId === actor.userId)) {
    refuse("not_found", "This make-up request is unavailable.", 404);
  }
  return db.transaction(async (tx) => {
    await lockPurchase(tx, hint.originalBookingId);
    const [record] = await tx.select().from(lessonRemedyCasesTable).where(eq(lessonRemedyCasesTable.id, caseId)).for("update");
    if (!record) refuse("not_found", "This make-up request is unavailable.", 404);
    // Existing cases retain their frozen history for read/replay and operator review.
    // New requests use the strict purchase reader and cannot revive a refunded enrollment.
    const p = await purchase(tx, record.originalSessionId, record.studentId, true);
    if (p.bookingId !== record.originalBookingId || p.position !== record.originalPosition || p.teacherId !== record.teacherId) {
      refuse("purchase_needs_review", "The make-up and original lesson records need Support review.");
    }
    return run(tx, await expired(tx, record, Date.now()), p);
  });
}
export async function offerLessonMakeup(actor: RemedyActor, caseId: number,
  input: { startsAt: string; confirmTeacherNonDelivery?: boolean; requestKey: string }) {
  return withCase(actor, caseId, async (tx, c, p) => {
    if (actor.role !== "teacher" || actor.userId !== c.teacherId) refuse("teacher_only", "Only this lesson's teacher can propose a replacement.", 403);
    const requestFingerprint = fingerprint({ startsAt: input.startsAt, confirmTeacherNonDelivery: input.confirmTeacherNonDelivery === true });
    if (await replay(tx, c, actor, "offer", input.requestKey, requestFingerprint)) return { ...result(c), batchId: p.batchId, changed: false };
    requireOpenEnrollment(p);
    // Ordinary bookings/creation take this advisory before user-row closure guards. Match
    // that order so a make-up never holds a user UPDATE while waiting on their schedule lock.
    await lockTeacherSchedule(tx, p.teacherId);
    await openAccounts(tx, p);
    const [acceptedPreviously] = await tx.select({ id: lessonRemedyOffersTable.id }).from(lessonRemedyOffersTable)
      .where(and(eq(lessonRemedyOffersTable.caseId, c.id), sql`${lessonRemedyOffersTable.acceptedAt} IS NOT NULL`)).limit(1);
    if (!(["requested", "review_required"].includes(c.status)) || acceptedPreviously || c.outcome !== null) refuse("request_changed", "This request has changed. Refresh before proposing a replacement.");
    if (!ALLOCATIONS_OPEN.includes(await allocationState(tx, p)) || await activeRefundReview(tx, p)) refuse("financial_review", "Support is reviewing this original lesson. Please wait for that review.");
    const now = Date.now(); const starts = Date.parse(input.startsAt); const ends = starts + p.session.duration * 60_000;
    if (!Number.isFinite(starts) || starts <= Math.max(now, p.session.date.getTime() + p.session.duration * 60_000) || ends > c.replacementDeadlineAt.getTime()) {
      refuse("invalid_offer", "Choose a future time after the original lesson. The make-up must finish within its 30-day deadline.");
    }
    const confirmsTeacherFailure = c.reason === "teacher_missed" && (c.teacherNonDeliveryConfirmed || input.confirmTeacherNonDelivery === true);
    const allowanceUsed = await used(tx, p.bookingId); const limit = (await bookingPolicy(tx, p)).courtesyLimit;
    const hasReservation = c.status === "requested";
    if (!confirmsTeacherFailure && (c.reason === "teacher_missed" || allowanceUsed + (hasReservation ? 0 : 1) > limit || limit === 0)) {
      refuse("teacher_confirmation_required", "A teacher-missed lesson requires your confirmation that the original lesson was not delivered.");
    }
    await availableTeacher(tx, p, new Date(starts), new Date(ends));
    const [last] = await tx.select({ version: lessonRemedyOffersTable.version }).from(lessonRemedyOffersTable)
      .where(eq(lessonRemedyOffersTable.caseId, c.id)).orderBy(desc(lessonRemedyOffersTable.version)).limit(1);
    const expiresAt = new Date(Math.min(now + 7 * DAY, starts));
    const [offer] = await tx.insert(lessonRemedyOffersTable).values({ caseId: c.id, version: (last?.version ?? 0) + 1,
      offeredBy: actor.userId, startsAt: new Date(starts), endsAt: new Date(ends), expiresAt, createdAt: new Date(now) }).returning();
    await tx.update(lessonRemedyCasesTable).set({ status: "offered", teacherNonDeliveryConfirmed: confirmsTeacherFailure,
      updatedAt: new Date(now) }).where(eq(lessonRemedyCasesTable.id, c.id));
    await trail(tx, c, actor, "offer", "offered", input.requestKey, { teacherNonDeliveryConfirmed: confirmsTeacherFailure, requestFingerprint }, offer!.id);
    return { ...result(c), batchId: p.batchId };
  });
}
export async function acceptLessonMakeup(actor: RemedyActor, caseId: number, input: { offerId: number; requestKey: string }) {
  return withCase(actor, caseId, async (tx, c, p) => {
    if (actor.role !== "student" || actor.userId !== c.studentId) refuse("student_only", "Only the enrolled student can accept this offer.", 403);
    const requestFingerprint = fingerprint({ offerId: input.offerId });
    const isReplay = await replay(tx, c, actor, "accept", input.requestKey, requestFingerprint);
    const [offer] = await tx.select().from(lessonRemedyOffersTable)
      .where(and(eq(lessonRemedyOffersTable.id, input.offerId), eq(lessonRemedyOffersTable.caseId, c.id))).for("update");
    if (!offer) refuse("offer_changed", "This offer is unavailable. Refresh your request.");
    // Replaying a committed acceptance is history, not access. Preserve its link even after
    // review or a refund; no enrollment, status, ledger or notification is recreated.
    if (isReplay) {
      if (!offer.acceptedAt || !offer.replacementSessionId) refuse("acceptance_needs_review", "Support must check this previously accepted offer's saved lesson link.");
      return { ...result(c, offer.replacementSessionId), batchId: p.batchId, changed: false };
    }
    requireOpenEnrollment(p);
    await lockTeacherSchedule(tx, p.teacherId);
    await openAccounts(tx, p);
    const terms = await bookingPolicy(tx, p);
    const decision = assessRemedyAcceptance({ status: c.status as LessonRemedyStatus, offerStatus: offer.status as "proposed",
      allocationState: await allocationState(tx, p), refundReviewPending: await activeRefundReview(tx, p), nowMs: Date.now(),
      expiresAtMs: offer.expiresAt.getTime(), replacementStartsAtMs: offer.startsAt.getTime(), replacementEndsAtMs: offer.endsAt.getTime(),
      originalScheduledEndMs: p.session.date.getTime() + p.session.duration * 60_000, originalDurationMinutes: p.session.duration,
      acceptedReplacementSessionId: offer.replacementSessionId });
    if (decision === "already_accepted") return { ...result(c, offer.replacementSessionId), batchId: p.batchId, changed: false };
    if (c.reason === "teacher_missed" && !c.teacherNonDeliveryConfirmed) refuse("teacher_confirmation_required", "The teacher must confirm the original lesson was not delivered before this offer can be accepted.");
    if (!(c.reason === "teacher_missed" && c.teacherNonDeliveryConfirmed) && await used(tx, p.bookingId) > terms.courtesyLimit) refuse("allowance_used", "Your make-up allowance changed. Contact Support to review this offer.");
    await availableTeacher(tx, p, offer.startsAt, offer.endsAt);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(838210, ${p.studentId})`);
    const otherLessons = await tx.select({ session: sessionsTable }).from(sessionEnrollmentsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionEnrollmentsTable.sessionId))
      .where(and(eq(sessionEnrollmentsTable.studentId, p.studentId), inArray(sessionEnrollmentsTable.paymentStatus, ["paid", "test"]), inArray(sessionsTable.status, ["upcoming", "live"])));
    if (otherLessons.some(({ session }) => offer.startsAt.getTime() < session.date.getTime() + session.duration * 60_000 && offer.endsAt.getTime() > session.date.getTime())) {
      refuse("student_schedule_conflict", "This time overlaps another lesson you have booked. Ask your teacher for another time.");
    }
    const [session] = await tx.insert(sessionsTable).values({ teacherId: p.teacherId, teacherName: p.teacherName,
      subject: p.session.subject, topic: `${p.snapshot.programTitle} · Make-up for lesson ${p.position + 1}`,
      date: offer.startsAt, duration: p.session.duration, maxStudents: 1, enrolledCount: 1, price: 0 }).returning();
    await tx.insert(sessionEnrollmentsTable).values({ sessionId: session!.id, studentId: p.studentId,
      paymentStatus: p.paymentStatus, paymentMethod: "linked_makeup", paymentReference: null });
    if (p.paymentStatus === "test") {
      const [testClass] = await tx.select().from(testClassesTable).where(eq(testClassesTable.sessionId, p.session.id));
      if (!testClass) refuse("test_identity_missing", "Support must check the original practice lesson before creating its make-up.");
      await tx.insert(testClassesTable).values({ sessionId: session!.id, teacherId: p.teacherId, grantId: testClass.grantId });
    }
    const now = Date.now();
    // Recheck the clocks after schedule locks and inserts. Throw rolls back the zero-price seat.
    if (now >= Math.min(offer.expiresAt.getTime(), offer.startsAt.getTime())) refuse("offer_expired", "This offer expired while it was being accepted. Please ask your teacher for another time.");
    await tx.update(lessonRemedyOffersTable).set({ status: "accepted", acceptedAt: new Date(now), replacementSessionId: session!.id }).where(eq(lessonRemedyOffersTable.id, offer.id));
    await tx.update(lessonRemedyCasesTable).set({ status: "accepted", updatedAt: new Date(now) }).where(eq(lessonRemedyCasesTable.id, c.id));
    await trail(tx, c, actor, "accept", "accepted", input.requestKey, { replacementSessionId: session!.id, noNewCharge: true, requestFingerprint }, offer.id);
    return { ...result(c, session!.id), batchId: p.batchId };
  });
}
export async function actOnLessonMakeup(actor: RemedyActor, caseId: number,
  input: { action: "withdraw" | "decline" | "reject"; note?: string; requestKey: string }) {
  return withCase(actor, caseId, async (tx, c, p) => {
    const teacherAction = input.action === "reject";
    if (teacherAction ? actor.role !== "teacher" || actor.userId !== c.teacherId : actor.role !== "student" || actor.userId !== c.studentId) {
      refuse("action_unavailable", "This action is not available to your account.", 403);
    }
    const note = remedyNote(input.note, teacherAction);
    const requestFingerprint = fingerprint({ action: input.action, note });
    if (await replay(tx, c, actor, input.action, input.requestKey, requestFingerprint)) return { ...result(c), batchId: p.batchId, changed: false };
    requireOpenEnrollment(p);
    if (!(["requested", "offered"].includes(c.status)) || input.action === "decline" && c.status !== "offered") refuse("request_changed", "This request has changed. Open its current details.");
    await tx.update(lessonRemedyOffersTable).set(input.action === "decline" ? { status: "declined", declinedAt: new Date() } : { status: "withdrawn", withdrawnAt: new Date() })
      .where(and(eq(lessonRemedyOffersTable.caseId, c.id), eq(lessonRemedyOffersTable.status, "proposed")));
    const toStatus = input.action === "withdraw" ? "withdrawn" : "review_required";
    if (input.action === "withdraw" && !await activeRefundReview(tx, p) && await allocationState(tx, p) === "replacement_pending") {
      await ledger(tx, p, actor.userId, "makeup_withdrawn", { caseId: c.id, noReplacementAccepted: true });
    }
    await tx.update(lessonRemedyCasesTable).set({ status: toStatus, updatedAt: new Date() }).where(eq(lessonRemedyCasesTable.id, c.id));
    await trail(tx, c, actor, input.action, toStatus, input.requestKey, { note, noAutomaticRefund: true, requestFingerprint });
    return { ...result(c), batchId: p.batchId };
  });
}

export async function resolveLessonMakeup(actor: RemedyActor, caseId: number, input: {
  outcome: "replacement_delivered" | "student_missed_replacement" | "teacher_missed_replacement" | "refund_review" | "refund_approved" | "refund_denied" | "no_adjustment";
  note: string; confirmed: boolean; requestKey: string;
}) {
  return withCase(actor, caseId, async (tx, c, p) => {
    if (actor.role !== "admin") refuse("operator_only", "Support must review this decision.", 403);
    const note = remedyNote(input.note, true);
    if (!input.confirmed) refuse("confirmation_required", "Confirm that you reviewed the linked lesson and evidence before recording this decision.", 400);
    const requestFingerprint = fingerprint({ outcome: input.outcome, note, confirmed: input.confirmed });
    if (await replay(tx, c, actor, "resolve", input.requestKey, requestFingerprint)) return { ...result(c), batchId: p.batchId, changed: false };
    if (c.status === "resolved" || ["refunded", "paid_out"].includes(await allocationState(tx, p))) {
      refuse("review_closed", "This decision is already complete. Keep its history unchanged or ask Support to reconcile it.");
    }
    const [accepted] = await tx.select().from(lessonRemedyOffersTable)
      .where(and(eq(lessonRemedyOffersTable.caseId, c.id), sql`${lessonRemedyOffersTable.acceptedAt} IS NOT NULL`));
    if (input.outcome === "refund_approved") {
      let events: ProgramAllocationEvent[];
      try { events = originalAllocationRefundEvents(await allocationState(tx, p)); }
      catch { refuse("refund_needs_reconciliation", "This lesson was already paid out. Support must reconcile it before approving a refund."); }
      for (const event of events) await ledger(tx, p, actor.userId, event, { caseId: c.id, note, humanRefundApproval: true,
        replacementSessionId: accepted?.replacementSessionId ?? null });
      for (const sessionId of [...new Set([p.session.id, ...(accepted?.replacementSessionId ? [accepted.replacementSessionId] : [])])]) {
        const revoked = await tx.update(sessionEnrollmentsTable).set({ paymentStatus: "refunded" })
          .where(and(eq(sessionEnrollmentsTable.sessionId, sessionId), eq(sessionEnrollmentsTable.studentId, p.studentId),
            inArray(sessionEnrollmentsTable.paymentStatus, ["paid", "test"]))).returning({ id: sessionEnrollmentsTable.id });
        if (revoked.length) await tx.update(sessionsTable).set({ enrolledCount: sql`greatest(0,${sessionsTable.enrolledCount}-${revoked.length})` }).where(eq(sessionsTable.id, sessionId));
        if (sessionId !== p.session.id) await tx.update(sessionsTable).set({ status: "cancelled" })
          .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.enrolledCount, 0), eq(sessionsTable.status, "upcoming")));
      }
      await tx.update(lessonRemedyOffersTable).set({ status: "withdrawn", withdrawnAt: new Date() })
        .where(and(eq(lessonRemedyOffersTable.caseId, c.id), eq(lessonRemedyOffersTable.status, "proposed")));
      await tx.update(lessonRemedyCasesTable).set({ status: "resolved", outcome: "refund_review", resolvedBy: actor.userId,
        resolvedAt: new Date(), updatedAt: new Date() }).where(eq(lessonRemedyCasesTable.id, c.id));
      await trail(tx, c, actor, "resolve", "resolved", input.requestKey, { outcome: "refund_approved", note,
        originalAmountNpr: p.receipt.allocations.find((a) => a.position === p.position)!.grossNpr, paymentMoved: false, requestFingerprint }, accepted?.id);
    } else if (input.outcome === "refund_denied") {
      if (await activeRefundReview(tx, p)) refuse("support_decision_pending", "Complete the student's linked financial Support review first. This action cannot implicitly deny an open ticket.");
      if (!accepted?.replacementSessionId || !c.replacementReviewClosesAt || c.teacherFailedReplacement ||
          c.status !== "review_required" || await allocationState(tx, p) !== "disputed") {
        refuse("review_restore_unavailable", "Only a previously confirmed replacement with a completed Support decision can resume its existing review window.");
      }
      await ledger(tx, p, actor.userId, "makeup_review_restored", { caseId: c.id, note,
        replacementSessionId: accepted.replacementSessionId, originalReviewClosesAt: c.replacementReviewClosesAt.toISOString() });
      await tx.update(lessonRemedyCasesTable).set({ status: "delivered_review", outcome: "replacement_delivered",
        resolvedBy: actor.userId, updatedAt: new Date() }).where(eq(lessonRemedyCasesTable.id, c.id));
      await trail(tx, c, actor, "resolve", "delivered_review", input.requestKey,
        { outcome: "refund_denied", note, requestFingerprint, preservedReviewClosesAt: c.replacementReviewClosesAt.toISOString() }, accepted.id);
    } else if (input.outcome === "replacement_delivered") {
      if (await activeRefundReview(tx, p) || await allocationState(tx, p) === "disputed") {
        refuse("financial_review", "Complete the student's linked financial Support review before confirming or restoring delivery. No complaint was denied.");
      }
      if (!accepted?.replacementSessionId || !["accepted", "review_required"].includes(c.status)) refuse("delivery_unavailable", "Choose an accepted replacement that needs delivery review.");
      const [replacement] = await tx.select({ session: sessionsTable, endedAt: sessionActivityTable.endedAt })
        .from(sessionsTable).leftJoin(sessionActivityTable, eq(sessionActivityTable.sessionId, sessionsTable.id))
        .where(eq(sessionsTable.id, accepted.replacementSessionId));
      const [presence] = await tx.select({ id: sessionParticipationTable.userId }).from(sessionParticipationTable)
        .where(and(eq(sessionParticipationTable.sessionId, accepted.replacementSessionId), eq(sessionParticipationTable.userId, c.teacherId),
          eq(sessionParticipationTable.role, "teacher"), gt(sessionParticipationTable.presentMs, 0))).limit(1);
      if (!replacement || replacement.session.status !== "completed" || !presence || !replacement.endedAt || Date.now() < replacement.session.date.getTime() + replacement.session.duration * 60_000) {
        refuse("delivery_evidence_missing", "The replacement's completed record and recorded teacher attendance are not ready. Keep its payment held for review.");
      }
      if (replacement.session.teacherId !== p.teacherId || replacement.session.date.getTime() !== accepted.startsAt.getTime() ||
          replacement.session.duration !== p.session.duration || replacement.session.price !== 0 || accepted.endsAt.getTime() !== accepted.startsAt.getTime() + p.session.duration * 60_000) {
        refuse("replacement_record_changed", "The accepted replacement's dates or linked lesson record changed. Keep its payment held for Support review.");
      }
      const anchor = Math.max(replacement.session.date.getTime() + replacement.session.duration * 60_000,
        replacement.endedAt.getTime(), Date.now());
      await tx.update(lessonRemedyCasesTable).set({ status: "delivered_review", outcome: input.outcome,
        replacementReviewClosesAt: new Date(lessonReviewClosesAt(anchor, null)), resolvedBy: actor.userId,
        updatedAt: new Date() }).where(eq(lessonRemedyCasesTable.id, c.id));
      await ledger(tx, p, actor.userId, "makeup_delivery_confirmed", { caseId: c.id,
        replacementSessionId: accepted.replacementSessionId, evidenceReviewed: true, note });
      await trail(tx, c, actor, "resolve", "delivered_review", input.requestKey, { outcome: input.outcome, note, evidenceReviewed: true, requestFingerprint }, accepted.id);
    } else {
      if (["student_missed_replacement", "teacher_missed_replacement"].includes(input.outcome) && !accepted?.replacementSessionId) refuse("replacement_missing", "There is no accepted replacement to review.");
      if (input.outcome === "no_adjustment" && accepted) refuse("accepted_remedy", "An accepted replacement needs delivery, absence or refund review before it can be closed.");
      if (input.outcome === "no_adjustment") {
        // No adjustment is a documented human decision, not a payout authorization. Integration
        // keeps the allocation held until a separate evidence-backed settlement decision.
        await tx.update(lessonRemedyCasesTable).set({ status: "resolved", outcome: input.outcome, resolvedBy: actor.userId,
          resolvedAt: new Date(), updatedAt: new Date() }).where(eq(lessonRemedyCasesTable.id, c.id));
        if (!await activeRefundReview(tx, p) && await allocationState(tx, p) === "replacement_pending") {
          await ledger(tx, p, actor.userId, "makeup_withdrawn", { caseId: c.id, documentedHumanReview: true, note });
        }
      } else {
        await tx.update(lessonRemedyCasesTable).set({ status: "review_required", outcome: input.outcome,
          ...(input.outcome === "teacher_missed_replacement" ? { teacherFailedReplacement: true } : {}),
          resolvedBy: actor.userId, updatedAt: new Date() }).where(eq(lessonRemedyCasesTable.id, c.id));
      }
      await trail(tx, c, actor, "resolve", input.outcome === "no_adjustment" ? "resolved" : "review_required",
        input.requestKey, { outcome: input.outcome, note, noAutomaticRefund: true, requestFingerprint }, accepted?.id);
    }
    return { ...result(c, accepted?.replacementSessionId ?? null), batchId: p.batchId };
  });
}

function caseView(c: LessonRemedyCaseRow, offers: LessonRemedyOfferRow[], actor: RemedyActor, now: number,
  context: RemedyContextEvent[] = []): LessonRemedyCaseView {
  const offer = offers.filter((o) => o.caseId === c.id).at(-1) ?? null;
  const expiredOffer = c.status === "offered" && offer?.status === "proposed" && now >= Math.min(offer.startsAt.getTime(), offer.expiresAt.getTime());
  const status = (expiredOffer ? "review_required" : c.status) as LessonRemedyStatus;
  const student = actor.role === "student" && actor.userId === c.studentId;
  const teacher = actor.role === "teacher" && actor.userId === c.teacherId;
  return { id: c.id, status, reason: c.reason as "student_missed" | "teacher_missed",
    teacherNonDeliveryConfirmed: c.teacherNonDeliveryConfirmed, requestedAt: c.requestedAt.toISOString(),
    replacementDeadlineAt: c.replacementDeadlineAt.toISOString(), replacementReviewClosesAt: c.replacementReviewClosesAt?.toISOString() ?? null,
    outcome: c.outcome,
    ...lessonRemedyParticipantContext(c, actor, context),
    offer: offer ? { id: offer.id, status: expiredOffer ? "expired" : offer.status, startsAt: offer.startsAt.toISOString(),
      endsAt: offer.endsAt.toISOString(), expiresAt: offer.expiresAt.toISOString(), replacementSessionId: offer.replacementSessionId } : null,
    actions: { withdraw: student && ["requested", "offered"].includes(status),
      offer: teacher && ["requested", "review_required"].includes(status) && !offers.some((o) => o.caseId === c.id && o.acceptedAt) && c.outcome === null,
      reject: teacher && ["requested", "offered"].includes(status),
      accept: student && status === "offered" && offer?.status === "proposed",
      decline: student && status === "offered", confirmDelivery: actor.role === "admin" && ["accepted", "review_required"].includes(status) && !!offer?.acceptedAt,
      resolve: actor.role === "admin" && status !== "resolved" } };
}

export async function listLessonRemedies(actor: RemedyActor, batchId?: number): Promise<LessonRemedyListView> {
  const now = Date.now(); const base = { role: actor.role, serverNow: new Date(now).toISOString(), quotas: [], lessons: [] };
  const writeEnabled = lessonRemediesEnabled();
  if (!writeEnabled && !await lessonRemedySchemaReady()) return { ...base, enabled: false, unavailableReason: "Make-up requests are not open yet. You can still contact Support for lesson or refund review." };
  if (writeEnabled) await enabled();
  if (!["student", "teacher", "admin"].includes(actor.role)) refuse("not_available", "This lesson view is unavailable.", 403);
  const rows = await db.select(PURCHASE_COLUMNS)
    .from(batchTestBookingsTable).innerJoin(batchTestSessionsTable, eq(batchTestSessionsTable.batchId, batchTestBookingsTable.batchId))
    .innerJoin(sessionsTable, eq(sessionsTable.id, batchTestSessionsTable.sessionId))
    .innerJoin(batchTestPaymentsTable, eq(batchTestPaymentsTable.bookingId, batchTestBookingsTable.id))
    .innerJoin(batchTestContractsTable, eq(batchTestContractsTable.batchId, batchTestBookingsTable.batchId))
    .innerJoin(sessionEnrollmentsTable, and(eq(sessionEnrollmentsTable.sessionId, sessionsTable.id), eq(sessionEnrollmentsTable.studentId, batchTestBookingsTable.studentId)))
    .innerJoin(usersTable, eq(usersTable.id, batchTestBookingsTable.studentId))
    .leftJoin(sessionActivityTable, eq(sessionActivityTable.sessionId, sessionsTable.id))
    .leftJoin(lessonRemedyCasesTable, and(eq(lessonRemedyCasesTable.originalBookingId, batchTestBookingsTable.id),
      eq(lessonRemedyCasesTable.originalPosition, batchTestSessionsTable.position)))
    .where(and(batchId === undefined ? undefined : eq(batchTestBookingsTable.batchId, batchId),
      actor.role === "student" ? undefined : sql`${lessonRemedyCasesTable.id} IS NOT NULL`,
      actor.role === "student" ? eq(batchTestBookingsTable.studentId, actor.userId) : actor.role === "teacher" ? eq(sessionsTable.teacherId, actor.userId) : undefined))
    .orderBy(sql`CASE WHEN ${lessonRemedyCasesTable.id} IS NOT NULL AND ${lessonRemedyCasesTable.status} NOT IN ('resolved','withdrawn') THEN 0
      WHEN ${lessonRemedyCasesTable.id} IS NULL THEN 1 ELSE 2 END`, desc(lessonRemedyCasesTable.id),
      desc(batchTestBookingsTable.id), asc(batchTestSessionsTable.position)).limit(501);
  const truncated = rows.length > 500;
  const lessons: LessonRemedyLessonView[] = []; const quotas = new Map<number, LessonRemedyListView["quotas"][number]>();
  // Only joined, purchased allocations are emitted. A historical late join must never see a
  // courtesy action for an earlier session merely because the class has a mapping for it.
  const purchases = rows.slice(0, 500).filter((row) => ["paid", "test", "refunded"].includes(row.enrollment.paymentStatus))
    .map((row) => readPurchase(row, true));
  const bookingIds = [...new Set(purchases.map((p) => p.bookingId))];
  const cases = bookingIds.length ? await db.select().from(lessonRemedyCasesTable).where(inArray(lessonRemedyCasesTable.originalBookingId, bookingIds)) : [];
  // Two bounded context rows per case, not a raw event dump or an operator-note feed.
  const context = cases.length ? (await db.execute(sql`SELECT DISTINCT ON (e.case_id,e.event)
    e.id,e.case_id AS "caseId",e.actor_id AS "actorId",e.actor_role AS "actorRole",e.event,e.detail
    FROM lesson_remedy_events e JOIN lesson_remedy_cases c ON c.id=e.case_id
    WHERE e.case_id IN (${sql.join(cases.map(record => sql`${record.id}`), sql`,`)})
      AND ((e.event='request' AND e.actor_role='student' AND e.actor_id=c.student_id)
        OR (e.event='reject' AND e.actor_role='teacher' AND e.actor_id=c.teacher_id))
    ORDER BY e.case_id,e.event,e.id DESC`)).rows as unknown as RemedyContextEvent[] : [];
  const offers = cases.length ? await db.select().from(lessonRemedyOffersTable).where(inArray(lessonRemedyOffersTable.caseId, cases.map((c) => c.id))).orderBy(asc(lessonRemedyOffersTable.version)) : [];
  const history = bookingIds.length ? await db.select().from(batchTestLedgerEntriesTable).where(inArray(batchTestLedgerEntriesTable.bookingId, bookingIds)).orderBy(asc(batchTestLedgerEntriesTable.id)) : [];
  const studentIds = [...new Set(purchases.map((p) => p.studentId))];
  // Bounded, read-only account projection; the write still rechecks and locks fresh account rows.
  const participantIds = actor.role === "student"
    ? [...new Set(purchases.flatMap((p) => [p.studentId, p.teacherId]))] : [];
  const accounts = participantIds.length ? await db.select({ id: usersTable.id, suspendedAt: usersTable.suspendedAt })
    .from(usersTable).where(inArray(usersTable.id, participantIds)) : [];
  const openAccountIds = new Set(accounts.filter((account) => !account.suspendedAt).map((account) => account.id));
  if (participantIds.length) {
    const closureTable = await db.execute(sql`SELECT to_regclass('account_closure_requests') AS table_name`);
    if (closureTable.rows[0]?.table_name) {
      const closed = await db.execute(sql`SELECT user_id FROM account_closure_requests
        WHERE status='closed' AND user_id IN (${sql.join(participantIds.map(id => sql`${id}`), sql`,`)})`);
      for (const row of closed.rows) openAccountIds.delete(Number(row.user_id));
    }
  }
  const sessionIds = [...new Set([...purchases.map((p) => p.session.id),
    ...offers.flatMap((o) => o.acceptedAt && o.replacementSessionId ? [o.replacementSessionId] : [])])];
  const complaints = sessionIds.length ? await db.select({ studentId: disputesTable.userId, sessionId: disputesTable.sessionId }).from(disputesTable)
    .where(and(inArray(disputesTable.userId, studentIds), inArray(disputesTable.sessionId, sessionIds), inArray(disputesTable.status, ACTIVE_DISPUTES), inArray(disputesTable.reason, ["Payment Issue", "Refund Request"]))) : [];
  const hasFinancialReview = (p: Purchase) => {
    const caseId = cases.find((c) => c.originalBookingId === p.bookingId && c.originalPosition === p.position)?.id;
    const replacementIds = new Set(offers.filter((o) => o.caseId === caseId && o.acceptedAt).map((o) => o.replacementSessionId));
    return complaints.some((d) => d.studentId === p.studentId && (d.sessionId === p.session.id || replacementIds.has(d.sessionId)));
  };
  for (const p of purchases) {
    const terms = policy(p, cases.filter(record => record.originalBookingId === p.bookingId));
    if (!quotas.has(p.bookingId)) {
      const count = cases.filter((c) => c.originalBookingId === p.bookingId).reduce((sum, c) => {
        const view = caseView(c, offers, actor, now);
        return sum + courtesyAllowanceUse({ reason: c.reason === "teacher_missed" && c.teacherNonDeliveryConfirmed ? "teacher_missed" : "student_missed",
          status: view.status, acceptedAtMs: offers.find((o) => o.caseId === c.id && o.acceptedAt)?.acceptedAt?.getTime() ?? null,
          teacherFailedReplacement: c.teacherFailedReplacement });
      }, 0);
      quotas.set(p.bookingId, { bookingId: p.bookingId, batchId: p.batchId, classTitle: p.snapshot.programTitle,
        limit: terms.courtesyLimit, used: count, remaining: Math.max(0, terms.courtesyLimit - count), noRollover: true });
    }
    const q = quotas.get(p.bookingId)!; const c = cases.find((c) => c.originalBookingId === p.bookingId && c.originalPosition === p.position);
    const currentCase = c ? caseView(c, offers, actor, now, context) : null;
    let canRequest = actor.role === "student"; let disallowedReason: string | undefined; let canReportTeacherMissed = canRequest;
    const requestLifecycleOpen = canOpenLessonRemedyRequest(c ? {
      status: currentCase!.status, outcome: c.outcome,
      acceptedEver: offers.some((offer) => offer.caseId === c.id && offer.acceptedAt !== null),
    } : null);
    if (!requestLifecycleOpen) { canRequest = false; canReportTeacherMissed = false; disallowedReason = "This lesson already has a make-up record. Open its details below."; }
    else {
      const facts = { policy: terms, reason: "student_missed" as const, originalLessonPurchased: true, originalIsReplacement: false,
        originalScheduledStartMs: p.session.date.getTime(), originalScheduledEndMs: p.session.date.getTime() + p.session.duration * 60_000,
        originalActualEndMs: p.actualEnd?.getTime() ?? null, nowMs: now, courtesyUsedOrReserved: q.used,
        allocationState: history.filter((entry) => entry.bookingId === p.bookingId && entry.position === p.position).at(-1)?.toState ?? "future" };
      try { assessRemedyRequest(facts); }
      catch (error) { canRequest = false; disallowedReason = error instanceof Error ? error.message : "Contact Support to review this lesson."; }
      try { assessRemedyRequest({ ...facts, reason: "teacher_missed" }); }
      catch { canReportTeacherMissed = false; }
      if (hasFinancialReview(p)) { canRequest = false; canReportTeacherMissed = false; disallowedReason = "Continue through your existing Support review for this lesson."; }
    }
    if (actor.role === "student" && (!openAccountIds.has(p.studentId) || !openAccountIds.has(p.teacherId))) {
      canRequest = false; canReportTeacherMissed = false;
      disallowedReason = "A participant account cannot arrange this make-up right now. Contact Support for review.";
    }
    const allocation = history.filter((entry) => entry.bookingId === p.bookingId && entry.position === p.position).at(-1)?.toState ?? "future";
    const financialReview = hasFinancialReview(p);
    if (currentCase && (!ALLOCATIONS_OPEN.includes(allocation) || financialReview)) {
      currentCase.actions.accept = false; currentCase.actions.offer = false;
      currentCase.actions.confirmDelivery = false;
    }
    if (p.paymentStatus === "refunded") {
      canRequest = false; canReportTeacherMissed = false;
      disallowedReason = "This original enrollment is closed. Its make-up and payment history remain available.";
      if (currentCase && actor.role !== "admin") for (const action of Object.keys(currentCase.actions) as Array<keyof typeof currentCase.actions>) currentCase.actions[action] = false;
    }
    if (!writeEnabled) {
      canRequest = false; canReportTeacherMissed = false;
      disallowedReason = "New make-up actions are paused. This existing record and your refund-review option remain available.";
      if (currentCase) for (const action of Object.keys(currentCase.actions) as Array<keyof typeof currentCase.actions>) currentCase.actions[action] = false;
    }
    lessons.push({ bookingId: p.bookingId, batchId: p.batchId, classTitle: p.snapshot.programTitle,
      originalPosition: p.position, originalSessionId: p.session.id, title: p.session.topic,
      startsAt: p.session.date.toISOString(), endsAt: new Date(p.session.date.getTime() + p.session.duration * 60_000).toISOString(),
      ...(actor.role === "student" ? {} : { studentName: p.studentName, studentId: p.studentId }),
      canRequest, disallowedReason, canReportTeacherMissed,
      case: currentCase, quota: { limit: q.limit, used: q.used, remaining: q.remaining } });
  }
  return { ...base, enabled: writeEnabled, truncated,
    ...(truncated ? { truncationReason: "Showing the first 500 records, with active make-up requests first. Open a class to narrow this view." } : {}),
    ...(writeEnabled ? {} : { unavailableReason: "New make-up actions are paused. Existing records remain available below." }), quotas: [...quotas.values()], lessons };
}
