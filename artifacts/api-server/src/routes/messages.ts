import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  messageAttachmentsTable,
  messageReactionsTable,
  db,
  messagesTable,
  sessionEnrollmentsTable,
  sessionsTable,
  studentTeacherSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { notify } from "../lib/notify";
import { verifyUpload } from "../lib/fileStore";

const router: IRouter = Router();

// GET /conversations — list this user's active conversations, most recent first,
// with the other party's name/role, last message preview, and unread count.
// Aggregation is done in JS (rather than a complex grouped SQL query) since the
// message volume per user is small and this keeps the query portable/simple.
/**
 * Total unread messages for the signed-in user.
 *
 * Kept separate from /conversations so the tab badge can poll cheaply without pulling every
 * message the user has ever exchanged just to count the unread ones.
 */
router.get("/messages/unread-count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(eq(messagesTable.receiverId, userId), eq(messagesTable.read, false)));
  res.json({ unread: row?.count ?? 0 });
});

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;

  const all = await db.select().from(messagesTable)
    .where(or(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, userId)))
    .orderBy(asc(messagesTable.createdAt));

  type Convo = { otherUserId: number; lastMessage: string; lastMessageAt: string; unreadCount: number; lastMessageFromMe: boolean };
  const byOther = new Map<number, Convo>();
  for (const m of all) {
    const otherUserId = m.senderId === userId ? m.receiverId : m.senderId;
    const existing = byOther.get(otherUserId);
    const unreadDelta = m.receiverId === userId && !m.read ? 1 : 0;
    if (!existing) {
      byOther.set(otherUserId, {
        otherUserId,
        lastMessage: m.body,
        lastMessageAt: m.createdAt as unknown as string,
        unreadCount: unreadDelta,
        // Lets the client separate Inbox from Sent without refetching every message.
        lastMessageFromMe: m.senderId === userId,
      });
    } else {
      existing.lastMessage = m.body;
      existing.lastMessageAt = m.createdAt as unknown as string;
      existing.unreadCount += unreadDelta;
      existing.lastMessageFromMe = m.senderId === userId;
    }
  }

  const conversations = [...byOther.values()].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  if (conversations.length === 0) {
    res.json([]);
    return;
  }

  const otherIds = conversations.map((c) => c.otherUserId);
  const others = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable);
  const otherMap = new Map(others.map((o) => [o.id, o]));

  res.json(conversations.map((c) => ({
    ...c,
    otherUserName: otherMap.get(c.otherUserId)?.name ?? "Unknown",
    otherUserRole: otherMap.get(c.otherUserId)?.role ?? null,
  })));
});

// GET /messages/:otherUserId — full thread with a specific user, oldest first.
// Marks messages sent to the current user as read as a side effect.
router.get("/messages/:otherUserId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const otherUserId = parseInt(String(req.params.otherUserId), 10);
  if (isNaN(otherUserId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const thread = await db.select().from(messagesTable)
    .where(or(
      and(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, otherUserId)),
      and(eq(messagesTable.senderId, otherUserId), eq(messagesTable.receiverId, userId)),
    ))
    .orderBy(messagesTable.createdAt);

  await db.update(messagesTable)
    .set({ read: true })
    .where(and(eq(messagesTable.senderId, otherUserId), eq(messagesTable.receiverId, userId), eq(messagesTable.read, false)));

  /**
   * Files and reactions, fetched for the whole thread at once.
   *
   * Two queries rather than two per message: a conversation is read on a cheap phone over a
   * poor connection, and a hundred round trips to decorate a hundred bubbles is the difference
   * between a screen that opens and one that crawls.
   *
   * Both tables are new, so an older database that has not been pushed yet simply has nothing
   * in them — the thread still opens, without decoration, rather than failing.
   */
  const ids = thread.map((m) => m.id);
  const [files, reactions] = ids.length
    ? await Promise.all([
        db.select().from(messageAttachmentsTable).where(inArray(messageAttachmentsTable.messageId, ids)),
        db.select().from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, ids)),
      ])
    : [[], []];

  const filesByMessage = new Map<number, typeof files>();
  for (const f of files) {
    filesByMessage.set(f.messageId, [...(filesByMessage.get(f.messageId) ?? []), f]);
  }
  const reactionsByMessage = new Map<number, typeof reactions>();
  for (const r of reactions) {
    reactionsByMessage.set(r.messageId, [...(reactionsByMessage.get(r.messageId) ?? []), r]);
  }

  res.json(
    thread.map((m) => ({
      ...m,
      attachments: (filesByMessage.get(m.id) ?? []).map((f) => ({
        fileKey: f.fileKey, fileType: f.fileType, fileName: f.fileName,
      })),
      /**
       * Counted, with this reader's own marked.
       *
       * Sending the whole list would mean shipping every reactor's id to both sides of a
       * private conversation for no gain: what a bubble shows is "two 👍, one of them mine".
       */
      reactions: Object.entries(
        (reactionsByMessage.get(m.id) ?? []).reduce<Record<string, number>>((acc, r) => {
          acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([emoji, count]) => ({
        emoji,
        count,
        mine: (reactionsByMessage.get(m.id) ?? []).some((r) => r.emoji === emoji && r.userId === userId),
      })),
    })),
  );
});

/**
 * React to a message, or take a reaction back.
 *
 * One per person per message, replaced rather than stacked — sending the emoji you already put
 * there removes it, which is what a second tap means everywhere else.
 */
router.post("/messages/:messageId/reaction", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const messageId = parseInt(String(req.params.messageId), 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message id" }); return; }

  const { emoji } = req.body as { emoji?: string };
  const chosen = typeof emoji === "string" ? emoji.trim() : "";
  // Length rather than a fixed list: the list is a screen decision and will change, and a
  // server that only accepts six would need changing the first time somebody wants a seventh.
  if (!chosen || [...chosen].length > 4) {
    res.status(400).json({ error: "Pick one reaction." });
    return;
  }

  /** Only the two people in the conversation. A reaction is as private as the message. */
  const [message] = await db
    .select({ senderId: messagesTable.senderId, receiverId: messagesTable.receiverId })
    .from(messagesTable)
    .where(eq(messagesTable.id, messageId));
  if (!message || (message.senderId !== userId && message.receiverId !== userId)) {
    res.status(404).json({ error: "That message was not found." });
    return;
  }

  const [existing] = await db
    .select({ id: messageReactionsTable.id, emoji: messageReactionsTable.emoji })
    .from(messageReactionsTable)
    .where(and(eq(messageReactionsTable.messageId, messageId), eq(messageReactionsTable.userId, userId)));

  if (existing && existing.emoji === chosen) {
    await db.delete(messageReactionsTable).where(eq(messageReactionsTable.id, existing.id));
    res.json({ emoji: null });
    return;
  }
  if (existing) {
    await db.update(messageReactionsTable).set({ emoji: chosen }).where(eq(messageReactionsTable.id, existing.id));
  } else {
    await db.insert(messageReactionsTable).values({ messageId, userId, emoji: chosen }).onConflictDoNothing();
  }
  res.json({ emoji: chosen });
});

// POST /messages/:otherUserId — send a message to a user.
router.post("/messages/:otherUserId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const otherUserId = parseInt(String(req.params.otherUserId), 10);
  const { body, fileKey, fileType, fileName } = req.body as {
    body?: string; fileKey?: string; fileType?: string; fileName?: string;
  };
  const attaching = typeof fileKey === "string" && fileKey.trim().length > 0;

  if (isNaN(otherUserId)) { res.status(400).json({ error: "Invalid user id" }); return; }
  /**
   * A message needs words *or* a file.
   *
   * Sending a photo with no caption is the ordinary case in every messaging app, and requiring
   * a body for it would mean typing something in order to send a picture.
   */
  if ((!body || !body.trim()) && !attaching) {
    res.status(400).json({ error: "Write something, or attach a file." });
    return;
  }
  if (otherUserId === userId) { res.status(400).json({ error: "Cannot message yourself" }); return; }

  const [recipient] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, otherUserId));
  if (!recipient) { res.status(404).json({ error: "Recipient not found" }); return; }

  const [message] = await db.insert(messagesTable).values({
    senderId: userId,
    receiverId: otherUserId,
    body: (body ?? "").trim(),
  }).returning();

  /**
   * The file, checked before it is allowed to be one.
   *
   * `verifyUpload` reads what actually landed in the bucket — who it belongs to, how big it
   * really is, what type it really is. Everything the app said when it asked for the upload
   * link was a claim.
   *
   * A file that fails does not sink the message, for the same reason it does not sink a
   * support report: the words are the message, and losing both is the worst outcome. The
   * sender is told the file did not go.
   */
  let attachmentProblem: string | null = null;
  let attached: { fileKey: string; fileType: string; fileName: string | null } | null = null;
  if (attaching) {
    const verdict = await verifyUpload(fileKey!.trim(), userId);
    if (verdict.ok) {
      const [row] = await db.insert(messageAttachmentsTable).values({
        messageId: message!.id,
        fileKey: fileKey!.trim(),
        // The type the bucket reports, not the one the phone claimed — the claim is what a
        // renamed executable would have lied about, and is already known to be unreliable.
        fileType: verdict.contentType || (typeof fileType === "string" ? fileType : "application/octet-stream"),
        fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim().slice(0, 200) : null,
      }).returning();
      attached = row ? { fileKey: row.fileKey, fileType: row.fileType, fileName: row.fileName } : null;
    } else {
      attachmentProblem = verdict.reason;
      req.log.warn({ userId, key: fileKey, reason: verdict.reason }, "an attachment to a message was refused");
    }
  }

  /**
   * Tell the recipient now, if they are looking at the app.
   *
   * Before this, nothing on the server ever told anyone a message had arrived — the unread
   * badge only moved when the recipient's app next happened to ask. Sending must not depend on
   * announcing, so this cannot throw and is not awaited on the response path.
   */
  const [sender] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  notify(otherUserId, {
    kind: "message",
    fromUserId: userId,
    fromName: sender?.name ?? "Someone",
    // A photo with no caption still has to read as something in a notification.
    preview: message.body ? message.body.slice(0, 140) : attached ? "Sent a file" : "",
    at: new Date(message.createdAt).toISOString(),
  });

  res.status(201).json({
    ...message,
    // What was stored, so the bubble the sender sees is the same one the recipient will.
    attachments: attached ? [attached] : [],
    reactions: [],
    // Travels with the reply so the app can say the message went and the file did not.
    attachmentProblem,
  });
});

/**
 * The people this user could sensibly start a conversation with.
 *
 * Messaging worked in only one direction in practice. A student can open a teacher's profile
 * and message them from there; a teacher had no equivalent anywhere, so the Messages screen
 * listed conversations they could only ever reply to, under an empty state reading "Messages
 * you send or receive will show up here" — true, and useless when there is no way to send one.
 * The owner's case for it is a good one: a teacher who schedules a class wants to tell the
 * students most likely to take it.
 *
 * Two sources, unioned, because either alone would be wrong. Subscription is the relationship
 * the owner named. Enrolment is the one that matters in practice — a student who has paid for
 * your class is someone you must be able to reach, whether or not they ever tapped Follow.
 *
 * This is a convenience, not a gate: `POST /messages/:otherUserId` accepts any real user, and
 * narrowing that is a separate decision with its own consequences for the student-to-teacher
 * direction that already works.
 */
router.get("/message-recipients", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  /** userId -> why they are on the list, for the line under their name. */
  const reasons = new Map<number, string>();
  const note = (id: number, why: string) => {
    if (id !== userId && !reasons.has(id)) reasons.set(id, why);
  };

  if (role === "teacher") {
    const subscribers = await db
      .select({ id: studentTeacherSubscriptionsTable.studentId })
      .from(studentTeacherSubscriptionsTable)
      .where(eq(studentTeacherSubscriptionsTable.teacherId, userId));
    for (const row of subscribers) note(row.id, "Follows you");

    const enrolled = await db
      .select({ id: sessionEnrollmentsTable.studentId })
      .from(sessionEnrollmentsTable)
      .innerJoin(sessionsTable, eq(sessionEnrollmentsTable.sessionId, sessionsTable.id))
      .where(and(eq(sessionsTable.teacherId, userId), eq(sessionEnrollmentsTable.paymentStatus, "paid")));
    for (const row of enrolled) note(row.id, "In your class");
  } else {
    const following = await db
      .select({ id: studentTeacherSubscriptionsTable.teacherId })
      .from(studentTeacherSubscriptionsTable)
      .where(eq(studentTeacherSubscriptionsTable.studentId, userId));
    for (const row of following) note(row.id, "You follow them");

    const teachers = await db
      .select({ id: sessionsTable.teacherId })
      .from(sessionEnrollmentsTable)
      .innerJoin(sessionsTable, eq(sessionEnrollmentsTable.sessionId, sessionsTable.id))
      .where(and(eq(sessionEnrollmentsTable.studentId, userId), eq(sessionEnrollmentsTable.paymentStatus, "paid")));
    for (const row of teachers) note(row.id, "Your teacher");
  }

  const ids = [...reasons.keys()];
  if (ids.length === 0) {
    res.json([]);
    return;
  }

  const people = await db
    .select({ userId: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));

  res.json(
    people
      .map((p) => ({ ...p, note: reasons.get(p.userId) ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
});

export default router;
