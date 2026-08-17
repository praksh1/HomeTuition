import { and, eq } from "drizzle-orm";
import { db, sessionsTable, sessionEnrollmentsTable } from "@workspace/db";

export interface SessionMembership {
  /** True only for the teacher who owns this session — not merely any teacher account. */
  isSessionTeacher: boolean;
  /** True if the user holds an enrolment row for this session, paid or not. */
  isEnrolledStudent: boolean;
  /** True once that enrolment has been paid for. Free sessions count as paid. */
  hasPaid: boolean;
}

/**
 * Single source of truth for "may this user be in this class?".
 *
 * A class has more than one door — the video room URL and the whiteboard socket — and each
 * has to be locked. They were not: the socket verified membership while
 * `GET /sessions/:id/room` checked only that the caller was logged in, so an unenrolled
 * student was refused the board and chat but still handed the room URL and could watch the
 * teacher's video. Both callers share this function so the two can no longer disagree.
 *
 * Enrolment existence — not `paymentStatus === "paid"` — is the bar, matching the rest of the
 * app: `POST /sessions/:id/enroll` creates rows as "pending" and nothing promotes them yet.
 * Tighten here once payment confirmation is wired up, and both doors tighten together.
 */
export async function getSessionMembership(
  sessionId: number,
  userId: number,
): Promise<SessionMembership | null> {
  const [session] = await db
    .select({ teacherId: sessionsTable.teacherId, price: sessionsTable.price })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) return null;

  if (session.teacherId === userId) {
    return { isSessionTeacher: true, isEnrolledStudent: false, hasPaid: true };
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

  return { isSessionTeacher: false, isEnrolledStudent: !!enrollment, hasPaid };
}

/**
 * May this user actually be in the class?
 *
 * Enrolment alone is not enough: a student who started an enrolment but never paid holds a
 * row with `paymentStatus: "pending"`, and letting that through would give away paid classes.
 * The teacher who owns the session always passes.
 */
export function canAccessSession(m: SessionMembership | null): boolean {
  if (!m) return false;
  if (m.isSessionTeacher) return true;
  return m.isEnrolledStudent && m.hasPaid;
}
