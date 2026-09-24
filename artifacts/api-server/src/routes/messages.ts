import { and, asc, desc, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  batchTestBookingsTable,
  classGroupMessageReadsTable,
  classGroupMessagesTable,
  messageAttachmentsTable,
  messageReactionsTable,
  db,
  learningProgramBatchesTable,
  learningProgramsTable,
  messagesTable,
  sessionEnrollmentsTable,
  sessionsTable,
  studentTeacherSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { notify, syncConversation } from "../lib/notify";
import { verifyUpload } from "../lib/fileStore";
import { ensureMessageSafety, lockMessagePair, messageAccess } from "../lib/messageSafety";

const router: IRouter = Router();

const messageUserId = (value: unknown) => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647 ? Number(value) : null;

router.get("/messages/:otherUserId/access", requireAuth, async (req, res): Promise<void> => {
  const otherId = messageUserId(req.params.otherUserId);
  if (!otherId || otherId === req.user!.userId) { res.status(400).json({ error: "Choose another person." }); return; }
  await ensureMessageSafety();
  res.json(await messageAccess(db, req.user!.userId, otherId));
});

router.post("/messages/:otherUserId/block", requireAuth, async (req, res): Promise<void> => {
  const otherId = messageUserId(req.params.otherUserId);
  const userId = req.user!.userId;
  if (!otherId || otherId === userId || typeof req.body?.blocked !== "boolean") { res.status(400).json({ error: "Choose another person and a block setting." }); return; }
  await ensureMessageSafety();
  const result = await db.transaction(async tx => {
    await lockMessagePair(tx, userId, otherId);
    const [other] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, otherId));
    if (!other) return null;
    if (req.body.blocked) await tx.execute(sql`INSERT INTO message_blocks(user_id, blocked_user_id) VALUES (${userId}, ${otherId}) ON CONFLICT DO NOTHING`);
    else await tx.execute(sql`DELETE FROM message_blocks WHERE user_id = ${userId} AND blocked_user_id = ${otherId}`);
    return messageAccess(tx, userId, otherId);
  });
  if (!result) { res.status(404).json({ error: "This conversation is not available." }); return; }
  syncConversation([userId], { fromUserId: otherId, at: new Date().toISOString() });
  syncConversation([otherId], { fromUserId: userId, at: new Date().toISOString() });
  res.json(result);
});

type DirectConversation = {
  otherUserId: number;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  lastMessageFromMe: boolean;
  otherUserName: string;
  otherUserRole: string | null;
};

async function directConversations(userId: number): Promise<DirectConversation[]> {
  const all = await db.select().from(messagesTable)
    .where(or(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, userId)))
    .orderBy(asc(messagesTable.createdAt));

  type Convo = Omit<DirectConversation, "otherUserName" | "otherUserRole">;
  const byOther = new Map<number, Convo>();
  for (const message of all) {
    const otherUserId = message.senderId === userId ? message.receiverId : message.senderId;
    const existing = byOther.get(otherUserId);
    const unreadDelta = message.receiverId === userId && !message.read ? 1 : 0;
    if (!existing) {
      byOther.set(otherUserId, {
        otherUserId,
        lastMessage: message.body,
        lastMessageAt: message.createdAt as unknown as string,
        unreadCount: unreadDelta,
        lastMessageFromMe: message.senderId === userId,
      });
      continue;
    }
    existing.lastMessage = message.body;
    existing.lastMessageAt = message.createdAt as unknown as string;
    existing.unreadCount += unreadDelta;
    existing.lastMessageFromMe = message.senderId === userId;
  }

  const conversations = [...byOther.values()].sort((a, b) =>
    a.lastMessageAt < b.lastMessageAt ? 1 : -1,
  );
  if (!conversations.length) return [];

  const others = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.id, conversations.map((conversation) => conversation.otherUserId)));
  const otherMap = new Map(others.map((other) => [other.id, other]));
  return conversations.map((conversation) => ({
    ...conversation,
    otherUserName: otherMap.get(conversation.otherUserId)?.name ?? "Unknown",
    otherUserRole: otherMap.get(conversation.otherUserId)?.role ?? null,
  }));
}

type ClassGroupRow = {
  batchId: number;
  title: string | null;
  publishedSnapshot: unknown;
  createdAt: Date;
};

function classTitle(group: ClassGroupRow): string {
  const snapshot = group.publishedSnapshot as { title?: unknown } | null;
  return typeof snapshot?.title === "string" && snapshot.title.trim()
    ? snapshot.title.trim()
    : group.title?.trim() || "Your class";
}

/**
 * One row for every booked class discussion the signed-in person may open.
 *
 * The class can appear before its first message so Messages is a real doorway into the group,
 * not merely a history of groups somebody happened to speak in. Teacher rows are limited to
 * classes with at least one booking; a catalogue of empty draft classes does not belong here.
 */
async function classConversations(userId: number, role: string) {
  let groups: ClassGroupRow[];
  if (role === "teacher") {
    groups = await db
      .selectDistinctOn([learningProgramBatchesTable.id], {
        batchId: learningProgramBatchesTable.id,
        title: learningProgramsTable.title,
        publishedSnapshot: learningProgramsTable.publishedSnapshot,
        createdAt: learningProgramBatchesTable.createdAt,
      })
      .from(batchTestBookingsTable)
      .innerJoin(
        learningProgramBatchesTable,
        eq(learningProgramBatchesTable.id, batchTestBookingsTable.batchId),
      )
      .innerJoin(
        learningProgramsTable,
        eq(learningProgramsTable.id, learningProgramBatchesTable.programId),
      )
      .where(eq(learningProgramsTable.teacherId, userId))
      .orderBy(learningProgramBatchesTable.id, desc(batchTestBookingsTable.createdAt));
  } else if (role === "student") {
    groups = await db
      .select({
        batchId: learningProgramBatchesTable.id,
        title: learningProgramsTable.title,
        publishedSnapshot: learningProgramsTable.publishedSnapshot,
        createdAt: learningProgramBatchesTable.createdAt,
      })
      .from(batchTestBookingsTable)
      .innerJoin(
        learningProgramBatchesTable,
        eq(learningProgramBatchesTable.id, batchTestBookingsTable.batchId),
      )
      .innerJoin(
        learningProgramsTable,
        eq(learningProgramsTable.id, learningProgramBatchesTable.programId),
      )
      .where(eq(batchTestBookingsTable.studentId, userId));
  } else {
    return [];
  }

  if (!groups.length) return [];
  const batchIds = groups.map((group) => group.batchId);
  const lastMessages = role === "student"
    ? await db
        .selectDistinctOn([classGroupMessagesTable.batchId], {
          batchId: classGroupMessagesTable.batchId,
          senderId: classGroupMessagesTable.senderId,
          senderName: classGroupMessagesTable.senderName,
          body: classGroupMessagesTable.body,
          createdAt: classGroupMessagesTable.createdAt,
        })
        .from(classGroupMessagesTable)
        .innerJoin(
          batchTestBookingsTable,
          and(
            eq(batchTestBookingsTable.batchId, classGroupMessagesTable.batchId),
            eq(batchTestBookingsTable.studentId, userId),
            gte(classGroupMessagesTable.createdAt, batchTestBookingsTable.createdAt),
          ),
        )
        .where(inArray(classGroupMessagesTable.batchId, batchIds))
        .orderBy(classGroupMessagesTable.batchId, desc(classGroupMessagesTable.id))
    : await db
        .selectDistinctOn([classGroupMessagesTable.batchId], {
          batchId: classGroupMessagesTable.batchId,
          senderId: classGroupMessagesTable.senderId,
          senderName: classGroupMessagesTable.senderName,
          body: classGroupMessagesTable.body,
          createdAt: classGroupMessagesTable.createdAt,
        })
        .from(classGroupMessagesTable)
        .where(inArray(classGroupMessagesTable.batchId, batchIds))
        .orderBy(classGroupMessagesTable.batchId, desc(classGroupMessagesTable.id));

  const unreadRows = role === "student"
    ? await db
        .select({
          batchId: classGroupMessagesTable.batchId,
          count: sql<number>`count(*)::int`,
        })
        .from(classGroupMessagesTable)
        .innerJoin(
          batchTestBookingsTable,
          and(
            eq(batchTestBookingsTable.batchId, classGroupMessagesTable.batchId),
            eq(batchTestBookingsTable.studentId, userId),
            gte(classGroupMessagesTable.createdAt, batchTestBookingsTable.createdAt),
          ),
        )
        .leftJoin(
          classGroupMessageReadsTable,
          and(
            eq(classGroupMessageReadsTable.batchId, classGroupMessagesTable.batchId),
            eq(classGroupMessageReadsTable.userId, userId),
          ),
        )
        .where(
          and(
            inArray(classGroupMessagesTable.batchId, batchIds),
            ne(classGroupMessagesTable.senderId, userId),
            gt(
              classGroupMessagesTable.id,
              sql<number>`coalesce(${classGroupMessageReadsTable.lastReadMessageId}, 0)`,
            ),
          ),
        )
        .groupBy(classGroupMessagesTable.batchId)
    : await db
        .select({
          batchId: classGroupMessagesTable.batchId,
          count: sql<number>`count(*)::int`,
        })
        .from(classGroupMessagesTable)
        .leftJoin(
          classGroupMessageReadsTable,
          and(
            eq(classGroupMessageReadsTable.batchId, classGroupMessagesTable.batchId),
            eq(classGroupMessageReadsTable.userId, userId),
          ),
        )
        .where(
          and(
            inArray(classGroupMessagesTable.batchId, batchIds),
            ne(classGroupMessagesTable.senderId, userId),
            gt(
              classGroupMessagesTable.id,
              sql<number>`coalesce(${classGroupMessageReadsTable.lastReadMessageId}, 0)`,
            ),
          ),
        )
        .groupBy(classGroupMessagesTable.batchId);

  const lastByBatch = new Map(lastMessages.map((message) => [message.batchId, message]));
  const unreadByBatch = new Map(unreadRows.map((row) => [row.batchId, row.count]));
  return groups.map((group) => {
    const last = lastByBatch.get(group.batchId);
    return {
      batchId: group.batchId,
      title: classTitle(group),
      lastMessage: last?.body ?? "",
      lastMessageAt: last?.createdAt ?? null,
      lastSenderName: last?.senderName ?? null,
      unreadCount: unreadByBatch.get(group.batchId) ?? 0,
      lastMessageFromMe: last?.senderId === userId,
    };
  });
}

/**
 * Total unread messages from every purchased class the person may open.
 *
 * This is deliberately a count query rather than `classConversations(...).reduce(...)`:
 * the floating tab badge is present throughout the app, so fetching titles and last-message
 * previews every time its durable count is reconciled would make a tiny badge unnecessarily
 * expensive. `count(distinct ...)` also prevents a class with more than one booking from
 * multiplying a teacher's unread total through the booking join.
 */
async function unreadClassMessageTotal(userId: number, role: string): Promise<number> {
  const readJoin = and(
    eq(classGroupMessageReadsTable.batchId, classGroupMessagesTable.batchId),
    eq(classGroupMessageReadsTable.userId, userId),
  );
  const unread = and(
    ne(classGroupMessagesTable.senderId, userId),
    gt(
      classGroupMessagesTable.id,
      sql<number>`coalesce(${classGroupMessageReadsTable.lastReadMessageId}, 0)`,
    ),
  );

  if (role === "teacher") {
    const [row] = await db
      .select({ count: sql<number>`count(distinct ${classGroupMessagesTable.id})::int` })
      .from(classGroupMessagesTable)
      .innerJoin(
        learningProgramBatchesTable,
        eq(learningProgramBatchesTable.id, classGroupMessagesTable.batchId),
      )
      .innerJoin(
        learningProgramsTable,
        eq(learningProgramsTable.id, learningProgramBatchesTable.programId),
      )
      .innerJoin(
        batchTestBookingsTable,
        eq(batchTestBookingsTable.batchId, classGroupMessagesTable.batchId),
      )
      .leftJoin(classGroupMessageReadsTable, readJoin)
      .where(and(eq(learningProgramsTable.teacherId, userId), unread));
    return row?.count ?? 0;
  }

  if (role === "student") {
    const [row] = await db
      .select({ count: sql<number>`count(distinct ${classGroupMessagesTable.id})::int` })
      .from(classGroupMessagesTable)
      .innerJoin(
        batchTestBookingsTable,
        and(
          eq(batchTestBookingsTable.batchId, classGroupMessagesTable.batchId),
          eq(batchTestBookingsTable.studentId, userId),
          gte(classGroupMessagesTable.createdAt, batchTestBookingsTable.createdAt),
        ),
      )
      .leftJoin(classGroupMessageReadsTable, readJoin)
      .where(unread);
    return row?.count ?? 0;
  }

  return 0;
}

// GET /conversations — list this user's active conversations, most recent first,
// with the other party's name/role, last message preview, and unread count.
// Aggregation is done in JS (rather than a complex grouped SQL query) since the
// message volume per user is small and this keeps the query portable/simple.
/**
 * Total unread messages for the signed-in user.
 *
 * Kept separate from /conversations so the tab badge can reconcile cheaply without pulling
 * names, previews and timestamps. Direct and class discussions share one Messages tab, so its
 * number must be the combined total rather than silently omitting class questions.
 */
router.get("/messages/unread-count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [[direct], classes] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(and(eq(messagesTable.receiverId, userId), eq(messagesTable.read, false))),
    unreadClassMessageTotal(userId, req.user!.role),
  ]);
  res.json({ unread: (direct?.count ?? 0) + classes });
});

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  res.json(await directConversations(req.user!.userId));
});

/**
 * One request for the entire Messages home.
 *
 * Fetching direct conversations and class discussions in the server process avoids two mobile
 * round trips and gives the app one coherent failure/retry state. The older `/conversations`
 * response remains available for already-installed clients during rollout.
 */
router.get("/message-inbox", requireAuth, async (req, res): Promise<void> => {
  const [direct, classes] = await Promise.all([
    directConversations(req.user!.userId),
    classConversations(req.user!.userId, req.user!.role),
  ]);
  res.json({ direct, classes });
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
  const messageId = messageUserId(req.params.messageId);
  if (!messageId) { res.status(400).json({ error: "Invalid message id" }); return; }

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

  await ensureMessageSafety();
  const result = await db.transaction(async tx => {
    const otherId = message.senderId === userId ? message.receiverId : message.senderId;
    await lockMessagePair(tx, userId, otherId);
    const access = await messageAccess(tx, userId, otherId);
    if (!access.canSend) return { error: access.reason, emoji: null };
    const [existing] = await tx
      .select({ id: messageReactionsTable.id, emoji: messageReactionsTable.emoji })
      .from(messageReactionsTable)
      .where(and(eq(messageReactionsTable.messageId, messageId), eq(messageReactionsTable.userId, userId)));

    if (existing && existing.emoji === chosen) {
      await tx.delete(messageReactionsTable).where(eq(messageReactionsTable.id, existing.id));
      return { error: null, emoji: null };
    }
    if (existing) {
      await tx.update(messageReactionsTable).set({ emoji: chosen }).where(eq(messageReactionsTable.id, existing.id));
    } else {
      await tx.insert(messageReactionsTable).values({ messageId, userId, emoji: chosen }).onConflictDoNothing();
    }
    return { error: null, emoji: chosen };
  });
  if (result.error) { res.status(403).json({ error: result.error }); return; }
  res.json({ emoji: result.emoji });
});

// POST /messages/:otherUserId — send a message to a user.
router.post("/messages/:otherUserId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const otherUserId = messageUserId(req.params.otherUserId);
  const { body, fileKey, fileType, fileName } = req.body as {
    body?: string; fileKey?: string; fileType?: string; fileName?: string;
  };
  const attaching = typeof fileKey === "string" && fileKey.trim().length > 0;

  if (!otherUserId) { res.status(400).json({ error: "Invalid user id" }); return; }
  if (body !== undefined && (typeof body !== "string" || body.length > 5000)) { res.status(400).json({ error: "Keep messages under 5,000 characters." }); return; }
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

  await ensureMessageSafety();
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fadko-dm-rate'), ${userId})`);
    await lockMessagePair(tx, userId, otherUserId);
    const access = await messageAccess(tx, userId, otherUserId);
    if (!access.canSend) return { status: 403, error: access.reason, message: null };
    const [recent] = await tx.select({ total: sql<number>`count(*)::int` }).from(messagesTable)
      .where(and(eq(messagesTable.senderId, userId), gt(messagesTable.createdAt, new Date(Date.now() - 60_000))));
    if (recent.total >= 30) return { status: 429, error: "Please wait a moment before sending more messages.", message: null };
    const [message] = await tx.insert(messagesTable).values({ senderId: userId, receiverId: otherUserId, body: (body ?? "").trim() }).returning();
    return { status: 201, error: null, message };
  });
  if (!result.message) { res.status(result.status).json({ error: result.error }); return; }
  const message = result.message;

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

  const at = new Date(message.createdAt).toISOString();
  // Both accounts receive a live-only nudge. On the sender's other devices the conversation
  // partner is the recipient; on the recipient's devices it is the sender.
  syncConversation([otherUserId], { fromUserId: userId, at });
  syncConversation([userId], { fromUserId: otherUserId, at });

  notify(otherUserId, {
    kind: "message",
    fromUserId: userId,
    fromName: sender?.name ?? "Someone",
    // A photo with no caption still has to read as something in a notification.
    preview: message.body ? message.body.slice(0, 140) : attached ? "Sent a file" : "",
    at,
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
 * This is a convenience, not the authorization gate. Sending independently checks account
 * status and bilateral blocking; student-to-student messages also require shared enrollment.
 * The existing student-to-teacher discovery path remains available.
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
