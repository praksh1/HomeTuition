import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, testClassesTable, testStudentGrantsTable } from "@workspace/db";

/**
 * Temporary operator-granted permission to book a **test class** without paying.
 *
 * Read `lib/db/src/schema/testStudentAccess.ts` first — it explains the three separate conditions
 * a test booking needs and why none of them may be dropped.
 *
 * This module is the companion to `testTeachingAccess.ts` and is deliberately shaped like it: the
 * same kill-switch reading, the same date-based liveness decided by the database's clock, the same
 * refusal to hold any policy about *who* deserves a grant. That judgement lives in the operator
 * route, which checks verification, onboarding and suspension before it writes a row.
 */

/**
 * The environment kill switch. Default **off**, and separate from the teaching one.
 *
 * Off means no student grant works, whatever the table says. Two switches rather than one because
 * they close different doors: turning off teaching stops new test *classes* being created, and
 * turning off this one stops test *bookings* — including on classes already marked. Before public
 * launch both go off, and every outstanding grant of either kind stops mattering the same second,
 * without anybody having to find them.
 *
 * Read on every call rather than cached at import, so flipping it takes effect on the next request
 * instead of the next deploy.
 */
export function testStudentAllowed(): boolean {
  const raw = (process.env.ALLOW_TEST_STUDENT_ACCESS ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export interface TestStudentGrant {
  id: number;
  reason: string;
  grantedAt: Date;
  validUntil: Date;
}

/**
 * The live grant for a student, or null.
 *
 * Live means not revoked and not yet expired, decided by the database's clock inside the query
 * rather than by comparing timestamps in Node. Two servers with drifting clocks would otherwise
 * disagree about whether a grant that lapsed a minute ago still counts.
 *
 * Returns null whenever the kill switch is off, so no caller has to remember to ask twice.
 */
export async function liveTestStudentGrant(studentId: number): Promise<TestStudentGrant | null> {
  if (!testStudentAllowed()) return null;

  const [row] = await db
    .select({
      id: testStudentGrantsTable.id,
      reason: testStudentGrantsTable.reason,
      grantedAt: testStudentGrantsTable.grantedAt,
      validUntil: testStudentGrantsTable.validUntil,
    })
    .from(testStudentGrantsTable)
    .where(
      and(
        eq(testStudentGrantsTable.studentId, studentId),
        isNull(testStudentGrantsTable.revokedAt),
        gt(testStudentGrantsTable.validUntil, sql`now()`),
      ),
    )
    .orderBy(desc(testStudentGrantsTable.validUntil))
    .limit(1);

  return row ?? null;
}

/** Seven days. Short on purpose: a grant nobody has to renew is a grant nobody remembers to end. */
export const DEFAULT_STUDENT_GRANT_DAYS = 7;

/** The longest an operator may grant in one go, so "temporary" stays temporary. */
export const MAX_STUDENT_GRANT_DAYS = 30;

/**
 * Was this class created under a teacher's test grant?
 *
 * Read from `test_classes`, which was written once when the class was created. Never inferred
 * from what the teacher's grant looks like now — see the table's comment for why both directions
 * of that inference are wrong.
 *
 * Deliberately **not** gated on the kill switch. This is a fact about the class, and it stays true
 * whether or not test bookings are currently permitted; the switch decides what may be done with
 * the fact, which is a different question and is asked separately.
 */
export async function isTestClass(sessionId: number): Promise<boolean> {
  const [row] = await db
    .select({ sessionId: testClassesTable.sessionId })
    .from(testClassesTable)
    .where(eq(testClassesTable.sessionId, sessionId))
    .limit(1);
  return !!row;
}

/**
 * Which of these classes are test classes — one query for a whole page of them.
 *
 * The list endpoints return up to a hundred rows and asking `isTestClass` per row would be a
 * hundred round trips. Returns a Set so the caller can tag rows in a single pass.
 *
 * Like `isTestClass`, deliberately **not** gated on the kill switch. Whether a class was created
 * under a grant is a fact about the class; whether test bookings are currently permitted is a
 * separate question, asked separately. A teacher must be able to see that last month's class was
 * a test one even after the switch is off — otherwise a price sits on a card with nothing to say
 * that no money ever came from it.
 */
export async function testClassIds(sessionIds: number[]): Promise<Set<number>> {
  if (sessionIds.length === 0) return new Set();
  const rows = await db
    .select({ sessionId: testClassesTable.sessionId })
    .from(testClassesTable)
    .where(inArray(testClassesTable.sessionId, sessionIds));
  return new Set(rows.map((r) => r.sessionId));
}

/**
 * The payment status a test booking writes. Never `paid`.
 *
 * Every query that counts money — earnings, refund debt, the drop route, the schedule-change
 * compensation, the invitable-students list — asks for `payment_status = 'paid'`, so a status of
 * its own is excluded from all of them by construction rather than by remembering to add a
 * condition in each place. That is the whole reason it is a distinct value and not a flag beside
 * `paid`.
 */
export const TEST_PAYMENT_STATUS = "test";

/** The method a test booking records, in place of a gateway that was never called. */
export const TEST_PAYMENT_METHOD = "test_access";

/** What a person is told, wherever a test enrolment or a test class is shown. */
export const TEST_LABEL = "TEST — no payment was processed";

/**
 * The enrolment statuses that mean "in this class, right now".
 *
 * One list, because three different questions need it — who hears about a message in the class's
 * thread, who is on the teacher's roster, and who the attendance record expects — and three
 * copies of `["paid", "test"]` would drift the moment one of them was edited.
 *
 * **This is the roster list, never the money list.** Every query that counts earnings, refund
 * debt, a drop, or schedule-change compensation still asks for `'paid'` on its own and must go on
 * doing so. Widening one of those by reaching for this function would put a booking nobody paid
 * for into somebody's revenue.
 */
export function activeEnrolmentStatuses(): string[] {
  return testStudentAllowed() ? ["paid", TEST_PAYMENT_STATUS] : ["paid"];
}

/**
 * May a `test` enrolment be treated as a place in the class?
 *
 * The kill switch is asked here rather than at the door, so that turning it off closes the bypass
 * everywhere at once — the room URL, the WebSocket, and the student's own list of classes all run
 * through this. It cannot weaken paid access because it is only ever consulted about a row that is
 * already `test`; a `paid` row never reaches it.
 */
export function admitsTestEnrolment(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === TEST_PAYMENT_STATUS && testStudentAllowed();
}
