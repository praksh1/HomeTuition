import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  refundsTable,
  sessionEnrollmentsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  canDrop,
  canReschedule,
  hasEditsLeft,
  RESCHEDULE_LOCK_HOURS,
  RESCHEDULE_MIN_NOTICE_HOURS,
  SCHEDULE_EDITS_PER_MONTH,
  DROP_DEADLINE_HOURS,
} from "../lib/sessionChanges";
import { alreadyRefunded, lastMovedAt, quoteDrop, scheduleEditsUsed } from "../lib/scheduleChanges";
import { notify } from "../lib/notify";

/**
 * Getting out of a class, and what that costs.
 *
 * Separate from sessions.ts because these are about money leaving rather than a class changing,
 * and because sessions.ts is already the longest file in the server.
 *
 * **Nothing here moves money.** There is no payment provider — see REFUNDS.md — so dropping a
 * class writes down a debt and frees the seat. Every word shown to a student says "requested",
 * never "refunded", because telling somebody their money is back when it is not is the app
 * lying about the one thing it must not lie about.
 */

/**
 * How long a refund takes to reach somebody.
 *
 * One promise, in one place, because every screen that mentions it is talking about the same
 * person's money and they must not be able to disagree. The countdown uses the outer bound: it
 * is better to arrive early than to have told somebody a day that then passes.
 */
export const REFUND_BUSINESS_DAYS_MAX = 7;
export const REFUND_WAIT_PHRASE = "5-7 business days";

/**
 * Business days still to run, counted forward from when the refund was asked for.
 *
 * Walks day by day rather than dividing, because weekends do not count and a refund requested
 * on a Friday is not two days from landing on a Sunday. Zero means the promised window is up —
 * which is the point at which somebody should be chasing it, so it never goes negative and
 * never disappears.
 */
function businessDaysRemaining(requestedAt: Date | string | null, now: number = Date.now()): number {
  if (!requestedAt) return REFUND_BUSINESS_DAYS_MAX;
  const start = new Date(requestedAt);
  if (Number.isNaN(start.getTime())) return REFUND_BUSINESS_DAYS_MAX;

  let elapsed = 0;
  const cursor = new Date(start);
  while (cursor.getTime() < now && elapsed < REFUND_BUSINESS_DAYS_MAX) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) elapsed += 1;
  }
  return Math.max(0, REFUND_BUSINESS_DAYS_MAX - elapsed);
}

const router: IRouter = Router();

function sessionId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(value), 10);
}

/** The enrolment this student holds for this class, if they hold a paid one. */
async function paidEnrolment(id: number, studentId: number) {
  const [row] = await db
    .select({
      id: sessionEnrollmentsTable.id,
      paymentStatus: sessionEnrollmentsTable.paymentStatus,
    })
    .from(sessionEnrollmentsTable)
    .where(
      and(eq(sessionEnrollmentsTable.sessionId, id), eq(sessionEnrollmentsTable.studentId, studentId)),
    );
  return row ?? null;
}

/**
 * What dropping this class would cost, before anybody agrees to it.
 *
 * The number is worked out here rather than in the app because it is the number a person reads
 * immediately before losing money, and two implementations of the same arithmetic will
 * eventually disagree. The app shows what this returns and nothing it worked out itself.
 */
router.get("/sessions/:id/drop-info", requireAuth, async (req, res): Promise<void> => {
  const id = sessionId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const enrolment = await paidEnrolment(id, user.userId);

  /**
   * Somebody who already left, and what happened to their money.
   *
   * Told apart from "never booked", which it otherwise looks exactly like. A student who
   * dropped a class opened its page and found no acknowledgement of any of it — no note that
   * they had left, no amount, no mention of the refund they had been promised — which reads as
   * the app having forgotten, at the point where they are most likely to be checking.
   */
  if (enrolment?.paymentStatus === "refunded") {
    const [refund] = await db
      .select({
        amount: refundsTable.amount,
        status: refundsTable.status,
        requestedAt: refundsTable.requestedAt,
      })
      .from(refundsTable)
      .where(and(eq(refundsTable.sessionId, id), eq(refundsTable.studentId, user.userId)))
      .orderBy(desc(refundsTable.id))
      .limit(1);

    res.json({
      enrolled: false,
      left: true,
      canDrop: false,
      refundAmount: refund?.amount ?? null,
      refundPaid: refund?.status === "paid",
      requestedAt: refund?.requestedAt ? new Date(refund.requestedAt).toISOString() : null,
      /**
       * Business days left, counted from when it was asked for.
       *
       * The owner asked for "the number of days before the refund will be deposited". A
       * countdown is worth more than a policy sentence: five to seven business days means
       * nothing on day six to somebody who cannot remember which day they dropped it.
       *
       * Weekends do not count, so this walks the calendar rather than dividing by 86,400,000.
       */
      businessDaysLeft: refund && refund.status !== "paid"
        ? businessDaysRemaining(refund.requestedAt)
        : null,
      businessDaysTotal: REFUND_BUSINESS_DAYS_MAX,
      headline: "You are no longer in this class.",
      detail: refund
        ? refund.status === "paid"
          ? `A refund of NPR ${refund.amount} has been paid.`
          : `A refund of NPR ${refund.amount} has been requested. Our team processes refunds ` +
            `within ${REFUND_WAIT_PHRASE}.`
        : "If you were expecting a refund and have not had it, report it from Support.",
    });
    return;
  }

  if (!enrolment || enrolment.paymentStatus !== "paid") {
    res.json({ enrolled: false, canDrop: false, reason: "You are not booked into this class." });
    return;
  }

  const allowed = canDrop(session);
  const quote = await quoteDrop(id, session.price);
  const refunded = await alreadyRefunded(id, user.userId);

  res.json({
    enrolled: true,
    canDrop: allowed.ok && !refunded,
    // Why not, when not. Distinct from `refundReason`, which is why the *split* is what it is —
    // conflating the two once cost this response its refusal message entirely.
    reason: refunded ? "A refund has already been recorded for this class." : allowed.ok ? null : allowed.reason,
    deadlineHours: DROP_DEADLINE_HOURS,
    pricePaid: session.price,
    studentRefund: quote.studentRefund,
    teacherShare: quote.teacherShare,
    platformShare: quote.platformShare,
    refundReason: quote.reason,
    full: quote.full,
    known: quote.known,
    /**
     * The exact sentences the app shows. Kept on the server so the promise made to a student
     * about their money is written in one place and cannot drift between web and the phones.
     */
    headline: quote.full
      ? "Your teacher moved this class, so you can drop it and get the whole price back."
      : "Dropping a class you booked returns half of what you paid.",
    detail: quote.full
      ? `NPR ${quote.studentRefund} will be requested for you. Our team processes refunds ` +
        `within ${REFUND_WAIT_PHRASE}.`
      : `NPR ${quote.studentRefund} of the NPR ${session.price} you paid will be requested for ` +
        `you. The rest is a cancellation fee: NPR ${quote.teacherShare} to your teacher, who ` +
        `held the place for you, and NPR ${quote.platformShare} to Sikshya. Refunds are ` +
        `processed within ${REFUND_WAIT_PHRASE}.`,
  });
});

/**
 * Drop a class.
 *
 * Three things happen together or none of them do: the enrolment stops being paid, the seat
 * goes back on sale, and the debt is written down. Half-doing this is how a student ends up
 * with no class and no refund, or a class ends up sold twice.
 */
router.post("/sessions/:id/drop", requireAuth, async (req, res): Promise<void> => {
  const id = sessionId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  if (user.role !== "student") {
    res.status(403).json({ error: "Only students can drop a class." });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const enrolment = await paidEnrolment(id, user.userId);
  if (!enrolment || enrolment.paymentStatus !== "paid") {
    res.status(409).json({ error: "You are not booked into this class." });
    return;
  }

  const allowed = canDrop(session);
  if (!allowed.ok) { res.status(409).json({ error: allowed.reason }); return; }

  if (await alreadyRefunded(id, user.userId)) {
    res.status(409).json({ error: "A refund has already been recorded for this class." });
    return;
  }

  const quote = await quoteDrop(id, session.price);

  const refund = await db.transaction(async (tx) => {
    /**
     * Both halves of freeing the seat, guarded so a double-tap cannot run twice.
     *
     * The `payment_status = 'paid'` condition is the guard: the second request finds nothing to
     * update and the transaction is abandoned before any money is written down. Without it two
     * taps a moment apart would write two refunds and drop the count twice — and the count is
     * what Discover reads to decide whether a class still has room.
     */
    const freed = await tx
      .update(sessionEnrollmentsTable)
      .set({ paymentStatus: "refunded" })
      .where(
        and(
          eq(sessionEnrollmentsTable.id, enrolment.id),
          eq(sessionEnrollmentsTable.paymentStatus, "paid"),
        ),
      )
      .returning({ id: sessionEnrollmentsTable.id });
    if (freed.length === 0) return null;

    // Back on sale. GREATEST keeps a count that has already drifted from going negative,
    // which would read as a class with less than nobody in it.
    await tx
      .update(sessionsTable)
      .set({ enrolledCount: sql`GREATEST(0, ${sessionsTable.enrolledCount} - 1)` })
      .where(eq(sessionsTable.id, id));

    const [row] = await tx
      .insert(refundsTable)
      .values({
        sessionId: id,
        studentId: user.userId,
        pricePaid: session.price,
        amount: quote.studentRefund,
        teacherShare: quote.teacherShare,
        platformShare: quote.platformShare,
        reason: quote.reason,
        status: "owed",
      })
      .returning();
    return row;
  });

  if (!refund) {
    res.status(409).json({ error: "This class has already been dropped." });
    return;
  }

  // The teacher loses a student and a slot they were holding; they should hear it from the app
  // rather than by counting heads on the day.
  const [studentRow] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, user.userId));
  notify(session.teacherId, {
    kind: "session_dropped",
    sessionId: id,
    topic: session.topic,
    fromUserId: user.userId,
    fromName: studentRow?.name ?? "A student",
    at: new Date().toISOString(),
  });

  res.json({
    dropped: true,
    refund: {
      id: refund.id,
      amount: refund.amount,
      reason: refund.reason,
      status: refund.status,
    },
    /**
     * "Requested", never "refunded". Nothing in this codebase can move money yet, and a
     * message claiming otherwise is the app lying to a person about their own money.
     */
    message:
      `You have been removed from "${session.topic}". A refund of NPR ${refund.amount} has been ` +
      `requested. Our team will process it within ${REFUND_WAIT_PHRASE}.`,
  });
});

/**
 * What a teacher may still do to this class, and how much of the month's allowance is left.
 *
 * The edit screen needs all of it before the teacher types anything: showing the form and then
 * refusing the save is the sort of thing that reads as the app being broken.
 */
router.get("/sessions/:id/schedule-info", requireAuth, async (req, res): Promise<void> => {
  const id = sessionId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.teacherId !== user.userId) {
    res.status(403).json({ error: "You can only edit your own classes." });
    return;
  }

  const used = await scheduleEditsUsed(user.userId);
  const room = canReschedule(session);
  const quota = used === null ? { ok: true as const } : hasEditsLeft(used);
  const moved = await lastMovedAt(id);

  res.json({
    canMove: room.ok && quota.ok,
    reason: !room.ok ? room.reason : !quota.ok ? quota.reason : null,
    // Null rather than a guess: an unknown count must not be drawn as "5 left".
    editsUsed: used,
    editsAllowed: SCHEDULE_EDITS_PER_MONTH,
    editsLeft: used === null ? null : Math.max(0, SCHEDULE_EDITS_PER_MONTH - used),
    lockHours: RESCHEDULE_LOCK_HOURS,
    minNoticeHours: RESCHEDULE_MIN_NOTICE_HOURS,
    lastMovedAt: moved ? moved.toISOString() : null,
    /** How many people a change would disrupt, which is the thing worth knowing before making one. */
    paidStudents: session.enrolledCount,
    priceLocked: session.enrolledCount > 0,
  });
});

export default router;
