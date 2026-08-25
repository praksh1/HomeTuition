import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  disputeReasonEnum,
  disputesTable,
  sessionActivityTable,
  sessionEnrollmentsTable,
  sessionsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getSessionMembership } from "../lib/membership";
import { verifyUpload } from "../lib/fileStore";
import { endedEarlyWithoutReturning } from "../lib/sessionEvidence";
import { MAX_TICKETS_PER_DAY, isTerminal, ticketRef } from "../lib/tickets";
import {
  allowanceFor,
  describeTicket,
  historyFor,
  moveTicket,
  nameOf,
  recordOpened,
} from "../lib/ticketStore";

const router: IRouter = Router();

const VALID_REASONS = new Set<string>(disputeReasonEnum.enumValues);

/**
 * How far back the support form offers classes to report.
 *
 * Matches the refund window in REFUNDS.md: past seven days there is nothing left to ask for,
 * and a dropdown listing every lesson somebody ever attended is one nobody can find theirs in.
 */
const REPORTABLE_WINDOW_DAYS = 7;

router.post("/disputes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { reason, description, evidenceUrl, sessionId } = req.body as {
    reason?: string; description?: string; evidenceUrl?: string | null; sessionId?: number;
  };

  if (!reason || !VALID_REASONS.has(reason)) {
    res.status(400).json({ error: `reason must be one of: ${[...VALID_REASONS].join(", ")}` });
    return;
  }
  if (!description || !description.trim()) {
    res.status(400).json({ error: "description is required" });
    return;
  }

  /**
   * Three a day, and then a wait.
   *
   * The owner asked for this having watched the app take several hundred requests from one
   * person without ever telling them what happened to any of them. Both halves of that are
   * being fixed: the history below gives an answer to look at, and this stops the pile
   * growing faster than anybody can answer it.
   *
   * It counts a rolling twenty-four hours rather than a calendar day, so the limit cannot be
   * doubled by filing three before midnight and three after. Nothing has been written at this
   * point, so a refused request costs the reporter nothing but the wait.
   */
  const allowance = await allowanceFor(userId);
  if (!allowance.ok) {
    res.status(429).json({
      error: allowance.reason,
      used: allowance.used,
      limit: MAX_TICKETS_PER_DAY,
      remaining: 0,
      nextAllowedAt: allowance.nextAllowedAt,
    });
    return;
  }

  /**
   * A report may name the class it is about, and then it must be a class the reporter was
   * actually part of.
   *
   * Without this check anybody could file a complaint against any class in the system, and
   * that complaint would be read against that class's attendance record — somebody else's
   * lesson, somebody else's teacher, and a reviewer with no way to see that the person
   * complaining was never there.
   */
  let about: number | null = null;
  if (sessionId !== undefined && sessionId !== null) {
    const id = Number(sessionId);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "sessionId must be a number" });
      return;
    }
    /**
     * A place in the class, including one they used to have.
     *
     * A refunded student is the person most likely to need this: they dropped a class or an
     * agent refunded them, and now the money has not arrived. Refusing them here would leave
     * the only complaint they have no way to attach to the class it is about.
     */
    const membership = await getSessionMembership(id, userId);
    if (!membership || (!membership.isSessionTeacher && !membership.hasPaid && !membership.wasRefunded)) {
      res.status(403).json({ error: "You can only report a class you took part in." });
      return;
    }
    about = id;
  }

  /**
   * A file is welcome and never required.
   *
   * It used to be mandatory, and that was wrong twice over. It locked out the person it should
   * have served most — a student whose teacher never arrived has nothing to photograph — and,
   * worse, uploading has never actually worked: the app asked for an upload URL with the wrong
   * field names and every attempt came back 400 before a byte left the phone, and the endpoint
   * behind it still wants object-storage settings left over from this app's Replit origins,
   * which do not exist on the server it runs on now. A mandatory attachment on top of a broken
   * uploader is a complaints box that quietly refuses complaints.
   *
   * A report that names a class needs no photograph anyway: the server's own record of who was
   * in that room and when is better evidence, and neither side can edit it.
   */
  const evidence = typeof evidenceUrl === "string" ? evidenceUrl.trim() : "";

  /**
   * A file only becomes evidence once we have looked at what actually landed.
   *
   * Everything the client said when it asked for the upload link was a claim. This reads the
   * object in the bucket: who it belongs to, how big it really is, what type it really is. A
   * file that fails is deleted rather than left sitting in the bucket costing money.
   *
   * A bad attachment does **not** sink the report. The words are the complaint; the photo is
   * a help. Somebody whose upload went wrong still gets their case filed, and is told the
   * attachment did not make it — losing both would be the worst outcome for the person least
   * able to do anything about it.
   */
  let attachment: string | null = null;
  let attachmentProblem: string | null = null;
  if (evidence) {
    const verdict = await verifyUpload(evidence, userId);
    if (verdict.ok) {
      attachment = evidence;
    } else {
      attachmentProblem = verdict.reason;
      req.log.warn({ userId, key: evidence, reason: verdict.reason }, "an attachment was refused");
    }
  }

  const [dispute] = await db.insert(disputesTable).values({
    userId,
    sessionId: about,
    reason: reason as typeof disputeReasonEnum.enumValues[number],
    description: description.trim(),
    evidenceUrl: attachment,
  }).returning();

  /**
   * The history starts where the request does.
   *
   * Without this first entry a ticket's trail begins at whatever an agent did to it, which
   * reads as though nothing happened until somebody looked — the exact impression the
   * reporter already has and this is meant to correct.
   */
  await recordOpened(dispute!.id, userId, req.user!.role, await nameOf(userId));

  // The problem travels with the reply, so the app can say the report went and the photo did not.
  res.status(201).json({
    ...dispute,
    /** The number they quote when they ask about it. */
    ref: ticketRef(dispute!.id),
    attachmentProblem,
    remaining: allowance.remaining - 1,
  });
});

/**
 * The classes this person could be reporting about.
 *
 * Fills the "Session" dropdown on the support form, which the owner asked for: "Add a
 * 'Session' dropdown showing the user's enrolled sessions from the past 7 days, plus a 'Not
 * session related' option." Seven days because that is the refund window in REFUNDS.md — past
 * it there is nothing to ask for, and a list of everything you ever attended is not a list
 * anybody can find their lesson in.
 *
 * Works for both roles. A teacher's classes are their own; a student's are the ones they paid
 * for. Each row carries whether it looks like the one refund case the app can recognise on its
 * own, so the form can lead with it rather than making somebody explain from scratch.
 */
router.get("/support/sessions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const since = new Date(Date.now() - REPORTABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const mine = await db
      .select({
        id: sessionsTable.id,
        topic: sessionsTable.topic,
        subject: sessionsTable.subject,
        date: sessionsTable.date,
        duration: sessionsTable.duration,
        status: sessionsTable.status,
        teacherId: sessionsTable.teacherId,
        teacherName: sessionsTable.teacherName,
        endedAt: sessionActivityTable.endedAt,
      })
      .from(sessionsTable)
      // Left join: a class that never ran has no activity row, and it is exactly the class
      // somebody wants to complain about.
      .leftJoin(sessionActivityTable, eq(sessionActivityTable.sessionId, sessionsTable.id))
      .leftJoin(
        sessionEnrollmentsTable,
        and(
          eq(sessionEnrollmentsTable.sessionId, sessionsTable.id),
          eq(sessionEnrollmentsTable.studentId, userId),
          // `refunded` too, for the same reason the filing check above accepts it: a refund
          // that never arrived is a complaint about a specific class, and without this the
          // class disappears from the dropdown at the moment it becomes worth reporting.
          inArray(sessionEnrollmentsTable.paymentStatus, ["paid", "refunded"]),
        ),
      )
      .where(
        and(
          gte(sessionsTable.date, since),
          or(eq(sessionsTable.teacherId, userId), isNotNull(sessionEnrollmentsTable.id)),
        ),
      )
      .orderBy(desc(sessionsTable.date))
      .limit(50);

    const now = Date.now();
    res.json({
      sessions: mine.map((session) => ({
        id: session.id,
        topic: session.topic,
        subject: session.subject,
        date: session.date,
        status: session.status,
        teacherName: session.teacherName,
        yourRole: session.teacherId === userId ? "teacher" : "student",
        /**
         * The one refund case the app can recognise without a person reading anything: the
         * teacher ended the call early and never came back before the class was due to
         * finish. Offered as a starting point, never as a verdict — see REFUNDS.md.
         */
        endedEarly: endedEarlyWithoutReturning(
          { date: session.date, duration: session.duration, startedAt: null, endedAt: session.endedAt },
          now,
        ),
      })),
      known: true,
    });
  } catch (err) {
    req.log.warn({ err, userId }, "could not list reportable sessions");
    // Told apart from "you have no recent classes", so the form can say which it is rather
    // than showing an empty dropdown that reads as "you attended nothing".
    res.status(503).json({ sessions: [], known: false });
  }
});

/**
 * Everything this person has reported, and whether they may report anything else.
 *
 * The allowance travels with the list on purpose. A limit somebody only meets at the moment
 * they are refused is a limit that reads as a fault; shown alongside their own requests it
 * reads as what it is.
 */
router.get("/disputes/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const rows = await db.select().from(disputesTable)
    .where(eq(disputesTable.userId, userId))
    .orderBy(desc(disputesTable.createdAt));

  const allowance = await allowanceFor(userId);
  res.json({
    tickets: rows.map(describeTicket),
    allowance: {
      used: allowance.used,
      limit: MAX_TICKETS_PER_DAY,
      remaining: allowance.remaining,
      nextAllowedAt: allowance.nextAllowedAt,
      reason: allowance.reason,
    },
  });
});

/**
 * One request, and what has happened to it.
 *
 * Only the person who reported it may read it. An agent reading the same ticket goes through
 * /admin/tickets/:id, which carries the evidence and the internal notes this deliberately
 * leaves out.
 */
router.get("/disputes/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid request id" }); return; }

  const [row] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
  // A stranger and a missing ticket get the same answer, so the endpoint cannot be used to
  // count how many requests other people have filed.
  if (!row || row.userId !== req.user!.userId) {
    res.status(404).json({ error: "That request was not found." });
    return;
  }

  res.json({
    ticket: describeTicket(row),
    history: await historyFor(id, false),
    canCancel: !isTerminal(row.status),
  });
});

/**
 * Withdrawing a request.
 *
 * Somebody who solved their own problem, or filed twice by accident, should be able to take it
 * back rather than wait for an agent to close it — and taking it back frees up one of their
 * three, which is the difference between a limit and a trap.
 */
router.post("/disputes/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid request id" }); return; }

  const [row] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
  if (!row || row.userId !== req.user!.userId) {
    res.status(404).json({ error: "That request was not found." });
    return;
  }

  const { note } = req.body as { note?: string };
  const moved = await moveTicket({
    ticketId: id,
    to: "cancelled",
    actorId: req.user!.userId,
    actorRole: req.user!.role === "teacher" ? "teacher" : "student",
    actorName: await nameOf(req.user!.userId),
    note: typeof note === "string" ? note : null,
  });

  if (!moved.ok) { res.status(moved.status).json({ error: moved.reason }); return; }

  res.json({
    ticket: describeTicket(moved.ticket),
    history: await historyFor(id, false),
    canCancel: false,
  });
});

export default router;
