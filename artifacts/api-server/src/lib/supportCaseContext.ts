import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { db, sessionEnrollmentsTable, sessionsTable, refundsTable, batchTestSessionsTable, batchTestBookingsTable, batchTestPaymentsTable } from "@workspace/db";
import { accessRefusalFor, getSessionMembership } from "./membership";
import { explainSupportPayment } from "./supportPaymentEvidence";

/** Only own teaching/enrolment records. No rosters, other people's payments, secrets or DMs. */
export async function listSupportLessons(userId: number) {
  return db.select({ id: sessionsTable.id, topic: sessionsTable.topic, date: sessionsTable.date })
    .from(sessionsTable).leftJoin(sessionEnrollmentsTable, and(
      eq(sessionEnrollmentsTable.sessionId, sessionsTable.id), eq(sessionEnrollmentsTable.studentId, userId),
    )).where(or(eq(sessionsTable.teacherId, userId), isNotNull(sessionEnrollmentsTable.id)))
    .orderBy(desc(sessionsTable.date)).limit(50);
}

export async function readSupportLesson(userId: number, sessionId: number) {
  const [row] = await db.select({ id: sessionsTable.id, topic: sessionsTable.topic,
    date: sessionsTable.date, status: sessionsTable.status, teacherId: sessionsTable.teacherId,
    enrollmentId: sessionEnrollmentsTable.id, paymentStatus: sessionEnrollmentsTable.paymentStatus,
    paymentMethod: sessionEnrollmentsTable.paymentMethod, paymentReference: sessionEnrollmentsTable.paymentReference,
  }).from(sessionsTable).leftJoin(sessionEnrollmentsTable, and(
    eq(sessionEnrollmentsTable.sessionId, sessionsTable.id), eq(sessionEnrollmentsTable.studentId, userId),
  )).where(and(eq(sessionsTable.id, sessionId),
    or(eq(sessionsTable.teacherId, userId), isNotNull(sessionEnrollmentsTable.id))));
  if (!row) return null;
  const teacher = row.teacherId === userId;
  const membership = await getSessionMembership(sessionId, userId);
  const refusal = accessRefusalFor(membership);
  const facts = [
    `Session #${row.id}: ${row.topic}. Scheduled ${row.date.toISOString()} (UTC; sessions record).`,
    `Listed session state: ${row.status}. This alone does not prove lesson delivery or call quality.`,
    ...(teacher ? ["This is your teaching session. Student financial records were not accessed."] : [
      `Your enrollment record: ${row.paymentStatus ?? "unknown"}. This is Fadko's record, not an independent payment-provider reconciliation.`,
      row.paymentStatus === "test" ? "Test enrollment: no real payment is established by this record." :
        "Refund eligibility and any transfer to the original method require review; this assistant makes no payment decision.",
      `Classroom access check at ${new Date().toISOString()}: ${refusal ?? "permitted by membership and time rules"}. This does not test your device or the media provider.`,
    ]),
  ];
  if (!teacher && row.enrollmentId) {
    const [batch] = await db.select({ bookingId: batchTestBookingsTable.id, position: batchTestSessionsTable.position, receipt: batchTestPaymentsTable.receipt })
      .from(batchTestSessionsTable).innerJoin(batchTestBookingsTable, and(
        eq(batchTestBookingsTable.batchId, batchTestSessionsTable.batchId), eq(batchTestBookingsTable.studentId, userId),
      )).innerJoin(batchTestPaymentsTable, eq(batchTestPaymentsTable.bookingId, batchTestBookingsTable.id))
      .where(eq(batchTestSessionsTable.sessionId, sessionId)).limit(1);
    const refunds = await db.select({ id: refundsTable.id, amount: refundsTable.amount, status: refundsTable.status,
      requestedAt: refundsTable.requestedAt, paidAt: refundsTable.paidAt })
      .from(refundsTable).where(and(eq(refundsTable.studentId, userId), eq(refundsTable.sessionId, sessionId)))
      .orderBy(desc(refundsTable.id)).limit(6);
    facts.push(...explainSupportPayment({ enrollmentId: row.enrollmentId, status: row.paymentStatus ?? "unknown",
      method: row.paymentMethod, reference: row.paymentReference, batch, refunds }));
  }
  return { sessionId: row.id, title: row.topic, facts };
}
