import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, batchTestBookingsTable, batchTestPaymentsTable, batchTestSessionsTable, batchTestLedgerEntriesTable, lessonRemedyCasesTable,
  lessonRemedyOffersTable, lessonRemedyEventsTable, learningProgramBatchesTable, learningProgramsTable, sessionsTable } from "@workspace/db";
import { lessonRemedySchemaReady } from "./lessonRemedySchema";
import { replacementAllocationAdmits, remedyHoldsAllocation, type RemedyFinancialFacts } from "./lessonRemedyFinance.ts";
import { transitionProgramAllocation, type ProgramAllocationState } from "./programCommerce";
import type { SimulatedBatchReceipt } from "./batchTestPayment";

type Reader = Pick<typeof db, "select" | "execute">;

/** Reads are durable after the creation switch is disabled. Missing tables are the legacy path. */
export async function readBookingRemedies(bookingIds: number[], reader: Reader = db) {
  if (!bookingIds.length || !await lessonRemedySchemaReady(reader)) return [];
  return reader.select({
    id: lessonRemedyCasesTable.id,
    bookingId: lessonRemedyCasesTable.originalBookingId,
    position: lessonRemedyCasesTable.originalPosition,
    originalSessionId: lessonRemedyCasesTable.originalSessionId,
    status: lessonRemedyCasesTable.status,
    outcome: lessonRemedyCasesTable.outcome,
    replacementReviewClosesAt: lessonRemedyCasesTable.replacementReviewClosesAt,
    replacementSessionId: lessonRemedyOffersTable.replacementSessionId,
    replacementStartsAt: lessonRemedyOffersTable.startsAt,
    replacementEndsAt: lessonRemedyOffersTable.endsAt,
  }).from(lessonRemedyCasesTable)
    .leftJoin(lessonRemedyOffersTable, and(eq(lessonRemedyOffersTable.caseId, lessonRemedyCasesTable.id),
      isNotNull(lessonRemedyOffersTable.acceptedAt)))
    .where(inArray(lessonRemedyCasesTable.originalBookingId, bookingIds)).orderBy(asc(lessonRemedyCasesTable.id));
}

export function participantRemedyView(remedy: Awaited<ReturnType<typeof readBookingRemedies>>[number]) {
  return { id: remedy.id, status: remedy.status, originalSessionId: remedy.originalSessionId,
    replacementSessionId: remedy.replacementSessionId, replacementStartsAt: remedy.replacementStartsAt?.toISOString() ?? null,
    replacementEndsAt: remedy.replacementEndsAt?.toISOString() ?? null,
    reviewClosesAt: remedy.replacementReviewClosesAt?.toISOString() ?? null,
    allocationHeld: remedyHoldsAllocation(remedy), additionalChargeNpr: 0 };
}

/** Replacement identity stays private and cannot be inferred from a title or a zero price. */
export async function readReplacementIdentity(sessionId: number, reader: Reader = db, studentId?: number) {
  if (!await lessonRemedySchemaReady(reader)) return null;
  const [row] = await reader.select({
    id: lessonRemedyCasesTable.id, bookingId: lessonRemedyCasesTable.originalBookingId,
    position: lessonRemedyCasesTable.originalPosition, originalSessionId: lessonRemedyCasesTable.originalSessionId,
    studentId: lessonRemedyCasesTable.studentId, teacherId: lessonRemedyCasesTable.teacherId,
    status: lessonRemedyCasesTable.status, outcome: lessonRemedyCasesTable.outcome,
    replacementReviewClosesAt: lessonRemedyCasesTable.replacementReviewClosesAt,
    replacementSessionId: lessonRemedyOffersTable.replacementSessionId, batchId: batchTestBookingsTable.batchId,
  }).from(lessonRemedyOffersTable)
    .innerJoin(lessonRemedyCasesTable, eq(lessonRemedyCasesTable.id, lessonRemedyOffersTable.caseId))
    .innerJoin(batchTestBookingsTable, eq(batchTestBookingsTable.id, lessonRemedyCasesTable.originalBookingId))
    .where(and(eq(lessonRemedyOffersTable.replacementSessionId, sessionId), isNotNull(lessonRemedyOffersTable.acceptedAt),
      studentId === undefined ? undefined : eq(lessonRemedyCasesTable.studentId, studentId))).limit(1);
  return row ?? null;
}

/** Prevent public sale even after make-up creation is paused. One SQL filter, not N card reads. */
export async function notAReplacementLesson(reader: Reader = db) {
  if (!await lessonRemedySchemaReady(reader)) return undefined;
  return sql`NOT EXISTS (SELECT 1 FROM lesson_remedy_offers mo WHERE mo.replacement_session_id=${sessionsTable.id} AND mo.accepted_at IS NOT NULL)`;
}

export async function replacementStudentAccess(sessionId: number, studentId: number, reader: Reader = db): Promise<boolean | null> {
  const identity = await readReplacementIdentity(sessionId, reader, studentId);
  if (!identity) return await readReplacementIdentity(sessionId, reader) ? false : null;
  const result = await reader.execute(sql`SELECT COALESCE((SELECT to_state FROM batch_test_ledger_entries
    WHERE booking_id=${identity.bookingId} AND position=${identity.position} ORDER BY id DESC LIMIT 1),'future') AS state`);
  return replacementAllocationAdmits(String(result.rows[0]?.state ?? "unknown"));
}

/** Original and replacement use one frozen allocation; used by support/refund adapters. */
export async function originalAllocationForSession(sessionId: number, studentId: number, reader: Reader = db) {
  const replacement = await readReplacementIdentity(sessionId, reader, studentId);
  if (!replacement && await readReplacementIdentity(sessionId, reader)) return null;
  const [original] = replacement ? [] : await reader.select({
    bookingId: batchTestBookingsTable.id, batchId: batchTestBookingsTable.batchId,
    position: batchTestSessionsTable.position,
  }).from(batchTestSessionsTable).innerJoin(batchTestBookingsTable, and(
    eq(batchTestBookingsTable.batchId, batchTestSessionsTable.batchId), eq(batchTestBookingsTable.studentId, studentId),
  )).where(eq(batchTestSessionsTable.sessionId, sessionId)).limit(1);
  const identity = replacement ?? original;
  if (!identity) return null;
  const [payment] = await reader.select({ receipt: batchTestPaymentsTable.receipt }).from(batchTestPaymentsTable)
    .where(eq(batchTestPaymentsTable.bookingId, identity.bookingId)).limit(1);
  if (!payment) throw Error("The original lesson allocation is unavailable. Support must review the payment record.");
  return { bookingId: identity.bookingId, batchId: identity.batchId, position: identity.position,
    originalSessionId: replacement?.originalSessionId ?? sessionId, replacementSessionId: replacement?.replacementSessionId ?? null,
    receipt: payment.receipt };
}

/** Group context for private schedules. Replacements are not inserted into the purchased dates. */
export async function tagReplacementClassGroups<T extends { id: number }>(rows: T[], reader: Reader = db): Promise<T[]> {
  if (!rows.length || !await lessonRemedySchemaReady(reader)) return rows;
  const links = await reader.select({ sessionId: lessonRemedyOffersTable.replacementSessionId,
    originalSessionId: lessonRemedyCasesTable.originalSessionId, position: lessonRemedyCasesTable.originalPosition,
    batchId: batchTestBookingsTable.batchId, title: learningProgramsTable.title,
    lessonCount: sql<number>`(SELECT count(*)::integer FROM batch_test_sessions purchased_dates WHERE purchased_dates.batch_id=${batchTestBookingsTable.batchId})` })
    .from(lessonRemedyOffersTable).innerJoin(lessonRemedyCasesTable, eq(lessonRemedyCasesTable.id, lessonRemedyOffersTable.caseId))
    .innerJoin(batchTestBookingsTable, eq(batchTestBookingsTable.id, lessonRemedyCasesTable.originalBookingId))
    .innerJoin(learningProgramBatchesTable, eq(learningProgramBatchesTable.id, batchTestBookingsTable.batchId))
    .innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramBatchesTable.programId))
    .where(and(inArray(lessonRemedyOffersTable.replacementSessionId, rows.map(row => row.id)), isNotNull(lessonRemedyOffersTable.acceptedAt)));
  const byId = new Map(links.map(row => [row.sessionId, row]));
  return rows.map(row => {
    const link = byId.get(row.id);
    return link ? { ...row, classGroup: { batchId: link.batchId, title: link.title, lessonPosition: link.position,
      lessonCount: link.lessonCount, makeup: true, originalSessionId: link.originalSessionId } } : row;
  });
}

export type StoredRemedyFinancialFacts = RemedyFinancialFacts;

/** A financial support request races acceptance/payout on the very same original payment lock. */
export async function freezeOriginalPaymentForReview(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: {
  sessionId: number | null; studentId: number; actorRole: string; reason: string; disputeId: number;
}): Promise<void> {
  if (input.sessionId === null || input.actorRole !== "student" || !["Payment Issue", "Refund Request"].includes(input.reason)) return;
  const identity = await originalAllocationForSession(input.sessionId, input.studentId, tx);
  if (!identity) return;
  const [payment] = await tx.select().from(batchTestPaymentsTable).where(eq(batchTestPaymentsTable.bookingId, identity.bookingId)).for("update").limit(1);
  if (!payment) throw Error("The original payment record is unavailable. No financial request was saved.");
  const history = await tx.select().from(batchTestLedgerEntriesTable)
    .where(and(eq(batchTestLedgerEntriesTable.bookingId, identity.bookingId), eq(batchTestLedgerEntriesTable.position, identity.position)))
    .orderBy(asc(batchTestLedgerEntriesTable.id));
  const state = (history.at(-1)?.toState ?? "future") as ProgramAllocationState;
  const allocation = (payment.receipt as SimulatedBatchReceipt).allocations.find(row => row.position === identity.position);
  if (!allocation) throw Error("The original lesson allocation is unavailable. No financial request was saved.");
  if (state === "delivered_pending" || state === "eligible") {
    await tx.insert(batchTestLedgerEntriesTable).values({ bookingId: identity.bookingId, position: identity.position,
      actorId: input.studentId, event: "complaint_opened", fromState: state, toState: transitionProgramAllocation(state, "complaint_opened"),
      grossNpr: allocation.grossNpr, teacherNpr: allocation.teacherNpr, fadkoNpr: allocation.fadkoNpr,
      detail: { disputeId: input.disputeId, paymentMoved: false, originalSessionId: identity.originalSessionId } });
  }
  if (!await lessonRemedySchemaReady(tx)) return;
  const [remedy] = await tx.select().from(lessonRemedyCasesTable).where(and(
    eq(lessonRemedyCasesTable.originalBookingId, identity.bookingId), eq(lessonRemedyCasesTable.originalPosition, identity.position),
  )).for("update").limit(1);
  if (!remedy || ["resolved", "withdrawn", "review_required"].includes(remedy.status)) return;
  await tx.update(lessonRemedyCasesTable).set({ status: "review_required", outcome: "refund_review" }).where(eq(lessonRemedyCasesTable.id, remedy.id));
  await tx.update(lessonRemedyOffersTable).set({ status: "withdrawn", withdrawnAt: new Date() }).where(and(
    eq(lessonRemedyOffersTable.caseId, remedy.id), eq(lessonRemedyOffersTable.status, "proposed")));
  await tx.insert(lessonRemedyEventsTable).values({ caseId: remedy.id, actorId: input.studentId, actorRole: "student",
    event: "refund_review", fromStatus: remedy.status, toStatus: "review_required", detail: { disputeId: input.disputeId, paymentMoved: false } });
}
