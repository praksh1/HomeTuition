import { and, asc, eq, gt } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  sessionEnrollmentsTable,
  sessionMessagesTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getSessionMembership } from "../lib/membership";
import {
  attachToClassMessage,
  decorateClassMessages,
  readReaction,
  reactToClassMessage,
} from "../lib/classMessageExtras";
import { notifyUsers } from "../ws/userHub";
import { recordActivity } from "../lib/activityLog";

/**
 * The message thread that belongs to a class.
 *
 * See the table's own comment in lib/db/src/schema/sessionMessages.ts for why this is not the
 * classroom chat. In short: that one is a conversation during a call and vanishes with the
 * room; this one is a conversation about a class, and has to outlive the lesson because a
 * teacher's "running ten minutes late" and a refund argued three weeks later both depend on it
 * still being there.
 */

const router: IRouter = Router();

/** Long enough for a real explanation, short enough that nobody posts an essay to a class. */
const MAX_BODY_CHARS = 2_000;
/** One screenful of history on first open; the app asks for more by id if it needs it. */
const DEFAULT_LIMIT = 200;

/**
 * Who may read and write this thread: the teacher who owns the class, or a student who paid
 * for it.
 *
 * Deliberately not `canAccessSession`, which answers "may this person be in the room right
 * now" and is false for everybody once the class is over. The thread is most needed *after* —
 * that is when a refund is argued — so the rule is the one the attendance register uses: a
 * place in the class, not a place in the room.
 */
async function threadAccess(sessionId: number, userId: number) {
  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) return null;
  // A student who dropped or was refunded keeps the thread they were part of — read-only, see
  // `mayPost`. Cutting them off at the moment of the refund would take away the record of the
  // class exactly when they most need it, which is when they are arguing about that refund.
  if (!membership.isSessionTeacher && !membership.hasPaid && !membership.wasRefunded) return null;
  return membership;
}

/**
 * Reading is not writing.
 *
 * Somebody who is no longer in the class may still read what was said in it, but posting into
 * a class you have left is neither theirs to do nor something the people still in it asked for.
 */
function mayPost(membership: { isSessionTeacher: boolean; hasPaid: boolean }): boolean {
  return membership.isSessionTeacher || membership.hasPaid;
}

/** Everyone who should hear about a new message: the teacher and every paying student. */
async function participantIds(sessionId: number): Promise<number[]> {
  const [session] = await db
    .select({ teacherId: sessionsTable.teacherId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) return [];

  const students = await db
    .select({ studentId: sessionEnrollmentsTable.studentId })
    .from(sessionEnrollmentsTable)
    .where(
      and(
        eq(sessionEnrollmentsTable.sessionId, sessionId),
        eq(sessionEnrollmentsTable.paymentStatus, "paid"),
      ),
    );

  return [session.teacherId, ...students.map((s) => s.studentId)];
}

router.get("/sessions/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const membership = await threadAccess(id, req.user!.userId);
  if (!membership) {
    res.status(403).json({ error: "You do not have access to this session." });
    return;
  }

  // `after` lets a page that is already open catch up on what it has not seen, rather than
  // re-reading the whole thread every few seconds on a phone with a poor connection.
  const after = parseInt(String(req.query.after ?? ""), 10);

  try {
    const messages = await db
      .select({
        id: sessionMessagesTable.id,
        senderId: sessionMessagesTable.senderId,
        senderName: sessionMessagesTable.senderName,
        senderRole: sessionMessagesTable.senderRole,
        body: sessionMessagesTable.body,
        createdAt: sessionMessagesTable.createdAt,
      })
      .from(sessionMessagesTable)
      .where(
        Number.isFinite(after)
          ? and(eq(sessionMessagesTable.sessionId, id), gt(sessionMessagesTable.id, after))
          : eq(sessionMessagesTable.sessionId, id),
      )
      .orderBy(asc(sessionMessagesTable.id))
      .limit(DEFAULT_LIMIT);

    const decorated = await decorateClassMessages(messages, req.user!.userId);

    res.json({
      messages: decorated.map((m) => ({ ...m, mine: m.senderId === req.user!.userId })),
      // So the app hides the composer rather than offering a box whose Send button is refused.
      readOnly: !mayPost(membership),
      // Told apart from "no messages" so the app can say "we could not load these" rather than
      // showing an empty thread, which reads as "nobody said anything".
      known: true,
    });
  } catch (err) {
    req.log.warn({ err, sessionId: id }, "could not read the session thread");
    res.status(503).json({ error: "Messages are unavailable right now.", known: false });
  }
});

router.post("/sessions/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session ID" }); return; }

  const membership = await threadAccess(id, req.user!.userId);
  if (!membership) {
    res.status(403).json({ error: "You do not have access to this session." });
    return;
  }
  if (!mayPost(membership)) {
    res.status(403).json({
      error: "You are no longer in this class, so you can read this thread but not post to it.",
    });
    return;
  }

  const { body, fileKey, fileType, fileName } = req.body as {
    body?: string; fileKey?: string; fileType?: string; fileName?: string;
  };
  const text = typeof body === "string" ? body.trim() : "";
  const attaching = typeof fileKey === "string" && fileKey.trim().length > 0;
  // A photo of your working, with no caption, is the commonest thing anybody sends a teacher.
  if (!text && !attaching) {
    res.status(400).json({ error: "Write something, or attach a file." });
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

  // The classroom role, not the account role: a teacher who booked somebody else's class is a
  // student in it, and the thread should not badge them as that class's teacher.
  const senderRole = membership.isSessionTeacher ? "teacher" : "student";

  const [message] = await db
    .insert(sessionMessagesTable)
    .values({
      sessionId: id,
      senderId: req.user!.userId,
      senderName: sender?.name ?? "Someone",
      senderRole,
      body: text,
    })
    .returning();

  /**
   * The file, checked before it is allowed to be one — see `attachToClassMessage`. A refused
   * file does not take the words with it.
   */
  const { attached, problem: attachmentProblem } = attaching
    ? await attachToClassMessage({
        messageId: message!.id,
        userId: req.user!.userId,
        fileKey: fileKey!,
        fileType,
        fileName,
      })
    : { attached: null, problem: null };
  if (attachmentProblem) {
    req.log.warn(
      { userId: req.user!.userId, key: fileKey, reason: attachmentProblem },
      "an attachment to a class message was refused",
    );
  }

  /**
   * Delivered live down the channel the app already holds, rather than over a second socket.
   *
   * A signed-in app keeps one connection open for notifications; the session page listens on
   * it. That means a message arrives on a page that is already open without either side
   * polling, and a page that was closed picks it up from the GET above when it reopens.
   */
  const audience = (await participantIds(id)).filter((userId) => userId !== req.user!.userId);
  notifyUsers(audience, {
    kind: "session_message",
    sessionId: id,
    fromUserId: req.user!.userId,
    fromName: message.senderName,
    // A photo with no caption still has to read as something in a notification.
    preview: text ? text.slice(0, 140) : attached ? "Sent a file" : "",
    at: message.createdAt.toISOString(),
  });

  void recordActivity({
    userId: req.user!.userId,
    action: "session_message.sent",
    subjectType: "session",
    subjectId: id,
    detail: { length: text.length, recipients: audience.length },
  });

  res.status(201).json({
    ...message,
    mine: true,
    attachments: attached ? [attached] : [],
    reactions: [],
    // Travels with the reply so the app can say the message went and the file did not.
    attachmentProblem,
  });
});

/**
 * React to something said in a class.
 *
 * Only somebody who may read the thread, which is the same gate as reading it — a reaction is
 * as private as the message it sits on.
 */
router.post("/sessions/:id/messages/:messageId/reaction", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const messageId = parseInt(String(req.params.messageId), 10);
  if (isNaN(id) || isNaN(messageId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const membership = await threadAccess(id, req.user!.userId);
  if (!membership) {
    res.status(403).json({ error: "You do not have access to this session." });
    return;
  }

  const emoji = readReaction((req.body as { emoji?: unknown }).emoji);
  if (!emoji) { res.status(400).json({ error: "Pick one reaction." }); return; }

  /** The message has to be in *this* thread — an id from another class is not theirs to react to. */
  const [message] = await db
    .select({ id: sessionMessagesTable.id })
    .from(sessionMessagesTable)
    .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, id)));
  if (!message) { res.status(404).json({ error: "That message was not found." }); return; }

  res.json({ emoji: await reactToClassMessage(messageId, req.user!.userId, emoji) });
});

export default router;
