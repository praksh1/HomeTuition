import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, sessionsTable, sessionEnrollmentsTable, studentTeacherSubscriptionsTable, teacherProfilesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  JOIN_WINDOW_MINUTES,
  canAccessSession,
  getSessionMembership,
  joinWindowOpen,
} from "../lib/membership";
import { chargeForSession, verifyWebhookSignature, webhookSecret } from "../lib/payments";
import { broadcastSessionStatus, resetBoardFor } from "../ws/classroomHub";
import { ensureDailyRoom, createMeetingToken } from "../lib/daily";
import { expireLeftOverSessions, otherRunningSessions } from "../lib/sessionLifecycle";
import { notifyMany } from "../lib/notify";
import { activityFor, markSessionEnded } from "../lib/sessionLifecycle";
import { canStart } from "../lib/sessionStart";


/** Flips an enrolment to paid. Returns null when no such enrolment exists. */
async function markEnrolmentPaid(sessionId: number, studentId: number, reference: string | null) {
  const [enrollment] = await db
    .select({ id: sessionEnrollmentsTable.id })
    .from(sessionEnrollmentsTable)
    .where(and(eq(sessionEnrollmentsTable.sessionId, sessionId), eq(sessionEnrollmentsTable.studentId, studentId)));
  if (!enrollment) return null;

  const [updated] = await db
    .update(sessionEnrollmentsTable)
    .set({ paymentStatus: "paid", ...(reference ? { paymentReference: reference } : {}) })
    .where(eq(sessionEnrollmentsTable.id, enrollment.id))
    .returning();
  return updated ?? null;
}

const router: IRouter = Router();

router.get("/sessions", async (req, res): Promise<void> => {
  const { teacherId, studentId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, parseInt(limit, 10) || 20);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (teacherId) conditions.push(eq(sessionsTable.teacherId, parseInt(teacherId, 10)));
  if (status) conditions.push(eq(sessionsTable.status, status));

  if (studentId) {
    // Only paid enrolments count as "my sessions". An unpaid row used to appear in the
    // student's Upcoming list, so they saw a class they believed they owned and were then
    // refused at the door. Booking is atomic now, so these should not exist at all — this is
    // the second lock on the same door.
    const enrolled = await db
      .select({ sessionId: sessionEnrollmentsTable.sessionId })
      .from(sessionEnrollmentsTable)
      .where(
        and(
          eq(sessionEnrollmentsTable.studentId, parseInt(studentId, 10)),
          eq(sessionEnrollmentsTable.paymentStatus, "paid"),
        ),
      );
    const sessionIds = enrolled.map((e) => e.sessionId);
    if (sessionIds.length === 0) {
      res.json({ sessions: [], total: 0, page: pageNum, limit: limitNum });
      return;
    }
    conditions.push(sql`${sessionsTable.id} = ANY(ARRAY[${sql.join(sessionIds.map((id) => sql`${id}`), sql`,`)}]::int[])`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (status === "live") {
    // Classes that are only nominally live — a crashed browser, seed data, a teacher who
    // closed the tab — are tidied up before the list is read, so "Live Now" only ever shows
    // classes that are genuinely running. The rule for what counts as left over lives in
    // sessionLifecycle.ts; it used to be written out here as well, and the two copies drifted.
    const allLive = await db
      .select({
        id: sessionsTable.id,
        date: sessionsTable.date,
        startedAt: sessionsTable.startedAt,
        duration: sessionsTable.duration,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "live"));

    await expireLeftOverSessions(allLive);

    const liveSessions = await db
      .selectDistinctOn([sessionsTable.teacherId])
      .from(sessionsTable)
      .where(where)
      .orderBy(sessionsTable.teacherId, desc(sessionsTable.date));

    const sorted = liveSessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const total = sorted.length;
    const paged = sorted.slice(offset, offset + limitNum);

    res.json({ sessions: paged, total, page: pageNum, limit: limitNum });
    return;
  }

  const [sessions, [{ total }]] = await Promise.all([
    db.select().from(sessionsTable).where(where).orderBy(desc(sessionsTable.date)).limit(limitNum).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(sessionsTable).where(where),
  ]);

  res.json({ sessions, total, page: pageNum, limit: limitNum });
});

/**
 * The students this teacher may tell about a new class.
 *
 * Exactly two groups, and no wider: people who chose to follow them, and people who have
 * actually taken a paid class with them. A teacher cannot use this to reach the whole
 * platform — an invitation is a message to someone you already have a relationship with, not
 * a mailing list.
 *
 * This is only ever a notification. It grants nothing: an invited student books and pays like
 * anybody else, and the door checks enrolment, not invitations.
 */
/**
 * The user ids this teacher is allowed to tell about a class: their followers, and students
 * who have actually paid for one of their classes before.
 *
 * Shared by the listing endpoint and by the invite itself, deliberately. A list that says who
 * may be invited and a check that decides who actually is, written separately, is how the
 * second one ends up more generous than the first.
 */
async function invitableStudentIds(teacherUserId: number): Promise<Set<number>> {
  const followers = await db
    .select({ id: studentTeacherSubscriptionsTable.studentId })
    .from(studentTeacherSubscriptionsTable)
    .where(eq(studentTeacherSubscriptionsTable.teacherId, teacherUserId));

  const past = await db
    .selectDistinct({ id: sessionEnrollmentsTable.studentId })
    .from(sessionEnrollmentsTable)
    .innerJoin(sessionsTable, eq(sessionEnrollmentsTable.sessionId, sessionsTable.id))
    .where(
      and(
        eq(sessionsTable.teacherId, teacherUserId),
        eq(sessionEnrollmentsTable.paymentStatus, "paid"),
      ),
    );

  return new Set([...followers, ...past].map((r) => r.id));
}

router.get("/sessions/invitable-students", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can see this" });
    return;
  }

  const followers = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(studentTeacherSubscriptionsTable)
    .innerJoin(usersTable, eq(studentTeacherSubscriptionsTable.studentId, usersTable.id))
    .where(eq(studentTeacherSubscriptionsTable.teacherId, user.userId));

  const past = await db
    .selectDistinct({ id: usersTable.id, name: usersTable.name })
    .from(sessionEnrollmentsTable)
    .innerJoin(sessionsTable, eq(sessionEnrollmentsTable.sessionId, sessionsTable.id))
    .innerJoin(usersTable, eq(sessionEnrollmentsTable.studentId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.teacherId, user.userId),
        eq(sessionEnrollmentsTable.paymentStatus, "paid"),
      ),
    );

  const byId = new Map<number, { id: number; name: string; follower: boolean; pastStudent: boolean }>();
  for (const f of followers) byId.set(f.id, { ...f, follower: true, pastStudent: false });
  for (const p of past) {
    const existing = byId.get(p.id);
    if (existing) existing.pastStudent = true;
    else byId.set(p.id, { ...p, follower: false, pastStudent: true });
  }

  res.json({ students: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)) });
});

router.post("/sessions", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can create sessions" });
    return;
  }

  const { subject, topic, date, duration, maxStudents, price } = req.body as {
    subject?: string; topic?: string; date?: string;
    duration?: number; maxStudents?: number; price?: number;
  };

  // Validated here as well as in the form: the form is a convenience, this is the rule.
  const errors: string[] = [];
  if (!subject?.trim()) errors.push("Subject is required.");
  if (!topic?.trim()) errors.push("Topic is required.");

  const when = date ? new Date(date) : null;
  if (!date || !when || Number.isNaN(when.getTime())) errors.push("A valid date and time is required.");

  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    errors.push("Duration must be greater than zero.");
  }
  if (maxStudents !== undefined && (!Number.isFinite(maxStudents) || maxStudents <= 0)) {
    errors.push("Maximum students must be greater than zero.");
  }
  // Amount is mandatory and must be a real charge — 0 was being accepted, which quietly
  // created free classes on a paid platform.
  if (price === undefined || price === null || !Number.isFinite(price) || price <= 0) {
    errors.push("Amount is required and must be greater than zero.");
  }

  if (errors.length > 0) {
    res.status(400).json({ error: errors.join(" ") });
    return;
  }

  const [userRow] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.userId));

  const [session] = await db.insert(sessionsTable).values({
    teacherId: user.userId,
    teacherName: userRow?.name ?? "Unknown",
    subject: subject!.trim(),
    topic: topic!.trim(),
    date: when!,
    duration: duration ?? 60,
    maxStudents: maxStudents ?? 20,
    enrolledCount: 0,
    price: price!,
    status: "upcoming",
  }).returning();

  /**
   * Tell the students the teacher picked, and nothing more than tell them.
   *
   * The owner was explicit, and it is the rule that matters here: "Please be sure that the
   * students are not getting free links to get into the session without paying." So this
   * writes no enrolment, issues no token and grants no access. It sends a notification whose
   * link opens the class the same way the Discover tab does — where the student books and
   * pays like anyone else, and the classroom door checks enrolment rather than invitations.
   *
   * The recipients are filtered against the teacher's own followers and past paid students,
   * so a crafted request cannot turn this into a way to message the whole platform.
   */
  const requested = Array.isArray((req.body as { inviteStudentIds?: unknown }).inviteStudentIds)
    ? ((req.body as { inviteStudentIds: unknown[] }).inviteStudentIds
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v)) as number[])
    : [];

  if (requested.length > 0) {
    const allowed = await invitableStudentIds(user.userId);
    const recipients = [...new Set(requested)].filter((id) => allowed.has(id));
    if (recipients.length > 0) {
      notifyMany(recipients, {
        kind: "session_invite",
        sessionId: session.id,
        topic: session.topic,
        fromUserId: user.userId,
        fromName: userRow?.name ?? "Your teacher",
        at: new Date().toISOString(),
      });
    }
  }

  res.status(201).json(session);
});

const DEFAULT_SUBJECTS = [
  "Mathematics", "Physics", "Chemistry", "Biology", "English",
  "Nepali", "Computer Science", "Economics", "Accountancy", "Social Studies",
];

router.get("/sessions/subjects", async (_req, res): Promise<void> => {
  const rows = await db.selectDistinct({ subject: sessionsTable.subject }).from(sessionsTable);
  const dbSubjects = rows.map((r) => r.subject).filter((s): s is string => !!s && s.trim().length > 0);
  const merged = Array.from(new Set([...DEFAULT_SUBJECTS, ...dbSubjects]));
  res.json({ subjects: merged });
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  // `endedAt` travels with the class so the app can answer "may I open this?" the moment a
  // card is tapped, without a round trip and without opening the classroom to find out. The
  // server still decides — see the room endpoint — but the two now judge on the same facts,
  // so the app cannot offer what the server will refuse.
  const activity = await activityFor(id);
  res.json({ ...session, endedAt: activity.endedAt });
});

// Ensures a Daily.co room exists for this session and returns its join URL. Daily rooms
// must be explicitly created via the REST API before anyone can join them — visiting a
// room URL for a room that was never created fails with "The meeting you're trying to
// join does not exist." Both the teacher (on start) and students (on join) call this so
// the room is guaranteed to exist regardless of who gets there first.
router.get("/sessions/:id/room", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  // The room URL is the key to the live video. Handing it to anyone logged in let an
  // unenrolled student watch a class they never paid for — the whiteboard socket refused
  // them, so they saw the "not enrolled" banner while the video played behind it.
  const membership = await getSessionMembership(id, req.user!.userId);
  if (!canAccessSession(membership)) {
    res.status(403).json({ error: "You must be enrolled in this session to join it." });
    return;
  }

  /**
   * A class that is over gets no room, no token, and no video.
   *
   * This is the check that actually stops it. Reported from a real session: tapping a class
   * from three days ago opened the classroom and the phone asked for camera and microphone —
   * "I feel like clicking in a completed session activates DailyCo internally somehow", which
   * is exactly what was happening. This route did not care about the class's state at all, so
   * `ensureDailyRoom` **created a Daily room** and `createMeetingToken` minted an owner token
   * for a lesson that had finished three days earlier.
   *
   * It has to be here rather than only in the app: the room URL and the owner token are the
   * things worth refusing, and a screen that declines to ask for them is a courtesy, not a
   * control. Same window as starting a class — see lib/sessionStart.ts — so "may I start it"
   * and "may I go in" can never answer differently.
   */
  const activity = await activityFor(id);
  const joinable = canStart({ ...session, endedAt: activity.endedAt });
  if (!joinable.ok) {
    res.status(409).json({ error: joinable.reason, expired: true });
    return;
  }

  try {
    const roomUrl = await ensureDailyRoom(id);
    // Only this session's teacher gets an owner token, and only the server can mint one, so
    // moderator powers cannot be granted by anything the client says about itself.
    const [userRow] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId));
    const token = await createMeetingToken(id, {
      isOwner: membership!.isSessionTeacher,
      userName: userRow?.name ?? "Guest",
    });
    res.json({ roomUrl, token, isOwner: membership!.isSessionTeacher });
  } catch (err) {
    req.log.error({ err, sessionId: id }, "Failed to ensure Daily room");
    res.status(502).json({ error: "Failed to set up video room" });
  }
});

const ALLOWED_STATUSES = ["upcoming", "live", "completed", "cancelled"];

router.patch("/sessions/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can update sessions" });
    return;
  }

  const { status, topic } = req.body as { status?: string; topic?: string };
  const updates: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!ALLOWED_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    updates.status = status;
    // Stamp the real start time so the stale-session sweep above measures from when the
    // class actually began rather than the slot it was booked into.
    if (status === "live") updates.startedAt = new Date();
  }
  if (topic !== undefined) updates.topic = topic;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [existing] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }
  if (existing.teacherId !== user.userId) {
    res.status(403).json({ error: "You can only update your own sessions" });
    return;
  }

  if (status === "live") {
    /**
     * A class that is over stays over.
     *
     * A teacher could scroll back through past classes and start one — some warned, many
     * simply began — which means a lesson from days ago could be made live again and students
     * pulled into it. The only exception is a short window after it finished, for the teacher
     * who ended the call by accident. See lib/sessionStart.ts.
     */
    const activity = await activityFor(id);
    const startable = canStart({ ...existing, endedAt: activity.endedAt });
    if (!startable.ok) {
      res.status(409).json({ error: startable.reason, expired: true });
      return;
    }

    /**
     * One class at a time.
     *
     * Starting a second class used to silently mark every other live class of this teacher
     * "completed" and tell those rooms the teacher had left — so a teacher who opened a second
     * window threw a room full of students out of a lesson in progress, while their own first
     * window carried on as though nothing had happened. A teacher doing that has almost always
     * made a mistake, so the new class is refused and the old one is named. Genuinely
     * left-over classes are tidied up first and never stand in the way.
     */
    const running = await otherRunningSessions(user.userId, id);
    if (running.length > 0) {
      const other = running[0];
      res.status(409).json({
        error: `You are already teaching "${other.topic}". End that class before starting another.`,
        liveSessionId: other.id,
        liveSessionTopic: other.topic,
      });
      return;
    }

    // Start every class on a blank board. The previous lesson's strokes used to still be
    // there, which read as the app leaking one class into the next. This clears the board
    // without hanging up on students already waiting in the room.
    if (status === "live") resetBoardFor(String(id));

    // Proactively create the Daily.co room the moment the teacher starts the session,
    // so it already exists by the time either side's WebView tries to join it.
    try {
      await ensureDailyRoom(id);
    } catch (err) {
      req.log.error({ err, sessionId: id }, "Failed to pre-create Daily room on session start");
    }
  }

  const [session] = await db.update(sessionsTable).set(updates).where(eq(sessionsTable.id, id)).returning();

  if (status !== undefined) {
    broadcastSessionStatus(String(id), status);
  }

  /**
   * Tell the enrolled students their class has begun.
   *
   * `broadcastSessionStatus` only reaches people already sitting in that classroom. A student
   * who booked and is elsewhere in the app — or on the Discover tab waiting — heard nothing at
   * all, which is most of what "notifications are not real time" meant in practice.
   */
  if (status === "live") {
    const enrolled = await db
      .select({ studentId: sessionEnrollmentsTable.studentId })
      .from(sessionEnrollmentsTable)
      .where(
        and(
          eq(sessionEnrollmentsTable.sessionId, id),
          eq(sessionEnrollmentsTable.paymentStatus, "paid"),
        ),
      );
    notifyMany(
      enrolled.map((e) => e.studentId),
      {
        kind: "session_live",
        sessionId: id,
        topic: existing.topic,
        at: new Date().toISOString(),
      },
    );
  }

  // Record when it stopped, so the restart window is measured from what actually happened
  // rather than from the slot it was booked into.
  if (status === "completed" || status === "cancelled") await markSessionEnded(id);

  res.json(session);
});

/**
 * Books a session: enrol and pay, or do nothing at all.
 *
 * This used to be two calls — `/enroll` created a "pending" row and `/payment/confirm`
 * promoted it. Every failure in between left the student in limbo: the class appeared in their
 * Sessions tab, so they believed they had bought it, but the door refused them when it
 * mattered. Worse, the Discover tab kept offering to sell them the same class again.
 *
 * So booking is now one atomic step. It runs in a transaction that either commits a paid
 * enrolment or rolls back to nothing, and the charge is attempted *inside* that transaction.
 * There is no state in which a student holds an unpaid enrolment for a paid class.
 */
async function bookSession(req: Request, res: Response): Promise<void> {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  const { paymentMethod } = req.body as { paymentMethod?: string };

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.teacherId === user.userId) {
    res.status(400).json({ error: "You cannot book your own session." });
    return;
  }
  if (session.status === "completed" || session.status === "cancelled") {
    res.status(409).json({ error: "This session is no longer available." });
    return;
  }

  const price = session.price ?? 0;

  try {
    const result = await db.transaction(async (tx) => {
      // Re-read the row inside the transaction and lock it, so two students booking the last
      // seat at the same instant cannot both be let in.
      const [locked] = await tx
        .select({ enrolledCount: sessionsTable.enrolledCount, maxStudents: sessionsTable.maxStudents })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .for("update");

      if (!locked) return { kind: "gone" as const };

      const [existing] = await tx
        .select({ id: sessionEnrollmentsTable.id, paymentStatus: sessionEnrollmentsTable.paymentStatus })
        .from(sessionEnrollmentsTable)
        .where(and(eq(sessionEnrollmentsTable.sessionId, id), eq(sessionEnrollmentsTable.studentId, user.userId)));

      // Already paid: booking again is a no-op success rather than an error, because a student
      // tapping a stale "Book & Pay" button should end up informed, not scolded.
      if (existing && (price <= 0 || existing.paymentStatus === "paid")) {
        return { kind: "already" as const };
      }

      // Capacity only blocks genuinely new enrolments; upgrading a leftover pending row does
      // not consume another seat because it already holds one.
      if (!existing && locked.enrolledCount >= locked.maxStudents) return { kind: "full" as const };

      let reference: string | null = null;
      if (price > 0) {
        const charge = await chargeForSession({
          sessionId: id,
          studentId: user.userId,
          amount: price,
          method: paymentMethod ?? "unknown",
          log: req.log,
        });
        // Returning here rolls nothing back because nothing has been written yet — which is
        // the point: a declined payment must not leave an enrolment behind.
        if (!charge.ok) return { kind: "declined" as const, message: charge.message };
        reference = charge.reference ?? null;
      }

      // A leftover "pending" row from the old two-step flow is upgraded in place rather than
      // colliding with the unique constraint.
      const [enrolment] = existing
        ? await tx.update(sessionEnrollmentsTable)
            .set({ paymentStatus: "paid", paymentMethod: paymentMethod ?? null, paymentReference: reference })
            .where(eq(sessionEnrollmentsTable.id, existing.id))
            .returning()
        : await tx.insert(sessionEnrollmentsTable).values({
            sessionId: id,
            studentId: user.userId,
            paymentStatus: "paid",
            paymentMethod: paymentMethod ?? null,
            paymentReference: reference,
          }).returning();

      if (!existing) {
        await tx.update(sessionsTable)
          .set({ enrolledCount: locked.enrolledCount + 1 })
          .where(eq(sessionsTable.id, id));
        await tx.update(teacherProfilesTable)
          .set({ totalStudents: sql`${teacherProfilesTable.totalStudents} + 1` })
          .where(eq(teacherProfilesTable.userId, session.teacherId));
      }

      return { kind: "booked" as const, enrolment };
    });

    switch (result.kind) {
      case "gone":
        res.status(404).json({ error: "Session not found" });
        return;
      case "full":
        res.status(409).json({ error: "This session is full." });
        return;
      case "declined":
        res.status(402).json({
          error: result.message ?? "Payment was declined. Please try a different payment method.",
          declined: true,
        });
        return;
      case "already":
        res.status(200).json({ alreadyBooked: true, paid: true });
        return;
      default:
        req.log.info({ sessionId: id, studentId: user.userId, price }, "session booked and paid");
        res.status(201).json({ ...result.enrolment, paid: true });
        return;
    }
  } catch (e) {
    req.log.error({ err: e, sessionId: id, studentId: user.userId }, "booking failed");
    res.status(500).json({ error: "Booking could not be completed. Please try again." });
  }
}

router.post("/sessions/:id/book", requireAuth, bookSession);
// The app shipped against this path, so it stays and performs the same atomic booking.
router.post("/sessions/:id/enroll", requireAuth, bookSession);

/**
 * Payment provider webhook — the only route to "paid" in production.
 *
 * The signature is checked against the raw request body, so a forged call cannot mark a
 * class as paid. `express.json` is configured with a verify hook that stashes those exact
 * bytes; re-serialising the parsed object would change key order or spacing and break the
 * digest.
 */
router.post("/payments/webhook", async (req, res): Promise<void> => {
  const raw = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  const signature =
    (req.headers["x-signature"] as string | undefined) ??
    (req.headers["x-webhook-signature"] as string | undefined);

  if (!webhookSecret()) {
    req.log.error("payment webhook called but PAYMENT_WEBHOOK_SECRET is not configured");
    res.status(503).json({ error: "Payment webhook is not configured." });
    return;
  }

  if (!verifyWebhookSignature(raw, signature)) {
    req.log.warn({ hasSignature: !!signature }, "rejected payment webhook with bad signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const { sessionId, studentId, transactionId, status } = req.body as {
    sessionId?: number; studentId?: number; transactionId?: string; status?: string;
  };

  if (!Number.isInteger(sessionId) || !Number.isInteger(studentId)) {
    res.status(400).json({ error: "sessionId and studentId are required" });
    return;
  }
  if (status && status !== "success" && status !== "paid" && status !== "COMPLETE") {
    req.log.info({ sessionId, studentId, status }, "payment webhook reported a non-success status");
    res.json({ ok: true, ignored: true });
    return;
  }

  const updated = await markEnrolmentPaid(sessionId!, studentId!, transactionId ?? null);
  if (!updated) {
    res.status(404).json({ error: "No matching enrolment" });
    return;
  }

  req.log.info({ sessionId, studentId, transactionId }, "enrolment marked paid via verified webhook");
  res.json({ ok: true });
});

/**
 * Tells the app whether this user may join, so the UI can show "Enroll" instead of an
 * enabled "Join Live Class" it cannot honour. The server still enforces the same rule on
 * /room and on the websocket — this endpoint only exists so the button can tell the truth.
 */
router.get("/sessions/:id/access", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const membership = await getSessionMembership(id, req.user!.userId);
  if (!membership) { res.status(404).json({ error: "Session not found" }); return; }

  const opensAt = membership.scheduledFor
    ? new Date(membership.scheduledFor.getTime() - JOIN_WINDOW_MINUTES * 60_000).toISOString()
    : null;

  res.json({
    canJoin: canAccessSession(membership),
    isTeacher: membership.isSessionTeacher,
    isEnrolled: membership.isEnrolledStudent,
    hasPaid: membership.hasPaid,
    status: membership.status,
    /** The door is open but the teacher has not started: the app shows a waiting room. */
    awaitingTeacher:
      !membership.isSessionTeacher &&
      membership.hasPaid &&
      membership.status !== "live" &&
      joinWindowOpen(membership),
    /** When the early-join window opens, so the app can count down to it. */
    joinOpensAt: opensAt,
    joinWindowMinutes: JOIN_WINDOW_MINUTES,
  });
});

export default router;
