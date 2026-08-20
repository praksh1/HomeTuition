import { and, asc, eq, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, messagesTable, usersTable } from "@workspace/db";
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

export default router;
