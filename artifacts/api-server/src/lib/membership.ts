import { and, eq } from "drizzle-orm";
import { db, sessionsTable, sessionEnrollmentsTable } from "@workspace/db";
import { DOORS_OPEN_MINUTES, canJoin } from "./sessionStart";
import { admitsTestEnrolment } from "./testStudentAccess";

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
  /**
   * True while the user actually holds a place in this class.
   *
   * It used to mean "an enrolment row exists", which is not the same thing and caused a real
   * bug: dropping a class leaves the row behind marked `refunded`, so the student's screen went
   * on saying "Booked & paid" for a class they had left. Refreshing sometimes cleared it — only
   * because the check had failed and the screen fell back to offering the booking — and signing
   * back in showed "Book" for a moment before it flipped back.
   *
   * Somebody who has left is `wasRefunded`, which is what the read-only access to the thread and
   * the attendance record hangs off.
   */
  isEnrolledStudent: boolean;
  /** True once that enrolment has been paid for. Free sessions count as paid. */
  hasPaid: boolean;
  /**
   * True when this student paid and then got their money back — they dropped the class, or an
   * agent refunded them. They are no longer in the class, but they were, and what was said in
   * it is often the evidence for why they are not.
   */
  wasRefunded: boolean;
  /**
   * True when this place was granted by an operator for testing rather than bought.
   *
   * Callers that show money, count revenue or record a debt must branch on it. Callers that ask
   * "may this person be in this room" can ignore it entirely — that is what `hasPaid` already
   * answers, and a test place is a real place for as long as it lasts.
   */
  viaTestAccess: boolean;
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
      wasRefunded: false,
      viaTestAccess: false,
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

  /**
   * An operator-granted test enrolment holds a real place in the class — while it is allowed to.
   *
   * `admitsTestEnrolment` is false unless `ALLOW_TEST_STUDENT_ACCESS` is on, and it is only ever
   * asked about a row that is already `test`; a `paid` row never reaches it. So turning the switch
   * off closes this door and cannot touch the paid one.
   *
   * It is answered **here**, in the one function both doors share, and nowhere else. The video
   * room route and the WebSocket already agree because they both call this — see the comment on
   * `getSessionMembership`. A second `payment_status = 'test'` check written into either of them
   * is exactly the drift that let an unenrolled student watch a teacher's video.
   */
  const viaTestAccess = admitsTestEnrolment(enrollment?.paymentStatus);

  // A free class has nothing to pay, so enrolling in one is already "paid".
  const hasPaid = !!enrollment && (session.price <= 0 || enrollment.paymentStatus === "paid" || viaTestAccess);

  /**
   * A `test` row with the switch off is treated as no row at all.
   *
   * Not as a refund — they were never refunded anything, and `wasRefunded` is what read access to
   * the class thread and the attendance record hangs off. Closed means closed.
   */
  const dormantTestRow = enrollment?.paymentStatus === "test" && !viaTestAccess;

  return {
    isSessionTeacher: false,
    isEnrolledStudent: !!enrollment && enrollment.paymentStatus !== "refunded" && !dormantTestRow,
    hasPaid,
    wasRefunded: enrollment?.paymentStatus === "refunded",
    viaTestAccess,
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
  return accessRefusalFor(m, now) === null;
}

/**
 * Why somebody may not be in the class — or null, meaning they may.
 *
 * `canAccessSession` used to be the whole answer, and it collapsed four different situations into
 * one `false`. The room route turned that into a single sentence: **"You must be enrolled in this
 * session to join it."**
 *
 * For a student who opens their booked class the evening before, that sentence is not merely
 * unhelpful, it is **false** — they are enrolled, they have paid, and the only thing wrong is the
 * clock. This project has fixed that shape of bug before, when a dropped student's screen went on
 * saying "Booked & paid"; a paid student being told they are not enrolled is the same wound the
 * other way round.
 *
 * So the rule is written once, here, and returns *which* refusal it is. `canAccessSession` is
 * defined in terms of it, so the WebSocket and the room route cannot start disagreeing about who
 * gets in — the thing this file exists to prevent. Only the *wording* differs between them.
 */
export type AccessRefusal = "not-enrolled" | "unpaid" | "cancelled" | "outside-window";

export function accessRefusalFor(
  m: SessionMembership | null,
  now = new Date(),
): AccessRefusal | null {
  if (!m) return "not-enrolled";
  // Someone has to be able to open the room. What the teacher may *do* once inside is `canStart`.
  if (m.isSessionTeacher) return null;
  if (!m.isEnrolledStudent) return "not-enrolled";
  if (!m.hasPaid) return "unpaid";
  if (m.status === "cancelled") return "cancelled";
  return joinWindowOpen(m, now) ? null : "outside-window";
}
