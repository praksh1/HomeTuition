import { and, asc, eq, gt, gte, ne, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  batchTestSessionsTable,
  batchTestBookingsTable,
  classGroupMessageReadsTable,
  classGroupHomeworkSubmissionsTable,
  classGroupHomeworkTable,
  classGroupMaterialsTable,
  classGroupMessagesTable,
  db,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { classGroupAccess } from "../lib/classGroupAccess";
import { notifyMany } from "../lib/notify";

const router = Router();
const MAX_BODY = 2_000;
const MAX_TITLE = 160;

function idParam(req: Request, name = "id") {
  const value = Number(req.params[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function accessOrReply(req: Request, res: Response) {
  const id = idParam(req);
  if (!id) {
    res.status(400).json({ error: "This class link is not valid." });
    return null;
  }
  const access = await classGroupAccess(id, req.user!.userId);
  if (!access) {
    res.status(403).json({ error: "You do not have access to this class." });
    return null;
  }
  return access;
}

async function unreadMessageCount(
  access: NonNullable<Awaited<ReturnType<typeof accessOrReply>>>,
  userId: number,
) {
  const [read] = await db
    .select({ lastReadMessageId: classGroupMessageReadsTable.lastReadMessageId })
    .from(classGroupMessageReadsTable)
    .where(
      and(
        eq(classGroupMessageReadsTable.batchId, access.batchId),
        eq(classGroupMessageReadsTable.userId, userId),
      ),
    )
    .limit(1);
  const conditions = [
    eq(classGroupMessagesTable.batchId, access.batchId),
    ne(classGroupMessagesTable.senderId, userId),
    gt(classGroupMessagesTable.id, read?.lastReadMessageId ?? 0),
  ];
  if (access.joinedAt) {
    conditions.push(gte(classGroupMessagesTable.createdAt, access.joinedAt));
  }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(classGroupMessagesTable)
    .where(and(...conditions));
  return row?.count ?? 0;
}

async function visibleMessageCount(
  access: NonNullable<Awaited<ReturnType<typeof accessOrReply>>>,
) {
  const conditions = [eq(classGroupMessagesTable.batchId, access.batchId)];
  if (access.joinedAt) {
    conditions.push(gte(classGroupMessagesTable.createdAt, access.joinedAt));
  }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(classGroupMessagesTable)
    .where(and(...conditions));
  return row?.count ?? 0;
}

router.get("/class-groups/:id", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  const lessons = await db
    .select({
      position: batchTestSessionsTable.position,
      sessionId: batchTestSessionsTable.sessionId,
      startsAt: sessionsTable.date,
      durationMinutes: sessionsTable.duration,
    })
    .from(batchTestSessionsTable)
    .innerJoin(
      sessionsTable,
      eq(sessionsTable.id, batchTestSessionsTable.sessionId),
    )
    .where(eq(batchTestSessionsTable.batchId, access.batchId))
    .orderBy(asc(batchTestSessionsTable.position));
  const [counts] = await db
    .select({
      homework: sql<number>`(select count(*)::int from class_group_homework where batch_id=${access.batchId} and status='open')`,
      materials: sql<number>`(select count(*)::int from class_group_materials where batch_id=${access.batchId})`,
    })
    .from(sql`(select 1) as class_group_counts`);
  const [messages, unreadMessages] = await Promise.all([
    visibleMessageCount(access),
    unreadMessageCount(access, req.user!.userId),
  ]);
  res.json({
    title: access.title,
    isTeacher: access.isTeacher,
    lessons,
    counts: { ...counts, messages, unreadMessages },
  });
});

router.get("/class-groups/:id/messages", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  const where = access.joinedAt
    ? and(
        eq(classGroupMessagesTable.batchId, access.batchId),
        gte(classGroupMessagesTable.createdAt, access.joinedAt),
      )
    : eq(classGroupMessagesTable.batchId, access.batchId);
  const messages = await db
    .select()
    .from(classGroupMessagesTable)
    .where(where)
    .orderBy(asc(classGroupMessagesTable.id))
    .limit(250);
  const pinned = access.joinedAt
    ? await db
        .select()
        .from(classGroupMessagesTable)
        .where(
          and(
            eq(classGroupMessagesTable.batchId, access.batchId),
            sql`${classGroupMessagesTable.pinnedAt} is not null`,
          ),
        )
        .orderBy(asc(classGroupMessagesTable.id))
        .limit(20)
    : messages.filter((m) => m.pinnedAt);
  res.json({
    title: access.title,
    isTeacher: access.isTeacher,
    messages,
    pinned,
  });
});

router.post("/class-groups/:id/messages", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > MAX_BODY) {
    res
      .status(400)
      .json({ error: `Write a message under ${MAX_BODY} characters.` });
    return;
  }
  const [user] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));
  const [message] = await db
    .insert(classGroupMessagesTable)
    .values({
      batchId: access.batchId,
      senderId: req.user!.userId,
      senderName: user?.name || "Fadko member",
      senderRole: access.isTeacher ? "teacher" : "student",
      body,
    })
    .returning();
  const students = await db
    .select({ userId: batchTestBookingsTable.studentId })
    .from(batchTestBookingsTable)
    .where(eq(batchTestBookingsTable.batchId, access.batchId));
  // A teacher's update is an announcement to the group. A student's question alerts the
  // teacher, without making every classmate's phone and inbox ring for every reply.
  const audience = (
    access.isTeacher
      ? students.map((row) => row.userId)
      : [access.teacherId]
  ).filter((userId) => userId !== req.user!.userId);
  notifyMany(audience, {
    kind: "class_message",
    batchId: access.batchId,
    fromUserId: req.user!.userId,
    fromName: message.senderName,
    preview: message.body.slice(0, 140),
    topic: access.title,
    at: message.createdAt.toISOString(),
  });
  res.status(201).json(message);
});

router.post("/class-groups/:id/messages/read", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  const lastMessageId = Number(req.body?.lastMessageId);
  if (!Number.isInteger(lastMessageId) || lastMessageId <= 0) {
    res.status(400).json({ error: "This message position is not valid." });
    return;
  }
  const visible = [
    eq(classGroupMessagesTable.id, lastMessageId),
    eq(classGroupMessagesTable.batchId, access.batchId),
  ];
  if (access.joinedAt) {
    visible.push(gte(classGroupMessagesTable.createdAt, access.joinedAt));
  }
  const [message] = await db
    .select({ id: classGroupMessagesTable.id })
    .from(classGroupMessagesTable)
    .where(and(...visible))
    .limit(1);
  if (!message) {
    res.status(409).json({ error: "That message is not part of this class." });
    return;
  }
  await db
    .insert(classGroupMessageReadsTable)
    .values({
      batchId: access.batchId,
      userId: req.user!.userId,
      lastReadMessageId: lastMessageId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        classGroupMessageReadsTable.batchId,
        classGroupMessageReadsTable.userId,
      ],
      set: {
        lastReadMessageId: sql`greatest(${classGroupMessageReadsTable.lastReadMessageId}, ${lastMessageId})`,
        updatedAt: new Date(),
      },
    });
  res.json({
    unreadMessages: await unreadMessageCount(access, req.user!.userId),
  });
});

router.get("/class-groups/:id/homework", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  const tasks = await db
    .select()
    .from(classGroupHomeworkTable)
    .where(eq(classGroupHomeworkTable.batchId, access.batchId))
    .orderBy(asc(classGroupHomeworkTable.id));
  if (access.isTeacher) {
    const submissions = tasks.length
      ? await db
          .select({
            id: classGroupHomeworkSubmissionsTable.id,
            homeworkId: classGroupHomeworkSubmissionsTable.homeworkId,
            studentId: classGroupHomeworkSubmissionsTable.studentId,
            studentName: usersTable.name,
            note: classGroupHomeworkSubmissionsTable.note,
            status: classGroupHomeworkSubmissionsTable.status,
            feedback: classGroupHomeworkSubmissionsTable.feedback,
            submittedAt: classGroupHomeworkSubmissionsTable.submittedAt,
          })
          .from(classGroupHomeworkSubmissionsTable)
          .innerJoin(
            usersTable,
            eq(usersTable.id, classGroupHomeworkSubmissionsTable.studentId),
          )
          .where(
            sql`${classGroupHomeworkSubmissionsTable.homeworkId} in (${sql.join(
              tasks.map((t) => sql`${t.id}`),
              sql`, `,
            )})`,
          )
          .orderBy(asc(classGroupHomeworkSubmissionsTable.id))
      : [];
    res.json({
      title: access.title,
      isTeacher: true,
      tasks: tasks.map((task) => ({
        ...task,
        submissions: submissions.filter((s) => s.homeworkId === task.id),
      })),
    });
    return;
  }
  const submissions = tasks.length
    ? await db
        .select()
        .from(classGroupHomeworkSubmissionsTable)
        .where(
          and(
            eq(classGroupHomeworkSubmissionsTable.studentId, req.user!.userId),
            sql`${classGroupHomeworkSubmissionsTable.homeworkId} in (${sql.join(
              tasks.map((t) => sql`${t.id}`),
              sql`, `,
            )})`,
          ),
        )
    : [];
  res.json({
    title: access.title,
    isTeacher: false,
    tasks: tasks.map((task) => ({
      ...task,
      submission: submissions.find((s) => s.homeworkId === task.id) ?? null,
    })),
  });
});

router.post("/class-groups/:id/homework", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  if (!access.isTeacher) {
    res.status(403).json({ error: "Only the teacher can set homework." });
    return;
  }
  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const instructions =
    typeof req.body?.instructions === "string"
      ? req.body.instructions.trim()
      : "";
  if (!title || title.length > MAX_TITLE || instructions.length > MAX_BODY) {
    res
      .status(400)
      .json({ error: "Add a short homework title and instructions." });
    return;
  }
  const [task] = await db
    .insert(classGroupHomeworkTable)
    .values({
      batchId: access.batchId,
      teacherId: access.teacherId,
      title,
      instructions: instructions || null,
    })
    .returning();
  res.status(201).json(task);
});

router.post(
  "/class-groups/:id/homework/:homeworkId/submit",
  requireAuth,
  async (req, res) => {
    const access = await accessOrReply(req, res);
    if (!access) return;
    if (access.isTeacher) {
      res
        .status(403)
        .json({ error: "Teacher accounts cannot submit student work." });
      return;
    }
    const homeworkId = idParam(req, "homeworkId");
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!homeworkId || !note || note.length > MAX_BODY) {
      res.status(400).json({ error: "Add your answer before handing it in." });
      return;
    }
    const [task] = await db
      .select({
        id: classGroupHomeworkTable.id,
        status: classGroupHomeworkTable.status,
      })
      .from(classGroupHomeworkTable)
      .where(
        and(
          eq(classGroupHomeworkTable.id, homeworkId),
          eq(classGroupHomeworkTable.batchId, access.batchId),
        ),
      );
    if (!task || task.status !== "open") {
      res.status(409).json({ error: "This homework is no longer open." });
      return;
    }
    const [submission] = await db
      .insert(classGroupHomeworkSubmissionsTable)
      .values({ homeworkId, studentId: req.user!.userId, note })
      .onConflictDoUpdate({
        target: [
          classGroupHomeworkSubmissionsTable.homeworkId,
          classGroupHomeworkSubmissionsTable.studentId,
        ],
        set: { note, status: "submitted", submittedAt: new Date() },
      })
      .returning();
    res.json(submission);
  },
);

router.get("/class-groups/:id/materials", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  const materials = await db
    .select()
    .from(classGroupMaterialsTable)
    .where(eq(classGroupMaterialsTable.batchId, access.batchId))
    .orderBy(asc(classGroupMaterialsTable.id));
  res.json({ title: access.title, isTeacher: access.isTeacher, materials });
});

router.post("/class-groups/:id/materials", requireAuth, async (req, res) => {
  const access = await accessOrReply(req, res);
  if (!access) return;
  if (!access.isTeacher) {
    res
      .status(403)
      .json({ error: "Only the teacher can add class materials." });
    return;
  }
  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!title || title.length > MAX_TITLE || note.length > MAX_BODY) {
    res.status(400).json({ error: "Add a short title for this material." });
    return;
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      res.status(400).json({ error: "Use a complete http or https link." });
      return;
    }
  }
  const [material] = await db
    .insert(classGroupMaterialsTable)
    .values({
      batchId: access.batchId,
      teacherId: access.teacherId,
      title,
      note: note || null,
      url: url || null,
    })
    .returning();
  res.status(201).json(material);
});

export default router;
