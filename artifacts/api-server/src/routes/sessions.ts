import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { ordinaryTeachingAccess } from "../lib/teachingAccess";
import { flagContent } from "../lib/moderation";
import { broadcastSessionStatus, resetBoardFor } from "../ws/classroomHub";
import { videoProvider } from "../lib/video";
import { expireLeftOverSessions, otherRunningSessions } from "../lib/sessionLifecycle";
import { notify, notifyMany } from "../lib/notify";
import { activityFor, markSessionEnded } from "../lib/sessionLifecycle";
import { canJoin, canStart, isCreatableAt, isPastCutoff, studentDoorClosesAt } from "../lib/sessionStart";
import { attendanceFor, enrolledStudents } from "../lib/participation";
import { findingsFor, teacherIsLate, teacherMinutesLate } from "../lib/sessionEvidence";
import {
  refundSplit,
  canReschedule,
  isAcceptableNewDate,
  scheduleMoved,
  hasEditsLeft,
  SCHEDULE_EDITS_PER_MONTH,
  RESCHEDULE_LOCK_HOURS,
} from "../lib/sessionChanges";
import {
  countScheduleEdits,
  lockScheduleQuota,
  paidEnrolments,
  scheduleEditsUsed,
} from "../lib/scheduleChanges";
import { refundsTable, scheduleChangesTable } from "@workspace/db";
import { isRecurringDay, notARecurringDay } from "../lib/monthlyStore";
import { mayCreateClassAt } from "../lib/sessionAllowance";


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

  /**
   * Days of a monthly class are hidden from the browsing list, and only from that one.
   *
   * Asked without a teacher or a student, this is Discover — classes for sale. A monthly
   * class-day cannot be bought (see `POST /sessions/:id/book`), so offering one there is
   * offering something that will be refused, thirty times over for the same course.
   *
   * Asked *with* a teacher or a student it is somebody's own list of classes, where these
   * belong: the student paid for them and the teacher is teaching them.
   */
  if (!teacherId && !studentId) conditions.push(notARecurringDay);

  /**
   * How this student stands with each of their classes, so the list can label them.
   *
   * Empty unless a studentId was asked for. Keyed by session id.
   */
  let enrolmentBySession = new Map<number, string>();

  if (studentId) {
    /**
     * Paid classes, and ones they paid for and left.
     *
     * An *unpaid* row still never appears: a student used to see a class they believed they
     * owned and be refused at the door. But a **dropped** class disappearing entirely was
     * wrong too — it is where the refund is chased from, and losing it at the moment the money
     * is owed reads as the app having forgotten. It comes back tagged instead.
     */
    const enrolled = await db
      .select({
        sessionId: sessionEnrollmentsTable.sessionId,
        paymentStatus: sessionEnrollmentsTable.paymentStatus,
      })
      .from(sessionEnrollmentsTable)
      .where(
        and(
          eq(sessionEnrollmentsTable.studentId, parseInt(studentId, 10)),
          inArray(sessionEnrollmentsTable.paymentStatus, ["paid", "refunded"]),
        ),
      );
    enrolmentBySession = new Map(enrolled.map((e) => [e.sessionId, e.paymentStatus]));
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

  // `enrolment` is attached to the response rather than stored on the class: it is this
  // student's relationship to it, not a property of the class, and `sessions` is read with a
  // bare select() in six routes — a column added there is a 500 in all of them until the
  // schema is pushed by hand.
  const withEnrolment = enrolmentBySession.size
    ? sessions.map((row) => ({ ...row, enrolment: enrolmentBySession.get(row.id) ?? null }))
    : sessions;

  /**
   * Which of these are over without ever having happened.
   *
   * A class nobody started keeps `status = 'upcoming'` forever, so a teacher's dashboard listed
   * classes from last week under "Upcoming Sessions", each with a Start button — and starting
   * one is refused, because `canStart` knows perfectly well that it is over. The two disagreed
   * only because the list never asked.
   *
   * Computed here rather than stored. It is a fact about the clock, not about the row, so a
   * column would need writing by something and would be wrong the moment nothing did.
   * `sessions` is also read with a bare select() in six routes, where a new column is a 500
   * until the schema is pushed by hand.
   */
  const now = Date.now();
  const withState = withEnrolment.map((row) => ({
    ...row,
    expired:
      row.status === "upcoming" &&
      isPastCutoff({ date: row.date, duration: row.duration, startedAt: row.startedAt, endedAt: null, status: row.status }, now),
  }));

  res.json({ sessions: withState, total, page: pageNum, limit: limitNum });
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

  const access = await ordinaryTeachingAccess(user.userId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.message, code: access.code });
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

  const access = await ordinaryTeachingAccess(user.userId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.message, code: access.code });
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
  if (!date || !when || Number.isNaN(when.getTime())) {
    errors.push("A valid date and time is required.");
  } else if (!isCreatableAt(when)) {
    /**
     * A class cannot be created in the past.
     *
     * It could, and the result was a class nobody could use and nobody could get rid of: it sat
     * in the Upcoming list, said "Session Expired" when opened, and a student who booked it was
     * told their teacher was two thousand minutes late. Every one of those is downstream of a
     * date that should never have been accepted.
     *
     * The grace exists for "Create & Go Live Now", which sends the current time and takes a
     * moment to arrive — a strict comparison would reject the teacher's own clock.
     */
    errors.push("A class cannot be scheduled in the past. Please pick a date and time from now on.");
  }

  // Whole numbers, matching the edit route. Rounding a fractional value silently turns it into
  // a different instruction from the one that was sent.
  if (duration !== undefined && (!Number.isInteger(duration) || duration <= 0)) {
    errors.push("Duration must be a whole number of minutes, greater than zero.");
  }
  if (maxStudents !== undefined && (!Number.isInteger(maxStudents) || maxStudents <= 0)) {
    errors.push("Maximum students must be a whole number, greater than zero.");
  }
  // Amount is mandatory and must be a real charge — 0 was being accepted, which quietly
  // created free classes on a paid platform.
  if (price === undefined || price === null || !Number.isInteger(price) || price <= 0) {
    errors.push("Amount is required and must be a whole number of rupees, greater than zero.");
  }

  if (errors.length > 0) {
    res.status(400).json({ error: errors.join(" ") });
    return;
  }

  /**
   * The subscription tier is what Sikshya earns on ordinary classes — there is no commission on
   * a booking — so the allowance has to mean something. Until now it did not: the tier was
   * stored, displayed and never once compared to anything, and a teacher on the ten-class plan
   * could create five hundred.
   *
   * Checked after validation so a teacher with a broken form is told about the form, not about
   * their plan. Days of a monthly recurring class are excluded — see `sessionAllowance.ts`.
   */
  const allowance = await mayCreateClassAt({ teacherId: user.userId, when: when! });
  if (!allowance.allowed) {
    res.status(402).json({
      error: allowance.message,
      allowance: {
        tier: allowance.tier,
        limit: allowance.limit,
        usedNearby: allowance.usedNearby,
        freesAt: allowance.freesAt,
        upgradeTo: allowance.upgradeTo,
      },
    });
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
  await flagContent({ userId: user.userId, surface: "session_title", subjectId: session.id, text: `${subject} ${topic}` });

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
  /**
   * The teacher's door and the student's are no longer the same door.
   *
   * A teacher may reopen a class up to ten minutes past the booked finish; a student's door
   * shuts at five, so nobody is still arriving while the room is being closed around them.
   * Asking one question for both would either let a student in too late or lock a teacher out
   * of a recovery — see lib/sessionStart.ts.
   */
  const timing = membership!.isSessionTeacher
    ? canStart({ ...session, endedAt: activity.endedAt })
    : canJoin({ ...session, endedAt: activity.endedAt });
  if (!timing.ok) {
    res.status(409).json({ error: timing.reason, expired: true });
    return;
  }

  /**
   * Asked of whichever provider is carrying the video, not of Daily by name.
   *
   * Daily is the only one today and this behaves exactly as it did. The seam is here because
   * replacing it is decided future work — forty-five people in a daily ninety-minute call does
   * not survive per-participant-minute pricing — and a swap should mean writing one file, not
   * editing every route and classroom screen. See lib/video/types.ts and VIDEO.md.
   */
  const video = videoProvider();
  try {
    const roomUrl = await video.ensureRoom(id);
    // Only this session's teacher gets an owner token, and only the server can mint one, so
    // moderator powers cannot be granted by anything the client says about itself.
    const [userRow] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId));
    const token = await video.joinToken(id, {
      isOwner: membership!.isSessionTeacher,
      userName: userRow?.name ?? "Guest",
    });
    /**
     * `roomUrl`, `token` and `isOwner` keep their names.
     *
     * The app already reads them and they are what every candidate provider actually gives you
     * — a place to join and something that authorises one person to join it. `provider` and
     * `capabilities` are added so the app can mount the right call UI and stop guessing at what
     * a provider can do; nothing that exists today has to change.
     */
    res.json({
      roomUrl,
      token,
      isOwner: membership!.isSessionTeacher,
      provider: video.name,
      capabilities: video.capabilities,
    });
  } catch (err) {
    req.log.error({ err, sessionId: id, provider: video.name }, "could not set up the video room");
    res.status(502).json({ error: "Failed to set up video room" });
  }
});

/**
 * Give everybody who paid for a cancelled class their money back, and tell them.
 *
 * Each student is written in their own transaction rather than all of them in one. Thirty
 * students in a single transaction means one bad row loses the other twenty-nine refunds; they
 * are independent of each other, and a partial success here is genuinely better than
 * all-or-nothing.
 *
 * Nobody is paid twice. The guard is the `payment_status = 'paid'` condition inside the
 * transaction: a student who dropped earlier already reads `refunded`, so the update matches
 * nothing and no row is written. An `alreadyRefunded` lookup was here too, and removing it
 * changed no test at all — a redundant check nothing can tell apart from a working one is worse
 * than none, because it invites the belief that it is doing something.
 */
async function refundEveryoneFor(
  sessionId: number,
  topic: string,
  price: number,
  paying: { id: number; studentId: number }[],
  teacherId: number,
  req: Request,
): Promise<void> {
  const split = refundSplit(price, "teacher_cancelled");
  const [teacherRow] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, teacherId));

  const told: number[] = [];
  for (const enrolment of paying) {
    try {
      const written = await db.transaction(async (tx) => {
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
        if (freed.length === 0) return false;

        await tx
          .update(sessionsTable)
          .set({ enrolledCount: sql`GREATEST(0, ${sessionsTable.enrolledCount} - 1)` })
          .where(eq(sessionsTable.id, sessionId));

        await tx.insert(refundsTable).values({
          sessionId,
          studentId: enrolment.studentId,
          pricePaid: price,
          amount: split.studentRefund,
          teacherShare: 0,
          platformShare: 0,
          reason: "teacher_cancelled",
          status: "owed",
        });
        return true;
      });

      if (written) told.push(enrolment.studentId);
    } catch (err) {
      // One student's refund failing must not stop the rest of the class being repaid. Logged
      // loudly, because it leaves somebody owed money with no row saying so.
      req.log.error({ err, sessionId, studentId: enrolment.studentId },
        "could not record a refund for a cancelled class");
    }
  }

  if (told.length > 0) {
    notifyMany(told, {
      kind: "session_cancelled",
      sessionId,
      topic,
      fromUserId: teacherId,
      fromName: teacherRow?.name ?? "Your teacher",
      amount: split.studentRefund,
      at: new Date().toISOString(),
    });
  }
}

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

  const { status, topic, subject, date, duration, maxStudents, price } = req.body as {
    status?: string;
    topic?: string;
    subject?: string;
    date?: string;
    duration?: number;
    maxStudents?: number;
    price?: number;
  };
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

  if (topic !== undefined) {
    if (!String(topic).trim()) { res.status(400).json({ error: "Topic cannot be empty." }); return; }
    updates.topic = String(topic).trim();
  }
  if (subject !== undefined) {
    if (!String(subject).trim()) { res.status(400).json({ error: "Subject cannot be empty." }); return; }
    updates.subject = String(subject).trim();
  }
  /**
   * Whole numbers only, rather than rounding whatever arrives.
   *
   * `Math.round` turned a limit of 0.5 students into 1, which is a different instruction from
   * the one that was sent. Silently reinterpreting a nonsense number is worse than refusing it:
   * the caller believes something happened that did not.
   */
  if (duration !== undefined) {
    if (!Number.isInteger(duration) || duration <= 0) {
      res.status(400).json({ error: "Duration must be a whole number of minutes, greater than zero." });
      return;
    }
    updates.duration = duration;
  }
  if (maxStudents !== undefined) {
    if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
      res.status(400).json({ error: "Maximum students must be a whole number, greater than zero." });
      return;
    }
    updates.maxStudents = maxStudents;
  }

  let newDate: Date | null = null;
  if (date !== undefined) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: "A valid date and time is required." });
      return;
    }
    newDate = parsed;
  }

  if (Object.keys(updates).length === 0 && newDate === null && price === undefined) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [existing] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }
  if (existing.teacherId !== user.userId) {
    res.status(403).json({ error: "You can only update your own sessions" });
    return;
  }

  /**
   * How many people this change lands on. Needed before anything is written, because several
   * of the rules below only bite once somebody has paid.
   */
  const paying = await paidEnrolments(id);

  /**
   * The price stops being editable the moment anyone has paid it.
   *
   * A student agreed to a number. Changing it afterwards either charges them more than they
   * agreed to or leaves the platform owing a difference nobody asked for, and neither has an
   * honest answer. Before the first booking it is simply a number on an unsold class.
   */
  if (price !== undefined) {
    if (!Number.isInteger(price) || price <= 0) {
      res.status(400).json({ error: "Amount must be a whole number of rupees, greater than zero." });
      return;
    }
    if (price !== existing.price && paying.length > 0) {
      res.status(409).json({
        error:
          "The price cannot be changed once a student has paid it. Cancel this class and " +
          "create a new one if you need a different price.",
      });
      return;
    }
    updates.price = price;
  }

  // A class cannot be shrunk below the number of people already in it.
  if (maxStudents !== undefined && maxStudents < existing.enrolledCount) {
    res.status(409).json({
      error:
        `${existing.enrolledCount} student${existing.enrolledCount === 1 ? " has" : "s have"} ` +
        `already booked, so the limit cannot go below ${existing.enrolledCount}.`,
    });
    return;
  }

  /**
   * Making a class *longer* is held to the same notice as moving it.
   *
   * The owner defined "the schedule" as the date and the time, and that is what the monthly
   * allowance and the refund window follow. Duration is not covered by that wording, but a
   * sixty-minute class turned into a three-hour one the night before is the same broken promise
   * by another route, so a longer class needs the same notice. It does not spend an edit and
   * does not open a refund window — those are the owner's rule, and this is only a guard
   * against the obvious hole. Shortening a class is always allowed: nobody's day gets harder.
   */
  if (duration !== undefined && duration > existing.duration && paying.length > 0) {
    const room = canReschedule(existing);
    if (!room.ok) {
      res.status(409).json({
        error:
          `A class can only be made longer more than ${RESCHEDULE_LOCK_HOURS} hours before it ` +
          `starts. You can still make it shorter.`,
      });
      return;
    }
  }

  /**
   * Moving the class: the change that costs somebody something.
   *
   * Three gates, in the order that gives the most useful refusal first — whether this class can
   * be moved at all, whether the new time is far enough away, and whether the teacher has any
   * of this month's five changes left.
   */
  const moving = newDate !== null && scheduleMoved(existing.date, newDate);
  if (moving) {
    const room = canReschedule(existing);
    if (!room.ok) { res.status(409).json({ error: room.reason }); return; }

    const acceptable = isAcceptableNewDate(newDate!);
    if (!acceptable.ok) { res.status(400).json({ error: acceptable.reason }); return; }

    /**
     * A first look at the allowance, so a teacher who has plainly run out is told so without
     * waiting on a lock. It is not the check that decides — that one is inside the transaction
     * below, because counting and then inserting is two steps and requests arriving together
     * all counted before any of them had inserted.
     */
    const used = await scheduleEditsUsed(user.userId);
    if (used === null) {
      // An unknown count is not zero. Refusing for a minute is recoverable; an allowance that
      // silently stops applying during an outage is not.
      res.status(503).json({
        error: "We could not check your remaining schedule changes just now. Please try again.",
      });
      return;
    }
    const left = hasEditsLeft(used);
    if (!left.ok) {
      res.status(409).json({ error: left.reason, editsUsed: used, editsAllowed: SCHEDULE_EDITS_PER_MONTH });
      return;
    }

    updates.date = newDate;
  } else if (newDate !== null) {
    // Same instant sent back unchanged — accept it silently rather than spending an edit.
    updates.date = newDate;
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

    // Make the room the moment the teacher starts the class, so it already exists by the time
    // either side tries to join it. Through the provider, so this is not a second place that
    // has to change when Daily is replaced.
    try {
      await videoProvider().ensureRoom(id);
    } catch (err) {
      req.log.error({ err, sessionId: id }, "could not pre-create the video room on session start");
    }
  }

  /**
   * The class and the record of the move are written together or not at all.
   *
   * They have to be. The row is what counts against the allowance and what starts the students'
   * twenty-four hours to ask for their money back — a moved class with no row is a free move
   * and a refund window that never opens, and a row with no move accuses a teacher of something
   * they did not do.
   */
  let session: typeof existing;
  /** Who was actually in the class when it moved. Empty unless it moved. */
  let movedAffected: { studentId: number }[] = [];
  if (moving) {
    const outcome = await db.transaction(async (tx) => {
      // Nobody else may spend this teacher's allowance until this transaction ends. Per teacher,
      // so two teachers moving classes at the same moment never wait on each other.
      await lockScheduleQuota(tx, user.userId);

      // Counted again, now that the count cannot change underneath us. This is the check that
      // decides; the one above the write only saves a lock when the answer is already no.
      const spent = await countScheduleEdits(tx, user.userId);
      const room = hasEditsLeft(spent);
      if (!room.ok) return { blocked: room.reason, spent };

      const [updated] = await tx
        .update(sessionsTable)
        .set(updates)
        .where(eq(sessionsTable.id, id))
        .returning();

      /**
       * Who to tell, read here rather than at the top of the handler.
       *
       * The list gathered before the write is already out of date by this point: a student who
       * booked in between is not in it, so they would not be told their class had moved and
       * would never hear that they had a day to take the whole price back. Reading it after the
       * update is safe because that update holds the session's row lock, which the booking
       * transaction also takes — so a concurrent booking is either committed and visible here,
       * or blocked until this transaction ends.
       */
      const affected = await tx
        .select({ studentId: sessionEnrollmentsTable.studentId })
        .from(sessionEnrollmentsTable)
        .where(
          and(
            eq(sessionEnrollmentsTable.sessionId, id),
            eq(sessionEnrollmentsTable.paymentStatus, "paid"),
          ),
        );

      await tx.insert(scheduleChangesTable).values({
        sessionId: id,
        teacherId: user.userId,
        previousDate: new Date(existing.date),
        newDate: newDate!,
        affectedStudents: affected.length,
      });
      return { updated, affected };
    });

    if ("blocked" in outcome) {
      res.status(409).json({
        error: outcome.blocked,
        editsUsed: outcome.spent,
        editsAllowed: SCHEDULE_EDITS_PER_MONTH,
      });
      return;
    }
    session = outcome.updated;
    movedAffected = outcome.affected;
  } else {
    [session] = await db.update(sessionsTable).set(updates).where(eq(sessionsTable.id, id)).returning();
  }

  if (topic !== undefined || subject !== undefined) {
    await flagContent({
      userId: user.userId,
      surface: "session_title",
      subjectId: id,
      text: `${session.subject} ${session.topic}`,
    });
  }

  /**
   * Tell everyone who paid, and tell them what it means for them.
   *
   * Not a courtesy. The refund window is twenty-four hours from this moment, so a student who
   * is not told loses the choice by being kept in the dark.
   */
  if (moving && movedAffected.length > 0) {
    const [teacherRow] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, user.userId));
    notifyMany(
      movedAffected.map((p) => p.studentId),
      {
        kind: "session_rescheduled",
        sessionId: id,
        topic: existing.topic,
        fromUserId: user.userId,
        fromName: teacherRow?.name ?? "Your teacher",
        previousDate: new Date(existing.date).toISOString(),
        newDate: newDate!.toISOString(),
        at: new Date().toISOString(),
      },
    );
  }

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

  /**
   * Calling a class off is the same cause as moving it, so it gets the same answer.
   *
   * Without this a teacher walked straight past everything above: no 48-hour lock, no monthly
   * allowance, no refund and no notification — just a class that quietly stopped existing while
   * the people who paid for it were told nothing. That made the whole regime for *moving* a
   * class pointless, because cancelling was the cheaper way out of one.
   *
   * Deliberately not rationed the way moving is. A teacher who is ill has to be able to cancel;
   * making them keep a class they cannot teach in order to stay inside a quota would be worse
   * for everybody in it. What it costs them is the fee, in full, every time.
   *
   * Only for a class that has not happened. Cancelling one already taught is not a cancellation,
   * it is a dispute, and those are decided by a person from the evidence.
   */
  if (status === "cancelled" && existing.status === "upcoming") {
    /**
     * Read again, *after* the class is marked cancelled rather than before.
     *
     * The list gathered at the top of this handler is from before the write, and a booking that
     * landed in between would not be in it — a student paid into a class that was cancelled a
     * moment later, and no refund. Nothing new can be booked once the status is written (the
     * booking transaction re-reads it under its own lock), so this read is the final answer.
     */
    const stillPaid = await paidEnrolments(id);
    if (stillPaid.length > 0) {
      await refundEveryoneFor(id, existing.topic, existing.price, stillPaid, user.userId, req);
    }
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

  /**
   * A day of somebody's monthly class is not for sale on its own.
   *
   * It looks like an ordinary class here — that is the point, so that the video room, the
   * whiteboard and `membership.ts` all work on it unchanged — but its price is zero, because
   * the month was paid for once. Without this check anybody could take a seat in a paid course
   * for nothing, which is the one thing the owner has been clearest about.
   *
   * Checked here rather than trusted to the seat count. The class being full is a second
   * barrier and not the guarantee: a month with three students in a class that takes
   * forty-five leaves forty-two seats that would otherwise be free to anyone who asked.
   */
  if (await isRecurringDay(id)) {
    res.status(409).json({
      error:
        "This class is part of a monthly course, so it isn't sold one class at a time. " +
        "Join the monthly class to get every class in it.",
      monthly: true,
    });
    return;
  }
  if (session.status === "completed" || session.status === "cancelled") {
    res.status(409).json({ error: "This session is no longer available." });
    return;
  }

  /**
   * A class can be bought while it is still possible to attend it, and not after.
   *
   * The line was the scheduled **start**, which came from the owner's "a student should never
   * be allowed to enroll in any past date classes/session" — but the class that prompted that
   * was two days dead, and this rule also caught a class that was *running right now*. A
   * teacher scheduled one two minutes out, went live, and nobody could buy their way in: the
   * student paid and was told "the class has already started". That makes "Schedule & Go Live"
   * unsellable, which cannot be what was meant.
   *
   * So the line is the moment the student's door shuts — the booked finish plus five minutes,
   * the same instant they would stop being able to walk in. A class that is over cannot be
   * sold, which is what the original complaint was about. A class in progress can, and the app
   * says how long ago it started so the choice is an informed one rather than a surprise.
   */
  /**
   * Only the *closing* edge of the door, never the opening one.
   *
   * `canJoin` was the obvious thing to reach for and it is wrong here: it is false before the
   * doors open as well as after they shut, so using it made every class more than ten minutes
   * away unbookable — which is nearly all of them. Caught by the tests immediately, and worth
   * the comment because the mistake reads as correct.
   */
  const closesAt = studentDoorClosesAt({
    date: session.date,
    duration: session.duration,
    startedAt: session.startedAt,
    endedAt: null,
    status: session.status,
  });
  if (session.status === "cancelled" || (closesAt !== null && Date.now() > closesAt)) {
    res.status(409).json({
      error: "This class is over, so it can no longer be booked.",
      started: true,
    });
    return;
  }

  const price = session.price ?? 0;

  try {
    const result = await db.transaction(async (tx) => {
      // Re-read the row inside the transaction and lock it, so two students booking the last
      // seat at the same instant cannot both be let in.
      const [locked] = await tx
        .select({
          enrolledCount: sessionsTable.enrolledCount,
          maxStudents: sessionsTable.maxStudents,
          // Read again under the lock. The check above ran before this transaction opened, so
          // on its own it lets a booking commit against a class that was cancelled in between —
          // leaving a student paid into a class that no longer exists, and missed by the refund
          // the cancellation wrote, because that refund had already listed who had paid.
          status: sessionsTable.status,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .for("update");

      if (!locked) return { kind: "gone" as const };
      if (locked.status === "completed" || locked.status === "cancelled") {
        return { kind: "closed" as const };
      }

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
      case "closed":
        // Cancelled or finished between the check above and the lock. Same message as that
        // check, because from the student's side it is the same thing.
        res.status(409).json({ error: "This session is no longer available." });
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
      default: {
        req.log.info({ sessionId: id, studentId: user.userId, price }, "session booked and paid");
        /**
         * Tell the teacher somebody is coming.
         *
         * This was simply missing: a student could book, pay and turn up, and the first the
         * teacher knew of it was finding them in the room — or not finding out at all, for a
         * class nobody happened to open. Reported by the owner as "the teacher does not get
         * any notification when a student registers for the session".
         *
         * After the transaction, never inside it: the booking is committed and paid at this
         * point, and a notification that cannot be sent must not undo somebody's payment.
         */
        const [studentRow] = await db
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, user.userId));
        notify(session.teacherId, {
          kind: "session_booked",
          sessionId: id,
          topic: session.topic,
          fromUserId: user.userId,
          fromName: studentRow?.name ?? "A student",
          // The number is the point of this notification. A teacher wants to know they were
          // paid, not merely that somebody clicked something.
          amount: session.price,
          at: new Date().toISOString(),
        });
        res.status(201).json({ ...result.enrolment, paid: true });
        return;
      }
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


/**
 * Who was expected in this class, and who actually turned up.
 *
 * Three things the owner asked for come out of this one endpoint, and they are the same
 * question asked at different moments:
 *
 * - *Before* the class: the teacher opens the session's own page and sees who has booked,
 *   without having to start it to find out. "The teacher should be able to click on it and
 *   see the students that have enrolled."
 * - *During* it: a student sitting in the room can tell whether the teacher has arrived, and
 *   after ten minutes is offered a way to get help. `serverTime` is here for that — a cheap
 *   phone with a wrong clock must not decide on its own that a punctual teacher is late.
 * - *Afterwards*: the completed class shows who attended, and a refund argued weeks later has
 *   something to read. See REFUNDS.md.
 *
 * Who may read it is deliberately not `canAccessSession`. That answers "may this person be in
 * the room", which is false for everybody once a class is over — and the moment a student most
 * needs the record is precisely after the class they are disputing has finished. The rule here
 * is "may this person read the record of this class": its teacher, or a student who paid.
 */
router.get("/sessions/:id/attendance", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  /**
   * A place in the class, not a place in the room — and a place they used to have counts.
   *
   * Somebody who dropped or was refunded keeps this for the same reason they keep the message
   * thread: it is the record of the class they are usually arguing about. Cutting them off at
   * the moment of the refund took the evidence away exactly when they needed it, and on the
   * class's own page it took the whole thread with it, because this call is what tells that
   * page the reader has a place there at all.
   */
  const membership = await getSessionMembership(id, req.user!.userId);
  if (!membership || (!membership.isSessionTeacher && !membership.hasPaid && !membership.wasRefunded)) {
    res.status(403).json({ error: "You do not have access to this session." });
    return;
  }

  const activity = await activityFor(id);
  const attendance = await attendanceFor(id);
  const scheduled = {
    date: session.date,
    duration: session.duration,
    startedAt: session.startedAt,
    endedAt: activity.endedAt,
  };
  const teacherRecord = attendance.rows.find((row) => row.role === "teacher") ?? null;

  const shared = {
    sessionId: id,
    // The server's clock, so the app can run a timestamp that agrees with the rules the server
    // enforces rather than with whatever the handset believes the time is.
    serverTime: new Date().toISOString(),
    startedAt: session.startedAt,
    endedAt: activity.endedAt,
    status: session.status,
    /**
     * When the teacher arrived, or null if they have not.
     *
     * This is the one to read for "is the teacher here yet" — the waiting banner a student
     * sees. It is a different question from whether they were late, and the two must not be
     * run together: a teacher who turns up at minute fifteen *is* here, and *was* late.
     *
     * Null also when the ledger could not be read, which is not the same as "no teacher came";
     * `known` is how those are told apart.
     */
    teacherJoinedAt: attendance.known ? (teacherRecord?.firstJoinedAt ?? null) : null,
    /**
     * Whether the teacher kept this class waiting past the ten-minute line.
     *
     * Stays true once it is true, including after the teacher arrives. That is the point of it:
     * the owner's rule is that a student made to wait more than ten minutes gets a way to reach
     * customer service, and a teacher strolling in at minute twelve does not undo the wait.
     */
    teacherIsLate: attendance.known ? teacherIsLate(scheduled, teacherRecord) : false,
    /**
     * How many minutes late, counting up while nobody has arrived.
     *
     * Sent so the app can say "your teacher is 12 minutes late" without doing clock arithmetic
     * on a handset whose clock may be wrong. Null when there is no readable start time.
     */
    teacherLateBy: attendance.known ? teacherMinutesLate(scheduled, teacherRecord) : null,
    /**
     * False means "we could not read the record", never "nothing happened". The app has to be
     * able to tell those apart, or a database blip shows a student that their teacher never
     * came to a lesson they both sat through.
     */
    known: attendance.known,
  };

  if (!membership.isSessionTeacher) {
    // A student is told about the teacher and about themselves. Not about the other students:
    // paying for a class does not buy the register.
    const mine = attendance.rows.find((row) => row.userId === req.user!.userId) ?? null;
    res.json({
      ...shared,
      role: "student",
      you: mine,
      teacher: teacherRecord,
      attendeeCount: attendance.rows.filter((row) => row.role === "student").length,
    });
    return;
  }

  const enrolled = await enrolledStudents(id);
  const byUser = new Map(attendance.rows.map((row) => [row.userId, row]));

  res.json({
    ...shared,
    role: "teacher",
    teacher: teacherRecord,
    /**
     * Everyone who paid, each carrying what the ledger knows about them.
     *
     * Built from the enrolment list rather than the attendance list on purpose: a student who
     * paid and never opened the class has no ledger row at all, and they are exactly the
     * person a teacher needs to see. `attended` is false for them, not missing.
     */
    enrolled: enrolled.map((student) => {
      const record = byUser.get(student.userId) ?? null;
      return {
        ...student,
        attended: !!record,
        presentMs: record?.presentMs ?? 0,
        joinCount: record?.joinCount ?? 0,
        firstJoinedAt: record?.firstJoinedAt ?? null,
        lastSeenAt: record?.lastSeenAt ?? null,
        messageCount: record?.messageCount ?? 0,
      };
    }),
    // Plain statements of fact with the numbers attached, for the teacher and for whoever
    // reads a dispute later. Deliberately not a verdict — see lib/sessionEvidence.ts.
    findings: attendance.known
      ? findingsFor(scheduled, attendance.rows, enrolled.map((e) => ({ userId: e.userId, name: e.name })))
      : [],
  });
});

export default router;
