import { and, eq } from "drizzle-orm";
import { db, sessionsTable, sessionEnrollmentsTable } from "@workspace/db";

/**
 * How early a paid student may enter the classroom.
 *
 * Students used to be locked out until the teacher pressed start, which meant nobody could be
 * waiting when the class began — every class opened with the teacher talking to an empty room
 * while students refreshed. Opening the door slightly early lets the room fill up first.
 */
export const JOIN_WINDOW_MINUTES = 5;

export interface SessionMembership {
  /** True only for the teacher who owns this session — not merely any teacher account. */
  isSessionTeacher: boolean;
  /** True if the user holds an enrolment row for this session, paid or not. */
  isEnrolledStudent: boolean;
  /** True once that enrolment has been paid for. Free sessions count as paid. */
  hasPaid: boolean;
  status: string;
  /** Scheduled start, used to decide whether the early-join window is open. */
  scheduledFor: Date | null;
}

/**
 * Single source of truth for "may this user be in this class?".
 *
 * A class has more than one door — the video room URL and the whiteboard socket — and each has
 * to be locked. They were not: the socket verified membership while `GET /sessions/:id/room`
 * checked only that the caller was logged in, so an unenrolled student was refused the board
 * and chat but still handed the room URL and could watch the teacher's video. Both callers
 * share this function so the two can no longer disagree.
 */
export async function getSessionMembership(
  sessionId: number,
  userId: number,
): Promise<SessionMembership | null> {
  const [session] = await db
    .select({
      teacherId: sessionsTable.teacherId,
      price: sessionsTable.price,
      status: sessionsTable.status,
      date: sessionsTable.date,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) return null;

  const scheduledFor = session.date ? new Date(session.date as unknown as string) : null;

  if (session.teacherId === userId) {
    return {
      isSessionTeacher: true,
      isEnrolledStudent: false,
      hasPaid: true,
      status: session.status,
      scheduledFor,
    };
  }

  const [enrollment] = await db
    .select({ id: sessionEnrollmentsTable.id, paymentStatus: sessionEnrollmentsTable.paymentStatus })
    .from(sessionEnrollmentsTable)
    .where(
      and(
        eq(sessionEnrollmentsTable.sessionId, sessionId),
        eq(sessionEnrollmentsTable.studentId, userId),
      ),
    );

  // A free class has nothing to pay, so enrolling in one is already "paid".
  const hasPaid = !!enrollment && (session.price <= 0 || enrollment.paymentStatus === "paid");

  return {
    isSessionTeacher: false,
    isEnrolledStudent: !!enrollment,
    hasPaid,
    status: session.status,
    scheduledFor,
  };
}

/** True once we are inside the early-join window for a session that has not started yet. */
export function joinWindowOpen(m: SessionMembership, now = new Date()): boolean {
  if (!m.scheduledFor) return false;
  const opensAt = m.scheduledFor.getTime() - JOIN_WINDOW_MINUTES * 60_000;
  return now.getTime() >= opensAt;
}

/**
 * May this user actually be in the class?
 *
 * Payment is the hard gate: a student who never paid holds nothing and is refused outright.
 * Timing is the soft gate — a paid student is admitted once the class is live, or once we are
 * within `JOIN_WINDOW_MINUTES` of the scheduled start so they can wait in the room for the
 * teacher. The teacher who owns the session always passes, at any time, because someone has to
 * be able to open the room.
 */
export function canAccessSession(m: SessionMembership | null, now = new Date()): boolean {
  if (!m) return false;
  if (m.isSessionTeacher) return true;
  if (!m.isEnrolledStudent || !m.hasPaid) return false;
  if (m.status === "cancelled") return false;
  if (m.status === "live") return true;
  // A completed class is over; replaying it is not a thing the product does yet.
  if (m.status === "completed") return false;
  return joinWindowOpen(m, now);
}
