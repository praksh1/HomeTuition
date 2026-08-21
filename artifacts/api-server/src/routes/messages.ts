import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  messagesTable,
  sessionEnrollmentsTable,
  sessionsTable,
  studentTeacherSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { notify } from "../lib/notify";

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

  res.json(thread);
});

// POST /messages/:otherUserId — send a message to a user.
router.post("/messages/:otherUserId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const otherUserId = parseInt(String(req.params.otherUserId), 10);
  const { body } = req.body as { body?: string };

  if (isNaN(otherUserId)) { res.status(400).json({ error: "Invalid user id" }); return; }
  if (!body || !body.trim()) { res.status(400).json({ error: "Message body is required" }); return; }
  if (otherUserId === userId) { res.status(400).json({ error: "Cannot message yourself" }); return; }

  const [recipient] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, otherUserId));
  if (!recipient) { res.status(404).json({ error: "Recipient not found" }); return; }

  const [message] = await db.insert(messagesTable).values({
    senderId: userId,
    receiverId: otherUserId,
    body: body.trim(),
  }).returning();

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
    preview: message.body.slice(0, 140),
    at: new Date(message.createdAt).toISOString(),
  });

  res.status(201).json(message);
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
