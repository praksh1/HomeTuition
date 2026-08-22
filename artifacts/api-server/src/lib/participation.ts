import { and, eq, sql } from "drizzle-orm";
import { db, sessionParticipationTable, sessionEnrollmentsTable, usersTable } from "@workspace/db";

/**
 * Writing down who was in a class and reading it back.
 *
 * The reason this exists is refunds. See the table's own comment in
 * lib/db/src/schema/sessionParticipation.ts, and REFUNDS.md for the policy it has to serve.
 *
 * Two properties are load-bearing here, and both are about not making a classroom worse:
 *
 * 1. **Nothing in this file throws.** It is called from the classroom hub on every join, every
 *    thirty seconds, and every disconnect. A database that is asleep, a table that has not been
 *    pushed yet, a network blip — none of those may end anybody's lesson. A failed write loses
 *    a fact; a thrown one would lose the class.
 *
 * 2. **Writes are batched, not per-event.** A busy board sends dozens of updates a second. The
 *    hub counts them in memory and flushes a total, so the cost of recording a lesson is two
 *    or three rows a minute rather than one row per stroke.
 */

/** How much has happened on one connection since it was last written down. */
export interface ParticipationDelta {
  /** Milliseconds this connection has been open since the previous flush. */
  presentMs: number;
  /** Board writes since the previous flush. */
  drawCount: number;
  /** Chat messages sent since the previous flush. */
  messageCount: number;
  /** True on the first flush of a connection, so reconnections can be counted. */
  opened: boolean;
}

/**
 * Adds one connection's activity to the ledger.
 *
 * Additive by construction: every number is `existing + delta`, so two of a person's devices,
 * or a reconnection racing the flush of the connection it replaced, both come out right
 * without any locking. `first_joined_at` is written once and never touched again.
 */
export async function recordParticipation(
  sessionId: number,
  userId: number,
  role: "teacher" | "student",
  delta: ParticipationDelta,
): Promise<void> {
  const presentMs = Math.max(0, Math.round(delta.presentMs));
  const drawCount = Math.max(0, delta.drawCount);
  const messageCount = Math.max(0, delta.messageCount);
  const opened = delta.opened ? 1 : 0;
  // Nothing happened and nothing opened: a flush timer that fired on an idle connection.
  if (!opened && presentMs === 0 && drawCount === 0 && messageCount === 0) return;

  try {
    const now = new Date();
    await db
      .insert(sessionParticipationTable)
      .values({
        sessionId,
        userId,
        role,
        firstJoinedAt: now,
        lastSeenAt: now,
        presentMs,
        joinCount: opened,
        drawCount,
        messageCount,
      })
      .onConflictDoUpdate({
        target: [sessionParticipationTable.sessionId, sessionParticipationTable.userId],
        // `role` and `first_joined_at` are deliberately absent: the first answer to both is the
        // true one. A teacher who rejoins is still the teacher, and still arrived when they
        // arrived.
        set: {
          lastSeenAt: now,
          presentMs: sql`${sessionParticipationTable.presentMs} + ${presentMs}`,
          joinCount: sql`${sessionParticipationTable.joinCount} + ${opened}`,
          drawCount: sql`${sessionParticipationTable.drawCount} + ${drawCount}`,
          messageCount: sql`${sessionParticipationTable.messageCount} + ${messageCount}`,
        },
      });
  } catch {
    // A class that cannot record attendance still runs. See the note at the top of this file.
  }
}

/** One person's presence in one class, as recorded. */
export interface AttendanceRow {
  userId: number;
  name: string;
  role: "teacher" | "student";
  firstJoinedAt: Date;
  lastSeenAt: Date;
  presentMs: number;
  joinCount: number;
  drawCount: number;
  messageCount: number;
}

/**
 * Everyone who was in this class, teacher included.
 *
 * `known: false` means the ledger could not be read at all, which is not the same answer as
 * "nobody came" and must never be shown as one — the same distinction `activityFor` draws, and
 * for the same reason: a lookup that failed decides nothing.
 */
export async function attendanceFor(
  sessionId: number,
): Promise<{ known: boolean; rows: AttendanceRow[] }> {
  try {
    const rows = await db
      .select({
        userId: sessionParticipationTable.userId,
        name: usersTable.name,
        role: sessionParticipationTable.role,
        firstJoinedAt: sessionParticipationTable.firstJoinedAt,
        lastSeenAt: sessionParticipationTable.lastSeenAt,
        presentMs: sessionParticipationTable.presentMs,
        joinCount: sessionParticipationTable.joinCount,
        drawCount: sessionParticipationTable.drawCount,
        messageCount: sessionParticipationTable.messageCount,
      })
      .from(sessionParticipationTable)
      .innerJoin(usersTable, eq(usersTable.id, sessionParticipationTable.userId))
      .where(eq(sessionParticipationTable.sessionId, sessionId));

    return {
      known: true,
      rows: rows.map((row) => ({
        ...row,
        role: row.role === "teacher" ? ("teacher" as const) : ("student" as const),
      })),
    };
  } catch {
    return { known: false, rows: [] };
  }
}

/** A student who has paid for this class, whether or not they turned up. */
export interface EnrolledStudent {
  userId: number;
  name: string;
  email: string;
  enrolledAt: Date;
  paymentStatus: string;
}

/**
 * Who has bought a place in this class.
 *
 * Separate from attendance on purpose. The teacher's question before a class starts is "who is
 * coming", and the answer to that is the enrolment list; the question afterwards is "who
 * actually came", and only the ledger can answer that. Showing one as if it were the other is
 * how a teacher ends up believing a student attended a lesson they never opened.
 */
export async function enrolledStudents(sessionId: number): Promise<EnrolledStudent[]> {
  const rows = await db
    .select({
      userId: sessionEnrollmentsTable.studentId,
      name: usersTable.name,
      email: usersTable.email,
      enrolledAt: sessionEnrollmentsTable.enrolledAt,
      paymentStatus: sessionEnrollmentsTable.paymentStatus,
    })
    .from(sessionEnrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionEnrollmentsTable.studentId))
    .where(
      and(
        eq(sessionEnrollmentsTable.sessionId, sessionId),
        // Booking is atomic and there is no pending state, so anything that is not paid is
        // either a refund or a row from before that rule existed. Neither is someone to expect.
        eq(sessionEnrollmentsTable.paymentStatus, "paid"),
      ),
    );
  return rows;
}
