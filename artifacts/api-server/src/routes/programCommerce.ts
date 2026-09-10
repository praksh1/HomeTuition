import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  learningProgramAllocationsTable,
  learningProgramEnrollmentsTable,
  learningProgramLedgerEntriesTable,
  learningProgramsTable,
  testStudentGrantsTable,
  usersTable,
} from "@workspace/db";

import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { liveTestStudentGrant, testStudentAllowed } from "../lib/testStudentAccess";
import {
  PROGRAM_ALLOCATION_EVENTS,
  PROGRAM_BETA_COMPLAINT_WINDOW_HOURS,
  PROGRAM_BETA_PAYOUT_WEEKDAY,
  PROGRAM_BETA_PLATFORM_SHARE_BPS,
  PROGRAM_BETA_STUDENT_FEE_NPR,
  PROGRAM_BETA_TEACHER_SHARE_BPS,
  ProgramCommerceInputError,
  allocateProgramShares,
  transitionProgramAllocation,
  type ProgramAllocationEvent,
  type ProgramAllocationState,
} from "../lib/programCommerce";
import { publishedSnapshotFor } from "../lib/learningProgramState";

const router: IRouter = Router();

function idOf(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function positiveWhole(raw: unknown): number | null {
  return Number.isSafeInteger(raw) && Number(raw) > 0 ? Number(raw) : null;
}

function totals(rows: Array<{ state: string; grossAmountNpr: number; teacherAmountNpr: number }>) {
  const byState: Record<string, { grossNpr: number; teacherNpr: number; lessons: number }> = {};
  for (const row of rows) {
    const total = byState[row.state] ?? { grossNpr: 0, teacherNpr: 0, lessons: 0 };
    total.grossNpr += row.grossAmountNpr;
    total.teacherNpr += row.teacherAmountNpr;
    total.lessons += 1;
    byState[row.state] = total;
  }
  return byState;
}

const EVENTS_REQUIRING_NOTE = new Set<ProgramAllocationEvent>([
  "refund_approved",
  "complaint_upheld",
  "complaint_denied",
]);

/** Published Programs and currently authorised test students for the operator rehearsal screen. */
router.get(
  "/admin/program-commerce/setup",
  requireAuth,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const programs = await db
      .select({
        id: learningProgramsTable.id,
        version: learningProgramsTable.version,
        snapshot: learningProgramsTable.publishedSnapshot,
      })
      .from(learningProgramsTable)
      .where(eq(learningProgramsTable.status, "published"))
      .orderBy(desc(learningProgramsTable.publishedAt));
    const students = testStudentAllowed()
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, validUntil: testStudentGrantsTable.validUntil })
          .from(testStudentGrantsTable)
          .innerJoin(usersTable, eq(usersTable.id, testStudentGrantsTable.studentId))
          .where(and(
            isNull(testStudentGrantsTable.revokedAt),
            gt(testStudentGrantsTable.validUntil, sql`now()`),
            eq(usersTable.role, "student"),
          ))
          .orderBy(asc(usersTable.name))
      : [];
    res.json({
      programs: programs.flatMap((row) => {
        const snapshot = publishedSnapshotFor({ version: row.version, publishedSnapshot: row.snapshot });
        return snapshot ? [{ id: row.id, version: row.version, title: snapshot.title, lessonCount: snapshot.modules.length }] : [];
      }),
      students,
      testAccessEnabled: testStudentAllowed(),
    });
  },
);

/**
 * Create a shadow enrolment. This is an operator-only test fixture, not a checkout: it requires
 * the student's live test grant and writes `test_confirmed` with no provider reference.
 */
router.post(
  "/admin/program-commerce/programs/:id/test-enrolments",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const programId = idOf(req.params.id);
    const studentId = positiveWhole(req.body?.studentId);
    const totalTuitionNpr = positiveWhole(req.body?.totalTuitionNpr);
    const paidLessonCount = positiveWhole(req.body?.paidLessonCount);
    if (!programId || !studentId || !totalTuitionNpr || !paidLessonCount) {
      res.status(400).json({ error: "Choose a published program, a test student, a whole NPR total, and a lesson count." });
      return;
    }

    const grant = await liveTestStudentGrant(studentId);
    if (!grant) {
      res.status(403).json({ error: "That student does not have active operator-granted test access." });
      return;
    }

    let shares;
    try {
      shares = allocateProgramShares(totalTuitionNpr, paidLessonCount);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Those test terms are not valid." });
      return;
    }

    const [program] = await db
      .select({
        id: learningProgramsTable.id,
        teacherId: learningProgramsTable.teacherId,
        status: learningProgramsTable.status,
        version: learningProgramsTable.version,
        snapshot: learningProgramsTable.publishedSnapshot,
      })
      .from(learningProgramsTable)
      .where(eq(learningProgramsTable.id, programId))
      .limit(1);
    const snapshot = program ? publishedSnapshotFor({ version: program.version, publishedSnapshot: program.snapshot }) : null;
    if (!program || program.status !== "published" || !snapshot) {
      res.status(404).json({ error: "That published program was not found." });
      return;
    }
    const [student] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, studentId)).limit(1);
    if (!student || student.role !== "student") {
      res.status(400).json({ error: "Test enrolment is available only for a student account." });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const termsSnapshot = {
          kind: "program_beta_shadow_v1",
          programTitle: snapshot.title,
          programVersion: program.version,
          totalTuitionNpr,
          paidLessonCount,
          teacherShareBps: PROGRAM_BETA_TEACHER_SHARE_BPS,
          platformShareBps: PROGRAM_BETA_PLATFORM_SHARE_BPS,
          studentFeeNpr: PROGRAM_BETA_STUDENT_FEE_NPR,
          complaintWindowHours: PROGRAM_BETA_COMPLAINT_WINDOW_HOURS,
          payoutWeekday: PROGRAM_BETA_PAYOUT_WEEKDAY,
          payoutWeekdayProvisional: true,
        };
        const [enrollment] = await tx
          .insert(learningProgramEnrollmentsTable)
          .values({
            programId,
            studentId,
            programVersion: program.version,
            totalTuitionNpr,
            paidLessonCount,
            teacherShareBps: PROGRAM_BETA_TEACHER_SHARE_BPS,
            platformShareBps: PROGRAM_BETA_PLATFORM_SHARE_BPS,
            studentFeeNpr: PROGRAM_BETA_STUDENT_FEE_NPR,
            complaintWindowHours: PROGRAM_BETA_COMPLAINT_WINDOW_HOURS,
            payoutWeekday: PROGRAM_BETA_PAYOUT_WEEKDAY,
            paymentStatus: "test_confirmed",
            paymentReference: null,
            termsSnapshot,
            createdBy: req.user!.userId,
          })
          .returning();
        if (!enrollment) throw new Error("Could not create the test enrolment.");
        const allocations = await tx
          .insert(learningProgramAllocationsTable)
          .values(shares.map((share) => ({
            enrollmentId: enrollment.id,
            lessonNumber: share.lessonNumber,
            grossAmountNpr: share.amountNpr,
            teacherAmountNpr: share.teacherAmountNpr,
            platformAmountNpr: share.platformAmountNpr,
            state: share.state,
          })))
          .returning();
        await tx.insert(learningProgramLedgerEntriesTable).values({
          enrollmentId: enrollment.id,
          allocationId: null,
          actorId: req.user!.userId,
          event: "test_enrolment_created",
          fromState: null,
          toState: null,
          grossAmountNpr: totalTuitionNpr,
          detail: { paymentMoved: false, grantId: grant.id, allocationCount: allocations.length },
        });
        return { enrollment, allocations };
      });
      res.status(201).json({
        testEnrollment: result.enrollment,
        allocations: result.allocations,
        notice: "TEST ONLY — no payment was processed.",
      });
    } catch (error: any) {
      if (error?.code === "23505") {
        res.status(409).json({ error: "This student already has a test enrolment in that program." });
        return;
      }
      res.status(503).json({ error: "The test enrolment could not be recorded. Nothing was charged." });
    }
  },
);

/** Move one simulated lesson through the approved state machine and record the reason. */
router.post(
  "/admin/program-commerce/allocations/:id/events",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const allocationId = idOf(req.params.id);
    const event = typeof req.body?.event === "string" ? req.body.event : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
    if (!allocationId || !PROGRAM_ALLOCATION_EVENTS.includes(event as ProgramAllocationEvent)) {
      res.status(400).json({ error: "Choose a valid lesson allocation and action." });
      return;
    }
    if (EVENTS_REQUIRING_NOTE.has(event as ProgramAllocationEvent) && !note) {
      res.status(400).json({ error: "Write the reason for that complaint or refund decision." });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(learningProgramAllocationsTable)
          .where(eq(learningProgramAllocationsTable.id, allocationId))
          .for("update")
          .limit(1);
        if (!row) return null;
        const next = transitionProgramAllocation(row.state as ProgramAllocationState, event as ProgramAllocationEvent);
        const [changed] = await tx
          .update(learningProgramAllocationsTable)
          .set({ state: next, stateChangedAt: new Date() })
          .where(eq(learningProgramAllocationsTable.id, row.id))
          .returning();
        await tx.insert(learningProgramLedgerEntriesTable).values({
          enrollmentId: row.enrollmentId,
          allocationId: row.id,
          actorId: req.user!.userId,
          event,
          fromState: row.state,
          toState: next,
          grossAmountNpr: row.grossAmountNpr,
          detail: { note: note || null, paymentMoved: false },
        });
        return changed;
      });
      if (!updated) {
        res.status(404).json({ error: "That lesson allocation was not found." });
        return;
      }
      res.json({ allocation: updated, notice: "Shadow ledger only — no payment moved." });
    } catch (error) {
      if (error instanceof ProgramCommerceInputError) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(503).json({ error: "The shadow ledger could not be updated. No payment moved." });
    }
  },
);

/** Teacher statement. Test values are labelled and never included in ordinary earnings. */
router.get("/learning-program-earnings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [account] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  if (!account || account.role !== "teacher") {
    res.status(403).json({ error: "This statement is available to teachers." });
    return;
  }
  const enrollments = await db
    .select({
      id: learningProgramEnrollmentsTable.id,
      programId: learningProgramEnrollmentsTable.programId,
      paymentStatus: learningProgramEnrollmentsTable.paymentStatus,
      totalTuitionNpr: learningProgramEnrollmentsTable.totalTuitionNpr,
      terms: learningProgramEnrollmentsTable.termsSnapshot,
      enrolledAt: learningProgramEnrollmentsTable.enrolledAt,
    })
    .from(learningProgramEnrollmentsTable)
    .innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramEnrollmentsTable.programId))
    .where(eq(learningProgramsTable.teacherId, req.user!.userId))
    .orderBy(desc(learningProgramEnrollmentsTable.id));
  const ids = enrollments.map((row) => row.id);
  const allocations = ids.length
    ? await db.select().from(learningProgramAllocationsTable)
        .where(inArray(learningProgramAllocationsTable.enrollmentId, ids))
        .orderBy(asc(learningProgramAllocationsTable.enrollmentId), asc(learningProgramAllocationsTable.lessonNumber))
    : [];
  res.json({
    mode: "test",
    notice: "Shadow statement — these amounts were not collected and cannot be paid out.",
    totals: totals(allocations),
    enrollments: enrollments.map((row) => ({
      ...row,
      programTitle: (row.terms as { programTitle?: unknown } | null)?.programTitle ?? null,
      allocations: allocations.filter((allocation) => allocation.enrollmentId === row.id),
    })),
  });
});

/** Operator reconciliation: one human-readable read model over the append-only test history. */
router.get(
  "/admin/program-commerce/reconciliation",
  requireAuth,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const enrollments = await db
      .select({
        id: learningProgramEnrollmentsTable.id,
        programId: learningProgramEnrollmentsTable.programId,
        teacherId: learningProgramsTable.teacherId,
        studentId: learningProgramEnrollmentsTable.studentId,
        totalTuitionNpr: learningProgramEnrollmentsTable.totalTuitionNpr,
        paymentStatus: learningProgramEnrollmentsTable.paymentStatus,
        paymentReference: learningProgramEnrollmentsTable.paymentReference,
        terms: learningProgramEnrollmentsTable.termsSnapshot,
        enrolledAt: learningProgramEnrollmentsTable.enrolledAt,
      })
      .from(learningProgramEnrollmentsTable)
      .innerJoin(learningProgramsTable, eq(learningProgramsTable.id, learningProgramEnrollmentsTable.programId))
      .orderBy(desc(learningProgramEnrollmentsTable.id));
    const ids = enrollments.map((row) => row.id);
    const allocations = ids.length
      ? await db.select().from(learningProgramAllocationsTable).where(inArray(learningProgramAllocationsTable.enrollmentId, ids))
      : [];
    const ledger = ids.length
      ? await db.select().from(learningProgramLedgerEntriesTable)
          .where(inArray(learningProgramLedgerEntriesTable.enrollmentId, ids))
          .orderBy(desc(learningProgramLedgerEntriesTable.id))
      : [];
    res.json({
      mode: "test",
      notice: "Reconciliation rehearsal only — no gateway payment, refund, or payout exists.",
      totals: totals(allocations),
      enrollments: enrollments.map((row) => ({
        ...row,
        title: (row.terms as { programTitle?: unknown } | null)?.programTitle ?? null,
        allocations: allocations.filter((allocation) => allocation.enrollmentId === row.id),
        history: ledger.filter((entry) => entry.enrollmentId === row.id),
      })),
    });
  },
);

/** The signed-in student's own simulated Program place, if one exists. */
router.get("/programs/:id/my-test-enrolment", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const programId = idOf(req.params.id);
  if (!programId) {
    res.status(400).json({ error: "That program address is not valid." });
    return;
  }
  const [enrollment] = await db
    .select()
    .from(learningProgramEnrollmentsTable)
    .where(and(
      eq(learningProgramEnrollmentsTable.programId, programId),
      eq(learningProgramEnrollmentsTable.studentId, req.user!.userId),
    ))
    .limit(1);
  if (!enrollment) {
    res.json({ testEnrollment: null });
    return;
  }
  const allocations = await db.select().from(learningProgramAllocationsTable)
    .where(eq(learningProgramAllocationsTable.enrollmentId, enrollment.id))
    .orderBy(asc(learningProgramAllocationsTable.lessonNumber));
  res.json({ testEnrollment: enrollment, allocations, notice: "TEST ONLY — no payment was processed." });
});

export default router;
