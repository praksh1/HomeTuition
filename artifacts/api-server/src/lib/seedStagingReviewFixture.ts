import { eq, sql } from "drizzle-orm";
import {
  db,
  disputesTable,
  scheduleChangesTable,
  sessionActivityTable,
  sessionEnrollmentsTable,
  sessionMessagesTable,
  sessionParticipationTable,
  sessionQualitySamplesTable,
  sessionsTable,
  ticketEventsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";

const PREVIEW_ORIGIN = "https://hometuition-preview.praksh-dhakal.workers.dev";
const TEACHER_EMAIL = "review.fixture.teacher@sikshya.invalid";
const REPORTER_EMAIL = "review.fixture.student@sikshya.invalid";
const ABSENT_EMAIL = "review.fixture.absent@sikshya.invalid";
const TOPIC = "STAGING REVIEW — Algebra and linear equations";
const DESCRIPTION_MARKER = "STAGING DEMONSTRATION CASE — no real class, payment, or complaint.";

function stagingOnly(): boolean {
  return (
    process.env["PUBLIC_APP_URL"] === PREVIEW_ORIGIN &&
    process.env["VIDEO_PROVIDER"] === "echo" &&
    process.env["ALLOW_TEST_TEACHING_ACCESS"] === "true"
  );
}

/**
 * One-use staging fixture. It is guarded by three independent staging settings and exact synthetic
 * identities. The temporary caller is removed after the row is proven present; the data remains so
 * the non-technical owner has a real operator page to review.
 */
export async function seedStagingReviewFixture(): Promise<void> {
  if (!stagingOnly()) return;

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(734221, 20260905)`);

      const existing = await tx
        .select({ id: disputesTable.id })
        .from(disputesTable)
        .where(eq(disputesTable.description, DESCRIPTION_MARKER))
        .limit(1);
      if (existing[0]) return { ticketId: existing[0].id, created: false };

      const syntheticPasswordHash = "$2b$12$stagingReviewFixtureCannotAuthenticate000000000000000000";
      for (const user of [
        { email: TEACHER_EMAIL, name: "Demo Teacher — Staging", role: "teacher" },
        { email: REPORTER_EMAIL, name: "Demo Student — Reporter", role: "student" },
        { email: ABSENT_EMAIL, name: "Demo Student — Did Not Attend", role: "student" },
      ]) {
        await tx.insert(usersTable).values({ ...user, passwordHash: syntheticPasswordHash }).onConflictDoNothing();
      }

      const people = await tx
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(sql`${usersTable.email} IN (${TEACHER_EMAIL}, ${REPORTER_EMAIL}, ${ABSENT_EMAIL})`);
      const idFor = (email: string): number => {
        const id = people.find((person) => person.email === email)?.id;
        if (!id) throw new Error(`Missing synthetic staging identity: ${email}`);
        return id;
      };
      const teacherId = idFor(TEACHER_EMAIL);
      const reporterId = idFor(REPORTER_EMAIL);
      const absentId = idFor(ABSENT_EMAIL);

      const scheduledAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      scheduledAt.setUTCMinutes(15, 0, 0);
      const previousDate = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
      const createdAt = new Date(previousDate.getTime() - 2 * 24 * 60 * 60 * 1000);
      const changedAt = new Date(createdAt.getTime() + 8 * 60 * 60 * 1000);
      const startedAt = new Date(scheduledAt.getTime() + 12 * 60 * 1000);
      const endedAt = new Date(scheduledAt.getTime() + 72 * 60 * 1000);

      const [session] = await tx
        .insert(sessionsTable)
        .values({
          teacherId,
          teacherName: "Demo Teacher — Staging",
          subject: "Mathematics",
          topic: TOPIC,
          date: scheduledAt,
          duration: 90,
          maxStudents: 12,
          enrolledCount: 2,
          price: 450,
          status: "completed",
          startedAt,
          createdAt,
          updatedAt: endedAt,
        })
        .returning({ id: sessionsTable.id });
      if (!session) throw new Error("Could not create synthetic staging session");

      await tx.insert(sessionEnrollmentsTable).values([
        {
          sessionId: session.id,
          studentId: reporterId,
          paymentStatus: "paid",
          paymentMethod: "simulated-test",
          paymentReference: "STAGING-DEMO-NOT-A-RECEIPT",
          enrolledAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
        },
        {
          sessionId: session.id,
          studentId: absentId,
          paymentStatus: "paid",
          paymentMethod: "simulated-test",
          paymentReference: "STAGING-DEMO-NOT-A-RECEIPT-2",
          enrolledAt: new Date(createdAt.getTime() + 2 * 60 * 60 * 1000),
        },
      ]);

      await tx.insert(scheduleChangesTable).values({
        sessionId: session.id,
        teacherId,
        previousDate,
        newDate: scheduledAt,
        affectedStudents: 2,
        changedAt,
      });
      await tx.insert(sessionActivityTable).values({
        sessionId: session.id,
        teacherLastSeenAt: new Date(endedAt.getTime() - 5 * 60 * 1000),
        endedAt,
      });
      await tx.insert(sessionParticipationTable).values([
        {
          sessionId: session.id,
          userId: teacherId,
          role: "teacher",
          firstJoinedAt: startedAt,
          lastSeenAt: new Date(endedAt.getTime() - 5 * 60 * 1000),
          presentMs: 55 * 60 * 1000,
          joinCount: 3,
          drawCount: 18,
          messageCount: 2,
        },
        {
          sessionId: session.id,
          userId: reporterId,
          role: "student",
          firstJoinedAt: new Date(scheduledAt.getTime() + 2 * 60 * 1000),
          lastSeenAt: endedAt,
          presentMs: 68 * 60 * 1000,
          joinCount: 2,
          drawCount: 0,
          messageCount: 1,
        },
      ]);
      await tx.insert(sessionMessagesTable).values([
        {
          sessionId: session.id,
          senderId: teacherId,
          senderName: "Demo Teacher — Staging",
          senderRole: "teacher",
          body: "The class time has moved by one day. Please check the updated schedule.",
          createdAt: changedAt,
        },
        {
          sessionId: session.id,
          senderId: teacherId,
          senderName: "Demo Teacher — Staging",
          senderRole: "teacher",
          body: "I am having connection trouble and will join shortly.",
          createdAt: new Date(scheduledAt.getTime() + 5 * 60 * 1000),
        },
        {
          sessionId: session.id,
          senderId: reporterId,
          senderName: "Demo Student — Reporter",
          senderRole: "student",
          body: "The video keeps disconnecting. Is the class continuing?",
          createdAt: new Date(scheduledAt.getTime() + 35 * 60 * 1000),
        },
      ]);
      await tx.insert(sessionQualitySamplesTable).values([
        { sessionId: session.id, userId: teacherId, role: "teacher", quality: "good", reconnect: false, observedAt: startedAt },
        { sessionId: session.id, userId: teacherId, role: "teacher", quality: "warning", reconnect: false, observedAt: new Date(startedAt.getTime() + 18 * 60 * 1000) },
        { sessionId: session.id, userId: teacherId, role: "teacher", quality: "bad", reconnect: true, observedAt: new Date(startedAt.getTime() + 31 * 60 * 1000) },
        { sessionId: session.id, userId: teacherId, role: "teacher", quality: "good", reconnect: true, observedAt: new Date(startedAt.getTime() + 38 * 60 * 1000) },
      ]);

      const [ticket] = await tx
        .insert(disputesTable)
        .values({
          userId: reporterId,
          sessionId: session.id,
          reason: "Refund Request",
          description: DESCRIPTION_MARKER,
          status: "open",
          createdAt: new Date(endedAt.getTime() + 2 * 60 * 60 * 1000),
          updatedAt: new Date(endedAt.getTime() + 2 * 60 * 60 * 1000),
        })
        .returning({ id: disputesTable.id });
      if (!ticket) throw new Error("Could not create synthetic staging ticket");
      await tx.insert(ticketEventsTable).values({
        ticketId: ticket.id,
        actorId: reporterId,
        actorRole: "student",
        actorName: "Demo Student — Reporter",
        toStatus: "open",
        note: "Synthetic staging-only report created for operator UI review.",
        at: new Date(endedAt.getTime() + 2 * 60 * 60 * 1000),
      });

      return { ticketId: ticket.id, created: true };
    });

    logger.info(result, "staging operator-review fixture is ready");
  } catch (err) {
    logger.error({ err }, "could not create staging operator-review fixture");
  }
}
