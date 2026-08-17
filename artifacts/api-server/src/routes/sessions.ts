import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, sessionsTable, sessionEnrollmentsTable, teacherProfilesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getSessionMembership, canAccessSession } from "../lib/membership";
import { broadcastSessionStatus, resetRoomPresence } from "../ws/classroomHub";
import { ensureDailyRoom } from "../lib/daily";

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
    const enrolled = await db
      .select({ sessionId: sessionEnrollmentsTable.sessionId })
      .from(sessionEnrollmentsTable)
      .where(eq(sessionEnrollmentsTable.studentId, parseInt(studentId, 10)));
    const sessionIds = enrolled.map((e) => e.sessionId);
    if (sessionIds.length === 0) {
      res.json({ sessions: [], total: 0, page: pageNum, limit: limitNum });
      return;
    }
    conditions.push(sql`${sessionsTable.id} = ANY(ARRAY[${sql.join(sessionIds.map((id) => sql`${id}`), sql`,`)}]::int[])`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (status === "live") {
    // Ghost/bot-generated "live" sessions (e.g. from seed data) never get moved to
    // "completed" by a real teacher action. Lazily auto-expire them so the Sessions tab and
    // Live Now section only ever show genuinely active classes.
    //
    // Staleness is judged from `startedAt` — when the teacher actually began — and only falls
    // back to the scheduled `date` for rows that predate that column. Using the scheduled slot
    // meant a class started even slightly late was already "expired": the next client to load
    // the live list would complete it and broadcast an end-of-session to everyone in it. A
    // student opening their own sessions tab was enough to kill the teacher's class.
    const staleLive = await db
      .select({
        id: sessionsTable.id,
        date: sessionsTable.date,
        startedAt: sessionsTable.startedAt,
        duration: sessionsTable.duration,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.status, "live"));

    const staleIds = staleLive
      .filter((s) => {
        const begunAt = s.startedAt ?? s.date;
        const endMs = new Date(begunAt).getTime() + (s.duration + 15) * 60 * 1000;
        return endMs < Date.now();
      })
      .map((s) => s.id);

    if (staleIds.length > 0) {
      await db.update(sessionsTable).set({ status: "completed" }).where(
        sql`${sessionsTable.id} = ANY(ARRAY[${sql.join(staleIds.map((id) => sql`${id}`), sql`,`)}]::int[])`
      );
      for (const staleId of staleIds) {
        broadcastSessionStatus(String(staleId), "completed");
      }
    }

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
  res.json(session);
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

  try {
    const roomUrl = await ensureDailyRoom(id);
    res.json({ roomUrl });
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
    const staleLiveSessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.teacherId, user.userId), eq(sessionsTable.status, "live"), sql`${sessionsTable.id} != ${id}`));

    if (staleLiveSessions.length > 0) {
      await db.update(sessionsTable).set({ status: "completed" }).where(
        and(eq(sessionsTable.teacherId, user.userId), eq(sessionsTable.status, "live"), sql`${sessionsTable.id} != ${id}`)
      );
      for (const stale of staleLiveSessions) {
        broadcastSessionStatus(String(stale.id), "completed");
      }
    }

    // Force-clear any stale/"ghost" presence left over from a previous run of this same
    // session (e.g. a connection that never closed cleanly) so the participant count
    // reads exactly 0 the moment the teacher starts the class.
    resetRoomPresence(String(id));

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

  res.json(session);
});

router.post("/sessions/:id/enroll", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  const { paymentMethod } = req.body as { paymentMethod?: string };

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.enrolledCount >= session.maxStudents) {
    res.status(409).json({ error: "Session is full" });
    return;
  }

  const existing = await db.select({ id: sessionEnrollmentsTable.id })
    .from(sessionEnrollmentsTable)
    .where(and(eq(sessionEnrollmentsTable.sessionId, id), eq(sessionEnrollmentsTable.studentId, user.userId)));
  if (existing.length > 0) {
    res.status(409).json({ error: "Already enrolled in this session" });
    return;
  }

  // A free class has nothing to pay for, so it is settled on enrolment. A paid one starts
  // "pending" and only becomes joinable once payment is confirmed below.
  const [enrollment] = await db.insert(sessionEnrollmentsTable).values({
    sessionId: id,
    studentId: user.userId,
    paymentStatus: session.price > 0 ? "pending" : "paid",
    paymentMethod: paymentMethod ?? null,
  }).returning();

  await db.update(sessionsTable)
    .set({ enrolledCount: session.enrolledCount + 1 })
    .where(eq(sessionsTable.id, id));

  await db.update(teacherProfilesTable)
    .set({ totalStudents: sql`${teacherProfilesTable.totalStudents} + 1` })
    .where(eq(teacherProfilesTable.userId, session.teacherId));

  res.status(201).json(enrollment);
});

/**
 * Marks an enrolment as paid.
 *
 * ⚠️ PLACEHOLDER. This trusts the caller, because eSewa and Khalti are not actually wired up —
 * the app only picks a method and shows a sheet. Before taking real money this MUST become a
 * server-to-server verification: the gateway's callback, or a lookup of the transaction id
 * against the gateway's API. As written, a student could call it directly and skip paying.
 * It exists so the "enrolled but unpaid cannot join" rule has something to switch on.
 */
router.post("/sessions/:id/payment/confirm", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const user = req.user!;
  const { transactionId } = req.body as { transactionId?: string };

  const [enrollment] = await db
    .select({ id: sessionEnrollmentsTable.id })
    .from(sessionEnrollmentsTable)
    .where(and(eq(sessionEnrollmentsTable.sessionId, id), eq(sessionEnrollmentsTable.studentId, user.userId)));

  if (!enrollment) {
    res.status(404).json({ error: "You are not enrolled in this session." });
    return;
  }

  const [updated] = await db
    .update(sessionEnrollmentsTable)
    .set({ paymentStatus: "paid", ...(transactionId ? { paymentMethod: transactionId } : {}) })
    .where(eq(sessionEnrollmentsTable.id, enrollment.id))
    .returning();

  req.log.info({ sessionId: id, studentId: user.userId }, "enrolment marked paid");
  res.json(updated);
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

  res.json({
    canJoin: canAccessSession(membership),
    isTeacher: membership.isSessionTeacher,
    isEnrolled: membership.isEnrolledStudent,
    hasPaid: membership.hasPaid,
  });
});

export default router;
