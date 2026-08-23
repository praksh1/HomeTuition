import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  refundsTable,
  scheduleChangesTable,
  sessionEnrollmentsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { inScheduleChangeWindow, refundSplit, type RefundReason } from "./sessionChanges";

/**
 * Reading and writing the record behind rescheduling and refunds.
 *
 * The rules themselves are pure and live in sessionChanges.ts. This is the part that needs a
 * database: how many changes a teacher has spent, when a class was last moved, and what a
 * given student would get back if they dropped right now.
 */

/** The first instant of the current calendar month, which is what the allowance resets on. */
function startOfMonth(now: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * How many schedule changes this teacher has spent this month.
 *
 * Returns null when it cannot be read — which must not be treated as zero. Counting a failed
 * lookup as "none used" would hand an unlimited allowance to whoever asks during an outage;
 * the caller refuses instead, because being unable to move a class for a minute is a far
 * smaller problem than a limit that stops applying.
 */
export async function scheduleEditsUsed(teacherId: number, now: number = Date.now()): Promise<number | null> {
  try {
    return await countScheduleEdits(db, teacherId, now);
  } catch (err) {
    logger.warn({ err, teacherId }, "could not count this month's schedule changes");
    return null;
  }
}

/** Anything that can run a query: the pool, or a transaction inside the lock below. */
type Executor = Pick<typeof db, "select">;

/** The count itself, so the same query can be run inside a transaction. Throws on failure. */
export async function countScheduleEdits(
  tx: Executor,
  teacherId: number,
  now: number = Date.now(),
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(scheduleChangesTable)
    .where(
      and(
        eq(scheduleChangesTable.teacherId, teacherId),
        gte(scheduleChangesTable.changedAt, startOfMonth(now)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * An arbitrary but fixed number naming this lock, so it cannot collide with another one taken
 * elsewhere in the database. Postgres advisory locks are only a pair of integers; the meaning
 * is entirely in agreeing on the pair.
 */
const SCHEDULE_QUOTA_LOCK = 838_201;

/**
 * Hold the teacher's schedule allowance still for the length of a transaction.
 *
 * Counting and then inserting is two steps, and eight requests arriving together all counted
 * before any of them had inserted — so a limit of five let seven through, which a test caught.
 * The lock is per teacher, so two teachers never wait on each other, and Postgres releases it
 * when the transaction ends however it ends.
 */
export async function lockScheduleQuota(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  teacherId: number,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SCHEDULE_QUOTA_LOCK}, ${teacherId})`);
}

/** When this class was last moved, or null if it never has been. */
export async function lastMovedAt(sessionId: number): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ changedAt: scheduleChangesTable.changedAt })
      .from(scheduleChangesTable)
      .where(eq(scheduleChangesTable.sessionId, sessionId))
      .orderBy(desc(scheduleChangesTable.id))
      .limit(1);
    return row?.changedAt ?? null;
  } catch {
    // A class we cannot prove was moved is treated as one that was not. The consequence is a
    // student offered half rather than all of their money back, so the route says `known` and
    // the app can decline to offer the choice at all rather than offer a wrong one.
    return null;
  }
}

export interface DropQuote {
  /** What this student would get back if they dropped right now. */
  studentRefund: number;
  teacherShare: number;
  platformShare: number;
  reason: RefundReason;
  /** True when the whole price comes back because the teacher moved the class. */
  full: boolean;
  /** False when the record could not be read; the app must not quote a number from a guess. */
  known: boolean;
}

/**
 * What a student is owed if they drop this class now.
 *
 * The whole price while the teacher's change is still fresh, half otherwise. Worked out on the
 * server rather than in the app because it is the number a person is shown before they agree
 * to lose money, and the two must not be able to disagree.
 */
export async function quoteDrop(
  sessionId: number,
  pricePaid: number,
  now: number = Date.now(),
): Promise<DropQuote> {
  let moved: Date | null = null;
  let known = true;
  try {
    moved = await lastMovedAt(sessionId);
  } catch {
    known = false;
  }

  const reason: RefundReason = inScheduleChangeWindow(moved, now) ? "schedule_change" : "student_drop";
  const split = refundSplit(pricePaid, reason);
  return { ...split, full: reason === "schedule_change", known };
}

/** Everyone who has paid for this class — the people a change disrupts. */
export async function paidEnrolments(sessionId: number) {
  return db
    .select({
      id: sessionEnrollmentsTable.id,
      studentId: sessionEnrollmentsTable.studentId,
    })
    .from(sessionEnrollmentsTable)
    .where(
      and(
        eq(sessionEnrollmentsTable.sessionId, sessionId),
        eq(sessionEnrollmentsTable.paymentStatus, "paid"),
      ),
    );
}

/** Whether this student already has a refund recorded for this class, so none is written twice. */
export async function alreadyRefunded(sessionId: number, studentId: number): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: refundsTable.id })
      .from(refundsTable)
      .where(and(eq(refundsTable.sessionId, sessionId), eq(refundsTable.studentId, studentId)))
      .limit(1);
    return !!row;
  } catch {
    // Better to refuse a second refund we cannot rule out than to write one twice.
    return true;
  }
}
