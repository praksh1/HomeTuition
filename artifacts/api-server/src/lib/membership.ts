import { and, eq } from "drizzle-orm";
import { db, sessionsTable, sessionEnrollmentsTable } from "@workspace/db";
import { DOORS_OPEN_MINUTES, canJoin } from "./sessionStart";

/**
 * How early a paid student may enter the classroom.
 *
 * Re-exported rather than defined here: the whole timeline lives in sessionStart.ts, and a
 * class having two ideas about when its doors open is how this project ended up with a socket
 * and a room URL that disagreed about who was allowed in.
 */
export const JOIN_WINDOW_MINUTES = DOORS_OPEN_MINUTES;

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
  /** The booked length in minutes. The whole timeline is measured from these two. */
  duration: number;
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
      duration: sessionsTable.duration,
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
      duration: session.duration,
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
    duration: session.duration,
  };
}

/** True while a paid student may still walk into this class. */
export function joinWindowOpen(m: SessionMembership, now = new Date()): boolean {
  if (!m.scheduledFor) return false;
  return canJoin(
    { date: m.scheduledFor, duration: m.duration, startedAt: null, endedAt: null, status: m.status },
    now.getTime(),
  ).ok;
}

/**
 * May this user actually be in the class?
 *
 * Payment is the hard gate: a student who never paid holds nothing and is refused outright.
 * Timing is the soft gate, and it is now the same timeline everything else reads — the doors
 * open ten minutes before the booked start and shut five minutes after the booked finish.
 *
 * Two things changed here and both were asked for. A student is no longer let in on the
 * strength of the class being marked live, and no longer kept out on the strength of its being
 * marked completed: the clock decides, not the status. That is what "it must remain active for
 * the full duration, allowing students to join even if the teacher is absent" requires — a
 * teacher who never starts the class leaves it "upcoming", and one who ends it early leaves it
 * "completed", and in both cases the student is entitled to be in that room and to be recorded
 * as having been there.
 *
 * The teacher who owns the session still passes at any time, because someone has to be able to
 * open the room; what they may *do* once inside is `canStart`, checked on the room route.
 */
export function canAccessSession(m: SessionMembership | null, now = new Date()): boolean {
  if (!m) return false;
  if (m.isSessionTeacher) return true;
  if (!m.isEnrolledStudent || !m.hasPaid) return false;
  if (m.status === "cancelled") return false;
  return joinWindowOpen(m, now);
}
