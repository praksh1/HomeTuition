import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { db, learningProgramsTable, learningProgramBatchesTable, teacherProfilesTable, usersTable,
  userOnboardingTable, testTeachingGrantsTable, testStudentGrantsTable, batchTestContractsTable,
  batchTestBookingsTable, batchTestSessionsTable, sessionsTable, sessionEnrollmentsTable, testClassesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { emailVerifiedFor } from "../lib/accountSecurity";
import { testPilotDeadline } from "../lib/testPilot";
import { testTeachingAllowed } from "../lib/testTeachingAccess";
import { testStudentAllowed } from "../lib/testStudentAccess";
import { readBatchSnapshot } from "../lib/programBatches";
import { classJoiningPreview } from "../lib/classJoining";
import { assertTeacherSchedule, lockTeacherSchedule } from "../lib/teacherSchedule";
import { recordActivity } from "../lib/activityLog";

const router = Router();
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
  if (viewerId === teacherId) return { teacher, teacherGrant, studentGrant: null };
  // Serializes two different batch bookings by the same student before checking their timetable.
  const [viewer] = await tx.select().from(usersTable).where(eq(usersTable.id, viewerId)).for("update");
  const [onboarding] = await tx.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, viewerId));
  if (!viewer || viewer.role !== "student" || viewer.suspendedAt || !onboarding?.completedAt || !await emailVerifiedFor(viewerId)) {
    throw new Refusal(403, "Complete and verify an active student account before testing booking.");
  }
  const [studentGrant] = await tx.select().from(testStudentGrantsTable).where(and(eq(testStudentGrantsTable.studentId, viewerId), isNull(testStudentGrantsTable.revokedAt), gt(testStudentGrantsTable.validUntil, sql`now()`))).for("share");
  if (!studentGrant) throw new Refusal(403, "An operator must enable your student test access first.");
  return { teacher, teacherGrant, studentGrant };
}
async function lessonLinks(tx: Tx, batchId: number, viewerId: number, isTeacher: boolean) {
  const rows = await tx.select({ position: batchTestSessionsTable.position, session: sessionsTable }).from(batchTestSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, batchTestSessionsTable.sessionId)).where(eq(batchTestSessionsTable.batchId, batchId)).orderBy(asc(batchTestSessionsTable.position));
  const enrolled = isTeacher || !rows.length ? [] : await tx.select({ sessionId: sessionEnrollmentsTable.sessionId }).from(sessionEnrollmentsTable)
    .where(and(eq(sessionEnrollmentsTable.studentId, viewerId), eq(sessionEnrollmentsTable.paymentStatus, "test"), inArray(sessionEnrollmentsTable.sessionId, rows.map((r) => r.session.id))));
  return rows.filter((r) => isTeacher || enrolled.some((e) => e.sessionId === r.session.id)).map((r) => ({ position: r.position, sessionId: r.session.id, startsAt: r.session.date.toISOString(), durationMinutes: r.session.duration }));
}

async function run(batchId: number, viewerId: number, confirm?: string) {
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
      await tx.insert(batchTestBookingsTable).values({ batchId, studentId: viewerId, studentGrantId: access.studentGrant!.id, quote });
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
    return { testOnly: true, paymentCollectedNpr: 0, pilotEndsAt: new Date(until).toISOString(), isTeacher,
      offerLessons: snapshot.lessons.filter((l) => quote.lessonPositions.includes(l.position)),
      created: !already && confirm !== undefined, booked: !!already || confirm !== undefined, quote, quoteKey, lessons: await lessonLinks(tx, batchId, viewerId, isTeacher) };
  });
}

router.all("/batch-tests/:id", requireAuth, async (req, res, next) => {
  if (!["GET", "POST"].includes(req.method)) { res.sendStatus(405); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid class address." }); return; }
  if (req.method === "POST" && (typeof req.body?.quoteKey !== "string" || !/^[a-f0-9]{64}$/.test(req.body.quoteKey))) { res.status(400).json({ error: "Review the test booking before confirming." }); return; }
  try {
    const result = await run(id, req.user!.userId, req.method === "POST" ? req.body.quoteKey : undefined);
    if (result.created) recordActivity({ userId: req.user!.userId, action: "batch.test_booked", subjectType: "learning_program_batch", subjectId: id, detail: { testOnly: true, moneyCollected: false } });
    res.setHeader("Cache-Control", "no-store").json(result);
  } catch (err) {
    if (err instanceof Refusal) { res.status(err.status).json({ error: err.message }); return; }
    next(err);
  }
});
export default router;
