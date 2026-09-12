import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { db, learningProgramsTable, learningProgramBatchesTable, teacherProfilesTable, usersTable,
  userOnboardingTable, testTeachingGrantsTable, testStudentGrantsTable, batchTestContractsTable,
  batchTestBookingsTable, batchTestPaymentsTable, batchTestLedgerEntriesTable, batchTestSessionsTable,
  sessionsTable, sessionEnrollmentsTable, sessionParticipationTable, disputesTable, testClassesTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { emailVerifiedFor } from "../lib/accountSecurity";
import { testPilotDeadline } from "../lib/testPilot";
import { testTeachingAllowed } from "../lib/testTeachingAccess";
import { testStudentAllowed } from "../lib/testStudentAccess";
import { readBatchSnapshot } from "../lib/programBatches";
import { classJoiningPreview } from "../lib/classJoining";
import { assertTeacherSchedule, lockTeacherSchedule } from "../lib/teacherSchedule";
import { recordActivity } from "../lib/activityLog";
import { notifyInApp } from "../lib/notify";
import { simulatedBatchReceipt, type SimulatedBatchReceipt } from "../lib/batchTestPayment";
import { PROGRAM_ALLOCATION_EVENTS, ProgramCommerceInputError, transitionProgramAllocation,
  type ProgramAllocationEvent, type ProgramAllocationState } from "../lib/programCommerce";
import { automaticBatchTestEvents, batchTestNeedsHumanAttention } from "../lib/batchTestSettlement";

const router = Router();
const EVENTS_REQUIRING_NOTE = new Set<ProgramAllocationEvent>([
  "refund_approved", "complaint_upheld", "complaint_denied",
]);

type BatchLedgerRow = typeof batchTestLedgerEntriesTable.$inferSelect;
function receiptView(receipt: SimulatedBatchReceipt, entries: BatchLedgerRow[]) {
  const allocations = receipt.allocations.map((allocation) => {
    const latest = entries.filter((entry) => entry.position === allocation.position).at(-1);
    return { ...allocation, state: latest?.toState ?? "future" };
  });
  const terminal = (state: string) => allocations.filter((allocation) => allocation.state === state);
  const sum = (rows: typeof allocations, key: "grossNpr" | "teacherNpr" | "fadkoNpr") =>
    rows.reduce((total, row) => total + row[key], 0);
  const paidOut = terminal("paid_out");
  const refunded = terminal("refunded");
  const held = allocations.filter((allocation) => !["paid_out", "refunded"].includes(allocation.state));
  return {
    ...receipt,
    allocations,
    needsAttention: allocations.some((allocation) => batchTestNeedsHumanAttention(allocation.state)),
    history: entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    accounting: {
      heldGrossNpr: sum(held, "grossNpr"),
      teacherPaidOutNpr: sum(paidOut, "teacherNpr"),
      fadkoEarnedNpr: sum(paidOut, "fadkoNpr"),
      refundedGrossNpr: sum(refunded, "grossNpr"),
      actualMoneyMovedNpr: 0,
    },
  };
}

/** Remove platform/internal allocations before a participant response leaves the server. */
function participantReceiptView(
  role: "student" | "teacher",
  receipt: SimulatedBatchReceipt,
  entries: BatchLedgerRow[],
) {
  const full = receiptView(receipt, entries);
  const common = {
    reference: full.reference,
    allocations: full.allocations.map((allocation) => {
      const latest = entries.filter((entry) => entry.position === allocation.position).at(-1);
      const stateChangedAt = latest?.createdAt.toISOString();
      return role === "teacher"
        ? { position: allocation.position, state: allocation.state, teacherNpr: allocation.teacherNpr, stateChangedAt }
        : { position: allocation.position, state: allocation.state, grossNpr: allocation.grossNpr, stateChangedAt };
    }),
    accounting: role === "teacher"
      ? { teacherPaidOutNpr: full.accounting.teacherPaidOutNpr, actualMoneyMovedNpr: 0 }
      : { refundedGrossNpr: full.accounting.refundedGrossNpr, actualMoneyMovedNpr: 0 },
  };
  return role === "teacher"
    ? { ...common }
    : { ...common, grossNpr: full.grossNpr };
}

const ACTIVE_COMPLAINT_STATUSES = ["open", "opened", "assigned", "processing", "in_review"] as const;

/**
 * Bring the rehearsal ledger up to date from session evidence and student-created cases.
 *
 * This never decides a complaint and never confirms a payout/refund. Its only inputs are the
 * session row, recorded teacher participation, the server clock and an actual support case.
 */
async function synchronizeBatchTestSettlements(batchId?: number): Promise<void> {
  const bookings = await db.select({ bookingId: batchTestPaymentsTable.bookingId, batchId: batchTestBookingsTable.batchId, studentId: batchTestBookingsTable.studentId })
    .from(batchTestPaymentsTable)
    .innerJoin(batchTestBookingsTable, eq(batchTestBookingsTable.id, batchTestPaymentsTable.bookingId))
    .where(batchId === undefined ? undefined : eq(batchTestBookingsTable.batchId, batchId))
    .orderBy(asc(batchTestPaymentsTable.bookingId))
    .limit(50);

  for (const target of bookings) {
    await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(batchTestPaymentsTable)
        .where(eq(batchTestPaymentsTable.bookingId, target.bookingId)).for("update").limit(1);
      if (!payment) return;
      const receipt = payment.receipt as SimulatedBatchReceipt;
      const lessons = await tx.select({
        position: batchTestSessionsTable.position,
        sessionId: sessionsTable.id,
        status: sessionsTable.status,
        startsAt: sessionsTable.date,
        durationMinutes: sessionsTable.duration,
      }).from(batchTestSessionsTable)
        .innerJoin(sessionsTable, eq(sessionsTable.id, batchTestSessionsTable.sessionId))
        .where(eq(batchTestSessionsTable.batchId, target.batchId));
      if (!lessons.length) return;
      const sessionIds = lessons.map((lesson) => lesson.sessionId);
      const [history, teacherPresence, complaints] = await Promise.all([
        tx.select().from(batchTestLedgerEntriesTable)
          .where(eq(batchTestLedgerEntriesTable.bookingId, target.bookingId))
          .orderBy(asc(batchTestLedgerEntriesTable.id)),
        tx.select({ sessionId: sessionParticipationTable.sessionId })
          .from(sessionParticipationTable)
          .where(and(inArray(sessionParticipationTable.sessionId, sessionIds), eq(sessionParticipationTable.role, "teacher"), gt(sessionParticipationTable.presentMs, 0))),
        tx.select({ sessionId: disputesTable.sessionId }).from(disputesTable)
          .where(and(eq(disputesTable.userId, target.studentId), inArray(disputesTable.sessionId, sessionIds), inArray(disputesTable.status, [...ACTIVE_COMPLAINT_STATUSES]))),
      ]);
      const present = new Set(teacherPresence.map((row) => row.sessionId));
      const complained = new Set(complaints.map((row) => row.sessionId));

      for (const allocation of receipt.allocations) {
        const lesson = lessons.find((row) => row.position === allocation.position);
        if (!lesson) continue;
        let state = (history.filter((entry) => entry.position === allocation.position).at(-1)?.toState ?? "future") as ProgramAllocationState;
        const events = automaticBatchTestEvents({
          state,
          sessionStatus: lesson.status,
          scheduledStartMs: lesson.startsAt.getTime(),
          durationMinutes: lesson.durationMinutes,
          teacherPresenceRecorded: present.has(lesson.sessionId),
          activeComplaint: complained.has(lesson.sessionId),
          nowMs: Date.now(),
        });
        for (const event of events) {
          const toState = transitionProgramAllocation(state, event);
          await tx.insert(batchTestLedgerEntriesTable).values({
            bookingId: target.bookingId,
            position: allocation.position,
            actorId: null,
            event,
            fromState: state,
            toState,
            grossNpr: allocation.grossNpr,
            teacherNpr: allocation.teacherNpr,
            fadkoNpr: allocation.fadkoNpr,
            detail: { automated: true, paymentMoved: false, basis: event === "complaint_opened" ? "student_support_case" : "classroom_record_and_server_time" },
          });
          state = toState;
        }
      }
    });
  }
}

// Reading history remains possible after the pilot closes; this never grants classroom access.
router.get("/admin/batch-test-payments", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await synchronizeBatchTestSettlements().catch((error) => req.log.warn({ error }, "could not refresh simulated settlement evidence"));
    const rows = await db.select({ bookingId: batchTestPaymentsTable.bookingId, receipt: batchTestPaymentsTable.receipt,
      recordedAt: batchTestPaymentsTable.createdAt, batchId: batchTestBookingsTable.batchId,
      studentName: usersTable.name, snapshot: batchTestContractsTable.snapshot })
      .from(batchTestPaymentsTable).innerJoin(batchTestBookingsTable, eq(batchTestBookingsTable.id, batchTestPaymentsTable.bookingId))
      .innerJoin(batchTestContractsTable, eq(batchTestContractsTable.batchId, batchTestBookingsTable.batchId))
      .innerJoin(usersTable, eq(usersTable.id, batchTestBookingsTable.studentId))
      .orderBy(desc(batchTestPaymentsTable.bookingId)).limit(50);
    const bookingIds = rows.map((row) => row.bookingId);
    const history = bookingIds.length ? await db.select().from(batchTestLedgerEntriesTable)
      .where(inArray(batchTestLedgerEntriesTable.bookingId, bookingIds))
      .orderBy(asc(batchTestLedgerEntriesTable.id)) : [];
    res.setHeader("Cache-Control", "no-store").json({ testOnly: true, receipts: rows.map(r => ({
      ...receiptView(r.receipt as SimulatedBatchReceipt, history.filter((entry) => entry.bookingId === r.bookingId)),
      bookingId: r.bookingId, recordedAt: r.recordedAt.toISOString(), batchId: r.batchId,
      studentName: r.studentName, classTitle: readBatchSnapshot(r.snapshot)?.programTitle ?? "Class title unavailable",
    })) });
  } catch (error) { next(error); }
});

/**
 * The signed-in participant's own simulated money view.
 *
 * This is intentionally read-only and role-scoped in SQL. A student sees only their bookings;
 * a teacher sees only bookings for classes they teach. It does not expose the operator event
 * route and cannot move money.
 */
router.get("/batch-tests/me/payments", requireAuth, async (req, res, next) => {
  const role = req.user!.role;
  if (role !== "student" && role !== "teacher") {
    res.status(403).json({ error: "This payment view belongs to students and teachers." });
    return;
  }
  try {
    const rows = await db.select({
      bookingId: batchTestPaymentsTable.bookingId,
      receipt: batchTestPaymentsTable.receipt,
      recordedAt: batchTestPaymentsTable.createdAt,
      batchId: batchTestBookingsTable.batchId,
      studentName: usersTable.name,
      snapshot: batchTestContractsTable.snapshot,
    })
      .from(batchTestPaymentsTable)
      .innerJoin(batchTestBookingsTable, eq(batchTestBookingsTable.id, batchTestPaymentsTable.bookingId))
      .innerJoin(batchTestContractsTable, eq(batchTestContractsTable.batchId, batchTestBookingsTable.batchId))
      .innerJoin(learningProgramBatchesTable, eq(learningProgramBatchesTable.id, batchTestBookingsTable.batchId))
      .innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramBatchesTable.programId))
      .innerJoin(usersTable, eq(usersTable.id, batchTestBookingsTable.studentId))
      .where(role === "student"
        ? eq(batchTestBookingsTable.studentId, req.user!.userId)
        : eq(learningProgramsTable.teacherId, req.user!.userId))
      .orderBy(desc(batchTestPaymentsTable.bookingId))
      .limit(50);
    // Refresh only this participant's classes. Refreshing the global rehearsal ledger every time
    // any student opened Sessions would turn a read-only convenience into avoidable database work.
    for (const batchId of new Set(rows.map((row) => row.batchId))) {
      await synchronizeBatchTestSettlements(batchId).catch((error) =>
        req.log.warn({ error, batchId }, "could not refresh participant simulated settlement evidence"),
      );
    }
    const bookingIds = rows.map((row) => row.bookingId);
    const history = bookingIds.length
      ? await db.select().from(batchTestLedgerEntriesTable)
        .where(inArray(batchTestLedgerEntriesTable.bookingId, bookingIds))
        .orderBy(asc(batchTestLedgerEntriesTable.id))
      : [];
    res.setHeader("Cache-Control", "no-store").json({
      testOnly: true,
      role,
      receipts: rows.map((row) => ({
        ...participantReceiptView(
          role,
          row.receipt as SimulatedBatchReceipt,
          history.filter((entry) => entry.bookingId === row.bookingId),
        ),
        bookingId: row.bookingId,
        batchId: row.batchId,
        recordedAt: row.recordedAt.toISOString(),
        ...(role === "teacher" ? { studentName: row.studentName } : {}),
        classTitle: readBatchSnapshot(row.snapshot)?.programTitle ?? "Class title unavailable",
      })),
    });
  } catch (error) { next(error); }
});

/** Rehearse one held lesson through complaint, refund and payout without moving money. */
router.post("/admin/batch-test-payments/:bookingId/allocations/:position/events", requireAuth, requireAdmin, async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  const position = Number(req.params.position);
  const event = typeof req.body?.event === "string" ? req.body.event : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0 || !Number.isSafeInteger(position) || position < 0 ||
      !PROGRAM_ALLOCATION_EVENTS.includes(event as ProgramAllocationEvent)) {
    res.status(400).json({ error: "Choose a valid test receipt, lesson and rehearsal action." }); return;
  }
  if (EVENTS_REQUIRING_NOTE.has(event as ProgramAllocationEvent) && !note) {
    res.status(400).json({ error: "Write the reason for that complaint or refund decision." }); return;
  }
  try {
    const entry = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(batchTestPaymentsTable)
        .where(eq(batchTestPaymentsTable.bookingId, bookingId)).for("update").limit(1);
      if (!payment) return null;
      const receipt = payment.receipt as SimulatedBatchReceipt;
      const allocation = receipt.allocations.find((row) => row.position === position);
      if (!allocation) return null;
      const [latest] = await tx.select().from(batchTestLedgerEntriesTable)
        .where(and(eq(batchTestLedgerEntriesTable.bookingId, bookingId), eq(batchTestLedgerEntriesTable.position, position)))
        .orderBy(desc(batchTestLedgerEntriesTable.id)).limit(1);
      const fromState = (latest?.toState ?? "future") as ProgramAllocationState;
      const toState = transitionProgramAllocation(fromState, event as ProgramAllocationEvent);
      const [created] = await tx.insert(batchTestLedgerEntriesTable).values({
        bookingId, position, actorId: req.user!.userId, event, fromState, toState,
        grossNpr: allocation.grossNpr, teacherNpr: allocation.teacherNpr, fadkoNpr: allocation.fadkoNpr,
        detail: { note: note || null, paymentMoved: false },
      }).returning();
      return created;
    });
    if (!entry) { res.status(404).json({ error: "That simulated lesson allocation was not found." }); return; }
    res.json({ entry: { ...entry, createdAt: entry.createdAt.toISOString() }, notice: "TEST ONLY — no money moved." });
  } catch (error) {
    if (error instanceof ProgramCommerceInputError) { res.status(409).json({ error: error.message }); return; }
    res.status(503).json({ error: "The simulated ledger could not be updated. No money moved." });
  }
});
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Refusal extends Error { constructor(readonly status: number, message: string) { super(message); } }
function pilot() {
  const until = testPilotDeadline();
  if (!until || !testTeachingAllowed() || !testStudentAllowed()) throw new Refusal(403, "Test booking is not open. No payment will be taken.");
  return until;
}
async function readOffer(batchId: number) {
  const [row] = await db.select({ batch: learningProgramBatchesTable, program: learningProgramsTable })
    .from(learningProgramBatchesTable).innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramBatchesTable.programId))
    .where(eq(learningProgramBatchesTable.id, batchId));
  if (!row) throw new Refusal(404, "That class was not found.");
  return row;
}
async function eligibility(tx: Tx, teacherId: number, viewerId: number) {
  const [teacher] = await tx.select().from(usersTable).where(eq(usersTable.id, teacherId)).for("share");
  const [profile] = await tx.select().from(teacherProfilesTable).where(eq(teacherProfilesTable.userId, teacherId)).for("share");
  if (!teacher || teacher.role !== "teacher" || teacher.suspendedAt || profile?.approvalStatus !== "approved" || !await emailVerifiedFor(teacherId)) {
    throw new Refusal(403, "This teacher is not approved for testing.");
  }
  const [teacherGrant] = await tx.select().from(testTeachingGrantsTable).where(and(eq(testTeachingGrantsTable.teacherId, teacherId), isNull(testTeachingGrantsTable.revokedAt), gt(testTeachingGrantsTable.validUntil, sql`now()`))).for("share");
  if (!teacherGrant) throw new Refusal(403, "An operator must enable this teacher's test access first.");
  if (viewerId === teacherId) return { teacher, teacherGrant, studentGrant: null, viewerName: teacher.name };
  // Serializes two different batch bookings by the same student before checking their timetable.
  const [viewer] = await tx.select().from(usersTable).where(eq(usersTable.id, viewerId)).for("update");
  const [onboarding] = await tx.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, viewerId));
  if (!viewer || viewer.role !== "student" || viewer.suspendedAt || !onboarding?.completedAt || !await emailVerifiedFor(viewerId)) {
    throw new Refusal(403, "Complete and verify an active student account before testing booking.");
  }
  const [studentGrant] = await tx.select().from(testStudentGrantsTable).where(and(eq(testStudentGrantsTable.studentId, viewerId), isNull(testStudentGrantsTable.revokedAt), gt(testStudentGrantsTable.validUntil, sql`now()`))).for("share");
  if (!studentGrant) throw new Refusal(403, "An operator must enable your student test access first.");
  return { teacher, teacherGrant, studentGrant, viewerName: viewer.name };
}
async function lessonLinks(tx: Tx, batchId: number, viewerId: number, isTeacher: boolean) {
  const rows = await tx.select({ position: batchTestSessionsTable.position, session: sessionsTable }).from(batchTestSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, batchTestSessionsTable.sessionId)).where(eq(batchTestSessionsTable.batchId, batchId)).orderBy(asc(batchTestSessionsTable.position));
  const enrolled = isTeacher || !rows.length ? [] : await tx.select({ sessionId: sessionEnrollmentsTable.sessionId }).from(sessionEnrollmentsTable)
    .where(and(eq(sessionEnrollmentsTable.studentId, viewerId), eq(sessionEnrollmentsTable.paymentStatus, "test"), inArray(sessionEnrollmentsTable.sessionId, rows.map((r) => r.session.id))));
  return rows.filter((r) => isTeacher || enrolled.some((e) => e.sessionId === r.session.id)).map((r) => ({ position: r.position, sessionId: r.session.id, startsAt: r.session.date.toISOString(), durationMinutes: r.session.duration }));
}

async function run(batchId: number, viewerId: number, confirm?: string, outcome?: "success" | "declined") {
  const until = pilot();
  const initial = await readOffer(batchId);
  return db.transaction(async (tx) => {
    await lockTeacherSchedule(tx, initial.program.teacherId);
    const [program] = await tx.select().from(learningProgramsTable).where(eq(learningProgramsTable.id, initial.program.id)).for("update");
    const [batch] = await tx.select().from(learningProgramBatchesTable).where(eq(learningProgramBatchesTable.id, batchId)).for("update");
    if (!program || !batch || program.status !== "published" || batch.status !== "published") throw new Refusal(409, "This class is not open for booking.");
    const snapshot = readBatchSnapshot(batch.publishedSnapshot);
    if (!snapshot || snapshot.version !== batch.version || snapshot.programVersion !== program.version) throw new Refusal(409, "This listing changed. Ask the teacher to review it.");
    const access = await eligibility(tx, program.teacherId, viewerId);
    const isTeacher = program.teacherId === viewerId;
    const [already] = await tx.select().from(batchTestBookingsTable).where(and(eq(batchTestBookingsTable.batchId, batchId), eq(batchTestBookingsTable.studentId, viewerId)));
    const currentQuote = classJoiningPreview(snapshot, Date.now());
    const quote = already ? already.quote as ReturnType<typeof classJoiningPreview> : currentQuote;
    const quoteKey = createHash("sha256").update(JSON.stringify({ snapshot, amount: quote.amountNpr, positions: quote.lessonPositions })).digest("hex");
    if (confirm !== undefined && isTeacher) throw new Refusal(403, "Teachers cannot book their own class.");
    if (confirm !== undefined && !already) {
      if (quote.status === "closed" || quote.amountNpr === null || Date.now() >= Date.parse(snapshot.enrollmentClosesAt)) throw new Refusal(409, "Joining has closed for these dates.");
      if (confirm !== quoteKey) throw new Refusal(409, "The dates or price changed. Review the current details before confirming.");
      if (outcome === "declined") throw new Refusal(402, "Test payment declined. No money moved and no place was booked. You can try again.");
      const seats = await tx.select({ id: batchTestBookingsTable.id }).from(batchTestBookingsTable).where(eq(batchTestBookingsTable.batchId, batchId));
      if (seats.length >= snapshot.capacity) throw new Refusal(409, "This test class is full.");
      const selected = snapshot.lessons.filter((l) => quote.lessonPositions.includes(l.position));
      if (selected.some((l) => Date.parse(l.startsAt) + l.durationMinutes * 60000 > until)) {
        throw new Refusal(409, "These lessons extend beyond the test period. Ask the teacher to prepare dates within the test window.");
      }
      const otherLessons = await tx.select({ session: sessionsTable }).from(sessionEnrollmentsTable).innerJoin(sessionsTable, eq(sessionsTable.id, sessionEnrollmentsTable.sessionId))
        .where(and(eq(sessionEnrollmentsTable.studentId, viewerId), inArray(sessionEnrollmentsTable.paymentStatus, ["paid", "test"]), inArray(sessionsTable.status, ["upcoming", "live"])));
      if (selected.some((l) => otherLessons.some(({ session: s }) => Date.parse(l.startsAt) < s.date.getTime() + s.duration * 60000 && Date.parse(l.startsAt) + l.durationMinutes * 60000 > s.date.getTime()))) {
        throw new Refusal(409, "One of these lessons overlaps a class you have already booked.");
      }
      const [contract] = await tx.select().from(batchTestContractsTable).where(eq(batchTestContractsTable.batchId, batchId));
      if (!contract) {
        await assertTeacherSchedule(tx, program.teacherId, selected.map((l) => ({ startsAt: new Date(l.startsAt), durationMinutes: l.durationMinutes, label: `Lesson ${l.position + 1}` })), { batchId });
        await tx.insert(batchTestContractsTable).values({ batchId, snapshot, teacherGrantId: access.teacherGrant.id });
      }
      const [booking] = await tx.insert(batchTestBookingsTable).values({ batchId, studentId: viewerId, studentGrantId: access.studentGrant!.id, quote }).returning();
      await tx.insert(batchTestPaymentsTable).values({ bookingId: booking!.id,
        receipt: simulatedBatchReceipt(booking!.id, quote.amountNpr, quote.lessonPositions) });
      for (const lesson of selected) {
        const [mapped] = await tx.select().from(batchTestSessionsTable).where(and(eq(batchTestSessionsTable.batchId, batchId), eq(batchTestSessionsTable.position, lesson.position)));
        let sessionId = mapped?.sessionId;
        if (!sessionId) {
          const [session] = await tx.insert(sessionsTable).values({ teacherId: program.teacherId, teacherName: access.teacher.name,
            subject: "Test class", topic: `${snapshot.programTitle} · Lesson ${lesson.position + 1}`, date: new Date(lesson.startsAt),
            duration: lesson.durationMinutes, maxStudents: snapshot.capacity, price: 0 }).returning();
          sessionId = session!.id;
          await tx.insert(batchTestSessionsTable).values({ batchId, position: lesson.position, sessionId });
          await tx.insert(testClassesTable).values({ sessionId, teacherId: program.teacherId, grantId: access.teacherGrant.id });
        }
        await tx.insert(sessionEnrollmentsTable).values({ sessionId, studentId: viewerId, paymentStatus: "test", paymentMethod: "test_access", paymentReference: null });
        await tx.update(sessionsTable).set({ enrolledCount: sql`${sessionsTable.enrolledCount} + 1` }).where(eq(sessionsTable.id, sessionId));
      }
      // A quote can expire while waiting on locks or writing many lessons. Roll back all
      // rows rather than silently include a lesson that has already begun.
      if (!quote.validBefore || Date.now() >= Date.parse(quote.validBefore) || Date.now() >= Date.parse(snapshot.enrollmentClosesAt)) {
        throw new Refusal(409, "The booking window changed. Refresh the class before confirming.");
      }
      pilot();
    }
    const paymentRows = await tx.select({ bookingId: batchTestPaymentsTable.bookingId,
      receipt: batchTestPaymentsTable.receipt, recordedAt: batchTestPaymentsTable.createdAt })
      .from(batchTestPaymentsTable).innerJoin(batchTestBookingsTable, eq(batchTestBookingsTable.id, batchTestPaymentsTable.bookingId))
      .where(and(eq(batchTestBookingsTable.batchId, batchId), ...(isTeacher ? [] : [eq(batchTestBookingsTable.studentId, viewerId)])))
      .orderBy(asc(batchTestPaymentsTable.createdAt));
    const paymentIds = paymentRows.map((row) => row.bookingId);
    const paymentHistory = paymentIds.length ? await tx.select().from(batchTestLedgerEntriesTable)
      .where(inArray(batchTestLedgerEntriesTable.bookingId, paymentIds))
      .orderBy(asc(batchTestLedgerEntriesTable.id)) : [];
    return { testOnly: true, paymentCollectedNpr: 0, pilotEndsAt: new Date(until).toISOString(), isTeacher,
      receipts: paymentRows.map(r => ({
        ...receiptView(r.receipt as SimulatedBatchReceipt,
          paymentHistory.filter((entry) => entry.bookingId === r.bookingId)),
        bookingId: r.bookingId, recordedAt: r.recordedAt.toISOString(),
      })),
      teacherId: program.teacherId, classTitle: snapshot.programTitle, studentName: access.viewerName,
      offerLessons: snapshot.lessons.filter((l) => quote.lessonPositions.includes(l.position)),
      created: !already && confirm !== undefined, booked: !!already || confirm !== undefined, quote, quoteKey, lessons: await lessonLinks(tx, batchId, viewerId, isTeacher) };
  });
}

router.all("/batch-tests/:id", requireAuth, async (req, res, next) => {
  if (!["GET", "POST"].includes(req.method)) { res.sendStatus(405); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid class address." }); return; }
  if (req.method === "POST" && (typeof req.body?.quoteKey !== "string" || !/^[a-f0-9]{64}$/.test(req.body.quoteKey))) { res.status(400).json({ error: "Review the test booking before confirming." }); return; }
  if (req.method === "POST" && (req.body?.gateway !== "fadko_test" || !["success", "declined"].includes(req.body?.outcome))) {
    res.status(400).json({ error: "Open test checkout and choose a simulated payment result. No real payment details are needed." }); return;
  }
  try {
    await synchronizeBatchTestSettlements(id).catch((error) => req.log.warn({ error }, "could not refresh simulated settlement evidence"));
    const result = await run(id, req.user!.userId, req.method === "POST" ? req.body.quoteKey : undefined, req.body?.outcome);
    if (result.created) {
      recordActivity({ userId: req.user!.userId, action: "batch.test_booked", subjectType: "learning_program_batch", subjectId: id, detail: { testOnly: true, moneyCollected: false } });
      notifyInApp(result.teacherId, { kind: "session_booked", sessionId: result.lessons[0]!.sessionId,
        topic: result.classTitle, fromUserId: req.user!.userId, fromName: result.studentName,
        amount: 0, testBooking: true, at: new Date().toISOString() });
    }
    res.setHeader("Cache-Control", "no-store").json(result);
  } catch (err) {
    if (err instanceof Refusal) { res.status(err.status).json({ error: err.message }); return; }
    next(err);
  }
});
export default router;
