import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  homeworkSubmissionsTable,
  homeworkTable,
  recurringEnrollmentsTable,
  sessionMessagesTable,
  teacherPlansTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { notifyUsers } from "../ws/userHub";
import { notifyMany } from "../lib/notify";
import { recordActivity } from "../lib/activityLog";
import { classById, cycleOf } from "../lib/monthlyStore";
import { verifyUpload } from "../lib/fileStore";

/**
 * The monthly course's portal: its one conversation, and its homework.
 *
 * Both hang off the course rather than off a class-day, which is the whole point of the tier —
 * a student buys a month of teaching, not thirty unrelated lessons, and the thread and the
 * homework are what make it feel like one thing.
 */

const router: IRouter = Router();

const MAX_BODY_CHARS = 2_000;
const DEFAULT_LIMIT = 200;
const MAX_TITLE_CHARS = 200;
const MAX_INSTRUCTIONS_CHARS = 4_000;
const MAX_FEEDBACK_CHARS = 4_000;
/** Excalidraw scenes are verbose; this is generous for marking and mean for anything else. */
const MAX_ANNOTATION_CHARS = 400_000;

function idParam(req: Request, name = "id"): number | null {
  const raw = req.params[name];
  const value = parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  return Number.isNaN(value) ? null : value;
}

export interface PortalAccess {
  klass: NonNullable<Awaited<ReturnType<typeof classById>>>;
  isTeacher: boolean;
  /** The month the course is in now. Null before it has started one. */
  cycleIndex: number | null;
  /** True while this student holds a place in the current month. */
  isCurrentStudent: boolean;
  /** True if they have ever held one, which is what read access hangs off. */
  wasEverStudent: boolean;
}

/**
 * Who may see a monthly course's portal, and who may write in it.
 *
 * Reading and writing are separated for the same reason the class thread separates them: a
 * student whose month has ended, or who was refunded when a teacher was suspended, keeps what
 * was said and what they handed in. That record is most needed *after* they leave, because
 * that is when there is an argument about money.
 */
async function portalAccess(classId: number, userId: number): Promise<PortalAccess | null> {
  const klass = await classById(classId);
  if (!klass) return null;

  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  const cycle = plan ? await cycleOf(plan) : null;
  const cycleIndex = cycle?.index ?? null;

  if (klass.teacherId === userId) {
    return { klass, isTeacher: true, cycleIndex, isCurrentStudent: false, wasEverStudent: false };
  }

  const places = await db
    .select({ cycleIndex: recurringEnrollmentsTable.cycleIndex, status: recurringEnrollmentsTable.status })
    .from(recurringEnrollmentsTable)
    .where(
      and(
        eq(recurringEnrollmentsTable.recurringId, klass.id),
        eq(recurringEnrollmentsTable.studentId, userId),
      ),
    );
  if (places.length === 0) return null;

  return {
    klass,
    isTeacher: false,
    cycleIndex,
    isCurrentStudent: places.some((p) => p.cycleIndex === cycleIndex && p.status === "active"),
    wasEverStudent: true,
  };
}

/** Reading is not writing: somebody whose month has ended may read, but not post. */
const mayWrite = (access: PortalAccess) => access.isTeacher || access.isCurrentStudent;

/** Everyone who should hear about something: the teacher and this month's students. */
async function audienceFor(classId: number, cycleIndex: number | null, teacherId: number) {
  if (cycleIndex === null) return [teacherId];
  const students = await db
    .select({ studentId: recurringEnrollmentsTable.studentId })
    .from(recurringEnrollmentsTable)
    .where(
      and(
        eq(recurringEnrollmentsTable.recurringId, classId),
        eq(recurringEnrollmentsTable.cycleIndex, cycleIndex),
        eq(recurringEnrollmentsTable.status, "active"),
      ),
    );
  return [teacherId, ...students.map((s) => s.studentId)];
}

/* ------------------------------------------------------------------ the thread */

router.get("/monthly/classes/:id/messages", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const access = await portalAccess(id, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return;
  }

  const after = parseInt(String(req.query.after ?? ""), 10);

  try {
    const columns = {
      id: sessionMessagesTable.id,
      senderId: sessionMessagesTable.senderId,
      senderName: sessionMessagesTable.senderName,
      senderRole: sessionMessagesTable.senderRole,
      body: sessionMessagesTable.body,
      pinnedAt: sessionMessagesTable.pinnedAt,
      createdAt: sessionMessagesTable.createdAt,
    };

    /*
     * The **latest** page, not the first.
     *
     * A class thread covers one lesson and rarely fills a page, so reading the oldest two
     * hundred is the same as reading all of them. A monthly course's thread runs for a month:
     * asking for the oldest two hundred there opens the chat on messages from four weeks ago
     * and hides everything said today, which is precisely backwards for the thing a student
     * checks to find out where their class is.
     *
     * So it is read newest-first and turned back the right way round. `after` is different and
     * stays ascending: that is a page already open catching up on what it has not seen, and it
     * genuinely wants the oldest of those first.
     */
    const catchingUp = Number.isFinite(after);
    const found = catchingUp
      ? await db
          .select(columns)
          .from(sessionMessagesTable)
          .where(and(eq(sessionMessagesTable.recurringId, id), gt(sessionMessagesTable.id, after)))
          .orderBy(asc(sessionMessagesTable.id))
          .limit(DEFAULT_LIMIT)
      : (
          await db
            .select(columns)
            .from(sessionMessagesTable)
            .where(eq(sessionMessagesTable.recurringId, id))
            .orderBy(desc(sessionMessagesTable.id))
            .limit(DEFAULT_LIMIT)
        ).reverse();
    const messages = found;

    /*
     * Pinned messages come back separately as well as in the thread.
     *
     * A month of conversation is longer than one page, so a pinned message from three weeks ago
     * is not in `messages` at all — and a pin that scrolls out of reach is not a pin. The app
     * shows these at the top whatever the thread is showing.
     */
    const pinned = await db
      .select(columns)
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.recurringId, id), isNotNull(sessionMessagesTable.pinnedAt)))
      .orderBy(desc(sessionMessagesTable.pinnedAt));

    /*
     * Whether there is older conversation above this page.
     *
     * Told apart from "this is the whole thread" so the app can offer to fetch earlier messages
     * rather than silently presenting a month-long conversation as if it began two hundred
     * messages ago.
     */
    const oldest = messages[0]?.id;
    const earlier = oldest === undefined
      ? 0
      : (
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(sessionMessagesTable)
            .where(and(eq(sessionMessagesTable.recurringId, id), sql`${sessionMessagesTable.id} < ${oldest}`))
        )[0]?.n ?? 0;

    const mine = (m: { senderId: number }) => m.senderId === req.user!.userId;
    res.json({
      messages: messages.map((m) => ({ ...m, mine: mine(m) })),
      pinned: pinned.map((m) => ({ ...m, mine: mine(m) })),
      earlier,
      readOnly: !mayWrite(access),
      canPin: access.isTeacher,
      known: true,
    });
  } catch (err) {
    req.log?.warn({ err, recurringId: id }, "could not read the monthly thread");
    res.status(503).json({ error: "Messages are unavailable right now.", known: false });
  }
});

router.post("/monthly/classes/:id/messages", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const access = await portalAccess(id, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return;
  }
  if (!mayWrite(access)) {
    res.status(403).json({
      error: "Your month has ended, so you can read this conversation but not post to it.",
    });
    return;
  }

  const { body } = req.body as { body?: string };
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) {
    res.status(400).json({ error: "A message cannot be empty." });
    return;
  }
  if (text.length > MAX_BODY_CHARS) {
    res.status(400).json({ error: `Please keep messages under ${MAX_BODY_CHARS} characters.` });
    return;
  }

  const [sender] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));

  const [message] = await db
    .insert(sessionMessagesTable)
    .values({
      sessionId: null,
      recurringId: id,
      senderId: req.user!.userId,
      senderName: sender?.name ?? "Someone",
      senderRole: access.isTeacher ? "teacher" : "student",
      body: text,
    })
    .returning();

  const audience = (await audienceFor(id, access.cycleIndex, access.klass.teacherId)).filter(
    (userId) => userId !== req.user!.userId,
  );
  notifyUsers(audience, {
    kind: "session_message",
    // The app routes on this, and a monthly thread is not a session — say which class it is.
    monthlyClassId: id,
    fromUserId: req.user!.userId,
    fromName: message!.senderName,
    preview: text.slice(0, 140),
    at: message!.createdAt.toISOString(),
  });

  void recordActivity({
    userId: req.user!.userId,
    action: "monthly_message.sent",
    subjectType: "recurring_session",
    subjectId: id,
    detail: { length: text.length, recipients: audience.length },
  });

  res.status(201).json({ ...message, mine: true });
});

/** Pins or unpins a message. The teacher's alone: forty-five people pinning is nothing pinned. */
router.patch("/monthly/messages/:messageId/pin", requireAuth, async (req: Request, res: Response) => {
  const messageId = idParam(req, "messageId");
  if (messageId === null) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }
  const { pinned } = req.body as { pinned?: boolean };
  if (typeof pinned !== "boolean") {
    res.status(400).json({ error: "Say whether to pin or unpin." });
    return;
  }

  const [message] = await db
    .select()
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.id, messageId));
  if (!message || message.recurringId === null) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const access = await portalAccess(message.recurringId, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return;
  }
  if (!access.isTeacher) {
    res.status(403).json({ error: "Only the teacher can pin a message." });
    return;
  }

  const [updated] = await db
    .update(sessionMessagesTable)
    .set(
      pinned
        ? { pinnedAt: new Date(), pinnedBy: req.user!.userId }
        : { pinnedAt: null, pinnedBy: null },
    )
    .where(eq(sessionMessagesTable.id, messageId))
    .returning();

  res.json({ message: updated });
});

/* ---------------------------------------------------------------- homework */

/** Checks a file a caller says they uploaded, and refuses politely if it is not really theirs. */
async function acceptFile(
  key: unknown,
  type: unknown,
  userId: number,
): Promise<{ ok: true; key: string | null; type: string | null } | { ok: false; reason: string }> {
  if (key === undefined || key === null || key === "") return { ok: true, key: null, type: null };
  if (typeof key !== "string") return { ok: false, reason: "That file reference is not one of ours." };

  // The real size and type are read from what actually landed, never from what was claimed.
  const verdict = await verifyUpload(key, userId);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  return { ok: true, key, type: typeof type === "string" && type ? type : verdict.contentType };
}

/** Sets homework for the month. */
router.post("/monthly/classes/:id/homework", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const access = await portalAccess(id, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return;
  }
  if (!access.isTeacher) {
    res.status(403).json({ error: "Only the teacher can set homework." });
    return;
  }
  if (access.cycleIndex === null) {
    res.status(409).json({ error: "That class has not started its first month yet." });
    return;
  }

  const body = req.body as {
    title?: string; instructions?: string; fileKey?: string; fileType?: string; dueAt?: string;
  };
  const title = (body.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "Homework needs a title." });
    return;
  }
  if (title.length > MAX_TITLE_CHARS) {
    res.status(400).json({ error: `Please keep the title under ${MAX_TITLE_CHARS} characters.` });
    return;
  }
  const instructions = (body.instructions ?? "").trim() || null;
  if (instructions && instructions.length > MAX_INSTRUCTIONS_CHARS) {
    res.status(400).json({ error: `Please keep the instructions under ${MAX_INSTRUCTIONS_CHARS} characters.` });
    return;
  }
  const due = body.dueAt ? new Date(body.dueAt) : null;
  if (due && Number.isNaN(due.getTime())) {
    res.status(400).json({ error: "That due date could not be read." });
    return;
  }

  const file = await acceptFile(body.fileKey, body.fileType, req.user!.userId);
  if (!file.ok) {
    res.status(400).json({ error: file.reason });
    return;
  }

  const [created] = await db
    .insert(homeworkTable)
    .values({
      recurringId: id,
      teacherId: req.user!.userId,
      cycleIndex: access.cycleIndex,
      title,
      instructions,
      fileKey: file.key,
      fileType: file.type,
      dueAt: due,
      status: "open",
    })
    .returning();

  const audience = (await audienceFor(id, access.cycleIndex, access.klass.teacherId)).filter(
    (userId) => userId !== req.user!.userId,
  );
  if (audience.length > 0) {
    notifyMany(audience, {
      kind: "session_invite",
      at: new Date().toISOString(),
      fromUserId: req.user!.userId,
      topic: `Homework set: ${title}`,
    });
  }

  res.status(201).json({ homework: created, studentsTold: audience.length });
});

/** The month's homework, seen from whichever side the caller is on. */
router.get("/monthly/classes/:id/homework", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const access = await portalAccess(id, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return;
  }

  const rows = await db
    .select()
    .from(homeworkTable)
    .where(eq(homeworkTable.recurringId, id))
    .orderBy(desc(homeworkTable.id));

  if (access.isTeacher) {
    /*
     * The teacher sees how many have handed in and how many are still to mark.
     *
     * One grouped query rather than a count per piece of homework: a month can hold a lot of
     * homework and forty-five students, and a teacher opening the portal should not wait on
     * fifty round trips.
     */
    const counts = await db
      .select({
        homeworkId: homeworkSubmissionsTable.homeworkId,
        handedIn: sql<number>`count(*)::int`,
        marked: sql<number>`count(*) filter (where ${homeworkSubmissionsTable.status} = 'returned')::int`,
      })
      .from(homeworkSubmissionsTable)
      .innerJoin(homeworkTable, eq(homeworkTable.id, homeworkSubmissionsTable.homeworkId))
      .where(eq(homeworkTable.recurringId, id))
      .groupBy(homeworkSubmissionsTable.homeworkId);
    const byId = new Map(counts.map((c) => [c.homeworkId, c]));

    res.json({
      homework: rows.map((row) => ({
        ...row,
        handedIn: byId.get(row.id)?.handedIn ?? 0,
        marked: byId.get(row.id)?.marked ?? 0,
      })),
      asTeacher: true,
    });
    return;
  }

  // A student sees their own answer and nobody else's.
  const mine = await db
    .select()
    .from(homeworkSubmissionsTable)
    .innerJoin(homeworkTable, eq(homeworkTable.id, homeworkSubmissionsTable.homeworkId))
    .where(
      and(
        eq(homeworkTable.recurringId, id),
        eq(homeworkSubmissionsTable.studentId, req.user!.userId),
      ),
    );
  const byHomework = new Map(mine.map((r) => [r.homework_submissions.homeworkId, r.homework_submissions]));

  res.json({
    homework: rows.map((row) => ({ ...row, submission: byHomework.get(row.id) ?? null })),
    asTeacher: false,
    canSubmit: access.isCurrentStudent,
  });
});

/** Hands work in. Handing in again replaces what was there. */
router.post("/monthly/homework/:homeworkId/submit", requireAuth, async (req: Request, res: Response) => {
  const homeworkId = idParam(req, "homeworkId");
  if (homeworkId === null) {
    res.status(400).json({ error: "Invalid homework id" });
    return;
  }
  const [homework] = await db.select().from(homeworkTable).where(eq(homeworkTable.id, homeworkId));
  if (!homework) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const access = await portalAccess(homework.recurringId, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return;
  }
  if (access.isTeacher) {
    res.status(400).json({ error: "You set this homework, so there is nothing for you to hand in." });
    return;
  }
  if (!access.isCurrentStudent) {
    res.status(403).json({ error: "Your month has ended, so you can read this but not hand work in." });
    return;
  }
  if (homework.status !== "open") {
    res.status(409).json({ error: "This homework is closed, so it can no longer be handed in." });
    return;
  }

  const body = req.body as { fileKey?: string; fileType?: string; note?: string };
  if (!body.fileKey) {
    res.status(400).json({ error: "Attach your work before handing it in." });
    return;
  }
  const file = await acceptFile(body.fileKey, body.fileType, req.user!.userId);
  if (!file.ok || !file.key) {
    res.status(400).json({ error: file.ok ? "Attach your work before handing it in." : file.reason });
    return;
  }
  const note = (body.note ?? "").trim() || null;

  /*
   * One answer per student, replaced rather than added to.
   *
   * `onConflictDoUpdate` against `homework_submissions_once_idx`, so a student who uploads a
   * clearer photo has *replaced* their work — the teacher marking it is never looking at two
   * files wondering which is the real one. Replacing also clears the marking, because marking
   * that referred to a page nobody can see any more is worse than no marking.
   */
  const [saved] = await db
    .insert(homeworkSubmissionsTable)
    .values({
      homeworkId,
      studentId: req.user!.userId,
      fileKey: file.key,
      fileType: file.type ?? "application/octet-stream",
      note,
      status: "submitted",
    })
    .onConflictDoUpdate({
      target: [homeworkSubmissionsTable.homeworkId, homeworkSubmissionsTable.studentId],
      set: {
        fileKey: file.key,
        fileType: file.type ?? "application/octet-stream",
        note,
        submittedAt: new Date(),
        status: "submitted",
        feedback: null,
        annotatedKey: null,
        annotatedType: null,
        annotation: null,
        returnedAt: null,
      },
    })
    .returning();

  notifyMany([homework.teacherId], {
    kind: "session_booked",
    at: new Date().toISOString(),
    fromUserId: req.user!.userId,
    topic: `Homework handed in: ${homework.title}`,
  });

  res.status(201).json({ submission: saved });
});

/** Everything handed in for one piece of homework. The teacher's view. */
router.get("/monthly/homework/:homeworkId/submissions", requireAuth, async (req: Request, res: Response) => {
  const homeworkId = idParam(req, "homeworkId");
  if (homeworkId === null) {
    res.status(400).json({ error: "Invalid homework id" });
    return;
  }
  const [homework] = await db.select().from(homeworkTable).where(eq(homeworkTable.id, homeworkId));
  if (!homework) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const access = await portalAccess(homework.recurringId, req.user!.userId);
  if (!access?.isTeacher) {
    res.status(403).json({ error: "Only the teacher can see what the class handed in." });
    return;
  }

  const rows = await db
    .select({
      submission: homeworkSubmissionsTable,
      studentName: usersTable.name,
    })
    .from(homeworkSubmissionsTable)
    .leftJoin(usersTable, eq(usersTable.id, homeworkSubmissionsTable.studentId))
    .where(eq(homeworkSubmissionsTable.homeworkId, homeworkId))
    .orderBy(asc(homeworkSubmissionsTable.id));

  res.json({
    homework,
    submissions: rows.map((r) => ({ ...r.submission, studentName: r.studentName ?? "" })),
  });
});

/**
 * Marks one student's work and hands it back.
 *
 * All three of the owner's ways of answering go through here, and any combination of them is
 * allowed: words, a marked-up file, marks drawn in the app. What is not allowed is returning
 * work with none of them, which would tell a student their homework had been looked at and
 * show them nothing.
 */
router.post("/monthly/submissions/:submissionId/return", requireAuth, async (req: Request, res: Response) => {
  const submissionId = idParam(req, "submissionId");
  if (submissionId === null) {
    res.status(400).json({ error: "Invalid submission id" });
    return;
  }

  const [row] = await db
    .select({ submission: homeworkSubmissionsTable, homework: homeworkTable })
    .from(homeworkSubmissionsTable)
    .innerJoin(homeworkTable, eq(homeworkTable.id, homeworkSubmissionsTable.homeworkId))
    .where(eq(homeworkSubmissionsTable.id, submissionId));
  if (!row) {
    res.status(404).json({ error: "That work was not found." });
    return;
  }

  const access = await portalAccess(row.homework.recurringId, req.user!.userId);
  if (!access?.isTeacher) {
    res.status(403).json({ error: "Only the teacher can mark this." });
    return;
  }

  const body = req.body as {
    feedback?: string; annotatedKey?: string; annotatedType?: string; annotation?: string;
  };
  const feedback = (body.feedback ?? "").trim() || null;
  if (feedback && feedback.length > MAX_FEEDBACK_CHARS) {
    res.status(400).json({ error: `Please keep feedback under ${MAX_FEEDBACK_CHARS} characters.` });
    return;
  }
  const annotation = typeof body.annotation === "string" && body.annotation.length > 0 ? body.annotation : null;
  if (annotation && annotation.length > MAX_ANNOTATION_CHARS) {
    res.status(400).json({ error: "That marking is too large to save." });
    return;
  }

  const marked = await acceptFile(body.annotatedKey, body.annotatedType, req.user!.userId);
  if (!marked.ok) {
    res.status(400).json({ error: marked.reason });
    return;
  }

  if (!feedback && !annotation && !marked.key) {
    res.status(400).json({
      error:
        "Add a comment, some marking, or a marked-up file before handing this back — otherwise " +
        "the student is told it was marked and has nothing to look at.",
    });
    return;
  }

  const [updated] = await db
    .update(homeworkSubmissionsTable)
    .set({
      feedback,
      annotation,
      annotatedKey: marked.key,
      annotatedType: marked.type,
      status: "returned",
      returnedAt: new Date(),
    })
    .where(eq(homeworkSubmissionsTable.id, submissionId))
    .returning();

  // Answered individually, which is what the owner asked for: this goes to one student.
  notifyMany([row.submission.studentId], {
    kind: "session_invite",
    at: new Date().toISOString(),
    fromUserId: req.user!.userId,
    topic: `Your homework has been marked: ${row.homework.title}`,
  });

  res.json({ submission: updated });
});

/** Closes or reopens homework. Closing stops new work coming in without deleting any. */
router.patch("/monthly/homework/:homeworkId", requireAuth, async (req: Request, res: Response) => {
  const homeworkId = idParam(req, "homeworkId");
  if (homeworkId === null) {
    res.status(400).json({ error: "Invalid homework id" });
    return;
  }
  const [homework] = await db.select().from(homeworkTable).where(eq(homeworkTable.id, homeworkId));
  if (!homework) {
    res.status(404).json({ error: "Homework not found" });
    return;
  }
  const access = await portalAccess(homework.recurringId, req.user!.userId);
  if (!access?.isTeacher) {
    res.status(403).json({ error: "Only the teacher can change this." });
    return;
  }

  const { status } = req.body as { status?: string };
  if (status !== "open" && status !== "closed") {
    res.status(400).json({ error: "Homework is either open or closed." });
    return;
  }

  const [updated] = await db
    .update(homeworkTable)
    .set({ status })
    .where(eq(homeworkTable.id, homeworkId))
    .returning();
  res.json({ homework: updated });
});

export default router;
