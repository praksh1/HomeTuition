import { createHash, randomInt } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  disputesTable,
  passwordResetsTable,
  sessionMessagesTable,
  sessionsTable,
  teacherProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { recordActivity, readActivity } from "../lib/activityLog";
import { attendanceFor, enrolledStudents } from "../lib/participation";
import { findingsFor } from "../lib/sessionEvidence";
import { activityFor } from "../lib/sessionLifecycle";
import { hashPassword } from "../lib/auth";
import { notify } from "../lib/notify";

/**
 * The support desk.
 *
 * Everything a customer-care agent needs to answer a complaint, in one place: the ticket, the
 * evidence behind it, and the four things they might have to do about it — reset a password,
 * review a teacher's credentials, suspend an account, or write down a decision.
 *
 * Two principles run through all of it.
 *
 * **An agent sees what happened, not a summary of it.** Every ticket that names a class comes
 * with that class's attendance record, its message thread, and the plainly-stated findings from
 * lib/sessionEvidence.ts. REFUNDS.md is explicit that the outcome is a person's decision rather
 * than a rule's, and a person deciding needs the evidence rather than a verdict.
 *
 * **Every action here is written down.** The audit log is not a nice-to-have on this router; a
 * tool that can suspend accounts and reset passwords is one where "who did this" has to be
 * answerable afterwards, and the agent using it is exactly as accountable as the users are.
 */

const router: IRouter = Router();

/** Everything under /admin needs both: signed in, and an agent right now. */
router.use("/admin", requireAuth, requireAdmin);

/** How long a reset code read out over the phone stays good for. */
const RESET_CODE_MINUTES = 30;

/** The address the request came from, for the log. */
function callerIp(req: { headers: Record<string, unknown>; ip?: string }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? null;
  return req.ip ?? null;
}

router.get("/admin/overview", async (_req, res): Promise<void> => {
  try {
    const [[open], [pending], [suspended]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(disputesTable).where(eq(disputesTable.status, "open")),
      db.select({ n: sql<number>`count(*)::int` }).from(teacherProfilesTable).where(eq(teacherProfilesTable.approvalStatus, "pending")),
      db.select({ n: sql<number>`count(*)::int` }).from(usersTable).where(sql`${usersTable.suspendedAt} is not null`),
    ]);
    res.json({ openTickets: open?.n ?? 0, pendingTeachers: pending?.n ?? 0, suspendedAccounts: suspended?.n ?? 0, known: true });
  } catch (err) {
    // An agent must be able to tell "nothing to do" from "we could not look".
    res.status(503).json({ openTickets: 0, pendingTeachers: 0, suspendedAccounts: 0, known: false });
  }
});

router.get("/admin/tickets", async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "");
  const rows = await db
    .select({
      id: disputesTable.id,
      reason: disputesTable.reason,
      description: disputesTable.description,
      status: disputesTable.status,
      createdAt: disputesTable.createdAt,
      sessionId: disputesTable.sessionId,
      reporterId: disputesTable.userId,
      reporterName: usersTable.name,
      reporterRole: usersTable.role,
    })
    .from(disputesTable)
    .leftJoin(usersTable, eq(usersTable.id, disputesTable.userId))
    .where(status === "open" || status === "in_review" || status === "resolved"
      ? eq(disputesTable.status, status)
      : sql`true`)
    .orderBy(desc(disputesTable.id))
    .limit(100);
  res.json({ tickets: rows });
});

/**
 * One ticket, with everything behind it.
 *
 * The whole point of the support desk: an agent should not have to go and find the class, the
 * attendance, the thread and the reporter's history in four different places, because an agent
 * who has to do that will decide without them.
 */
router.get("/admin/tickets/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket id" }); return; }

  const [ticket] = await db
    .select({
      id: disputesTable.id,
      reason: disputesTable.reason,
      description: disputesTable.description,
      evidenceUrl: disputesTable.evidenceUrl,
      status: disputesTable.status,
      resolution: disputesTable.resolution,
      resolvedAt: disputesTable.resolvedAt,
      createdAt: disputesTable.createdAt,
      sessionId: disputesTable.sessionId,
      reporterId: disputesTable.userId,
      reporterName: usersTable.name,
      reporterEmail: usersTable.email,
      reporterRole: usersTable.role,
      reporterSuspendedAt: usersTable.suspendedAt,
    })
    .from(disputesTable)
    .leftJoin(usersTable, eq(usersTable.id, disputesTable.userId))
    .where(eq(disputesTable.id, id));

  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

  let session = null;
  let attendance: Awaited<ReturnType<typeof attendanceFor>> = { known: false, rows: [] };
  let findings: ReturnType<typeof findingsFor> = [];
  let messages: { senderName: string; senderRole: string; body: string; createdAt: Date }[] = [];

  if (ticket.sessionId !== null) {
    const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, ticket.sessionId));
    if (row) {
      const activity = await activityFor(row.id);
      session = { ...row, endedAt: activity.endedAt };
      attendance = await attendanceFor(row.id);
      const paid = await enrolledStudents(row.id);
      if (attendance.known) {
        findings = findingsFor(
          { date: row.date, duration: row.duration, startedAt: row.startedAt, endedAt: activity.endedAt },
          attendance.rows,
          paid.map((p) => ({ userId: p.userId, name: p.name })),
        );
      }
      /**
       * The class's message thread, which the owner named as evidence when asking for it.
       *
       * Shown in full rather than summarised: what somebody actually wrote, and when, is the
       * thing being judged.
       */
      messages = await db
        .select({
          senderName: sessionMessagesTable.senderName,
          senderRole: sessionMessagesTable.senderRole,
          body: sessionMessagesTable.body,
          createdAt: sessionMessagesTable.createdAt,
        })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.sessionId, row.id))
        .orderBy(asc(sessionMessagesTable.id))
        .limit(500);
    }
  }

  const reporterActivity = await readActivity({ userId: ticket.reporterId ?? undefined, limit: 40 });

  recordActivity({
    userId: req.user!.userId,
    action: "admin.ticket.viewed",
    subjectType: "dispute",
    subjectId: id,
    ip: callerIp(req),
  });

  res.json({ ticket, session, attendance, findings, messages, reporterActivity });
});

router.patch("/admin/tickets/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket id" }); return; }

  const { status, resolution } = req.body as { status?: string; resolution?: string };
  if (status !== undefined && !["open", "in_review", "resolved"].includes(status)) {
    res.status(400).json({ error: "status must be open, in_review or resolved" });
    return;
  }
  /**
   * Closing a ticket takes an explanation.
   *
   * A ticket that moves to "resolved" with nothing written tells the next person nothing —
   * not what was found, not what was done, not who to ask. It is also what an appeal is
   * argued against, and REFUNDS.md promises the student one.
   */
  const text = typeof resolution === "string" ? resolution.trim() : "";
  if (status === "resolved" && !text) {
    res.status(400).json({ error: "Please say what was decided before closing this ticket." });
    return;
  }

  const [updated] = await db
    .update(disputesTable)
    .set({
      ...(status ? { status: status as "open" | "in_review" | "resolved" } : {}),
      ...(text ? { resolution: text, resolvedBy: req.user!.userId, resolvedAt: new Date() } : {}),
    })
    .where(eq(disputesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Ticket not found" }); return; }

  recordActivity({
    userId: req.user!.userId,
    action: `admin.ticket.${status ?? "noted"}`,
    subjectType: "dispute",
    subjectId: id,
    detail: { status, resolution: text || undefined },
    ip: callerIp(req),
  });

  // The person who reported it is told there is an answer, which is the half of a support
  // system people actually notice.
  if (updated.userId) {
    notify(updated.userId, {
      kind: "message",
      fromName: "Sikshya Support",
      preview: text ? `Your report has been reviewed: ${text.slice(0, 120)}` : "Your report has been updated.",
      at: new Date().toISOString(),
    });
  }

  res.json(updated);
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
      suspendedAt: usersTable.suspendedAt,
      suspendedReason: usersTable.suspendedReason,
    })
    .from(usersTable)
    .where(q ? or(ilike(usersTable.name, `%${q}%`), ilike(usersTable.email, `%${q}%`)) : sql`true`)
    .orderBy(desc(usersTable.id))
    .limit(50);
  res.json({ users: rows });
});

router.get("/admin/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
      suspendedAt: usersTable.suspendedAt,
      suspendedReason: usersTable.suspendedReason,
    })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [profile] = await db
    .select({
      id: teacherProfilesTable.id,
      subject: teacherProfilesTable.subject,
      bio: teacherProfilesTable.bio,
      approvalStatus: teacherProfilesTable.approvalStatus,
      rating: teacherProfilesTable.rating,
      reviewCount: teacherProfilesTable.reviewCount,
    })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.userId, id));

  const activity = await readActivity({ userId: id, limit: 80 });
  res.json({ user, teacherProfile: profile ?? null, activity });
});

router.post("/admin/users/:id/suspend", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const { reason } = req.body as { reason?: string };
  const text = typeof reason === "string" ? reason.trim() : "";
  // A suspension with no reason is one nobody can review, appeal or explain to the person it
  // happened to.
  if (!text) { res.status(400).json({ error: "Please give a reason for the suspension." }); return; }

  // An agent cannot suspend themselves out of the room, and cannot suspend another agent —
  // that is the owner's decision, made directly, not one support staff make about each other.
  if (id === req.user!.userId) {
    res.status(400).json({ error: "You cannot suspend your own account." });
    return;
  }
  const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.role === "admin") {
    res.status(403).json({ error: "An agent's account cannot be suspended from here." });
    return;
  }

  await db
    .update(usersTable)
    .set({ suspendedAt: new Date(), suspendedReason: text, suspendedBy: req.user!.userId })
    .where(eq(usersTable.id, id));

  recordActivity({
    userId: req.user!.userId,
    action: "admin.account.suspended",
    subjectType: "user",
    subjectId: id,
    detail: { reason: text },
    ip: callerIp(req),
  });

  res.json({ suspended: true, reason: text });
});

router.post("/admin/users/:id/unsuspend", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  await db
    .update(usersTable)
    .set({ suspendedAt: null, suspendedReason: null, suspendedBy: null })
    .where(eq(usersTable.id, id));

  recordActivity({
    userId: req.user!.userId,
    action: "admin.account.unsuspended",
    subjectType: "user",
    subjectId: id,
    ip: callerIp(req),
  });

  res.json({ suspended: false });
});

/**
 * Issues a one-time code the person uses to set their own password.
 *
 * The agent reads the code out and never learns the password. The obvious shortcut — an agent
 * typing a temporary password and reading *that* out — leaves every reset account known to
 * somebody else, and a support tool that hands out working credentials is one that will
 * eventually be talked into handing out somebody else's.
 */
router.post("/admin/users/:id/password-reset", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Six digits, from a cryptographic source rather than Math.random, and short-lived. Long
  // enough not to be guessed inside half an hour, short enough to read down a phone line.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = createHash("sha256").update(code).digest("hex");

  // Any code already outstanding for this person is spent, so a reset cannot be raced by an
  // older one somebody overheard.
  await db
    .update(passwordResetsTable)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetsTable.userId, id), isNull(passwordResetsTable.usedAt)));

  await db.insert(passwordResetsTable).values({
    userId: id,
    codeHash,
    expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60_000),
    issuedBy: req.user!.userId,
  });

  recordActivity({
    userId: req.user!.userId,
    action: "admin.password_reset.issued",
    subjectType: "user",
    subjectId: id,
    // The code itself is never logged. An audit log is read by agents, which is the wrong
    // audience for a working reset code.
    detail: { expiresInMinutes: RESET_CODE_MINUTES },
    ip: callerIp(req),
  });

  res.json({ code, expiresInMinutes: RESET_CODE_MINUTES });
});

router.get("/admin/teachers/pending", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      userId: teacherProfilesTable.userId,
      profileId: teacherProfilesTable.id,
      name: usersTable.name,
      email: usersTable.email,
      subject: teacherProfilesTable.subject,
      bio: teacherProfilesTable.bio,
      approvalStatus: teacherProfilesTable.approvalStatus,
      createdAt: usersTable.createdAt,
    })
    .from(teacherProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, teacherProfilesTable.userId))
    .where(eq(teacherProfilesTable.approvalStatus, "pending"))
    .orderBy(asc(teacherProfilesTable.id))
    .limit(100);
  res.json({ teachers: rows });
});

router.post("/admin/teachers/:userId/decision", async (req, res): Promise<void> => {
  const userId = parseInt(String(req.params.userId), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const { decision, note } = req.body as { decision?: string; note?: string };
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be approved or rejected" });
    return;
  }
  const text = typeof note === "string" ? note.trim() : "";
  // A rejection somebody cannot act on is a rejection they will simply resubmit.
  if (decision === "rejected" && !text) {
    res.status(400).json({ error: "Please say why, so the teacher can put it right." });
    return;
  }

  const [updated] = await db
    .update(teacherProfilesTable)
    .set({ approvalStatus: decision })
    .where(eq(teacherProfilesTable.userId, userId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Teacher not found" }); return; }

  recordActivity({
    userId: req.user!.userId,
    action: `admin.teacher.${decision}`,
    subjectType: "user",
    subjectId: userId,
    detail: { note: text || undefined },
    ip: callerIp(req),
  });

  notify(userId, {
    kind: "message",
    fromName: "Sikshya Support",
    preview:
      decision === "approved"
        ? "Your teaching credentials have been approved. You can schedule classes now."
        : `Your credentials were not approved: ${text}`,
    at: new Date().toISOString(),
  });

  res.json(updated);
});

/**
 * The activity log, for a question that has not been anticipated.
 *
 * Filterable by person, by thing, and by action, because the two ways this is actually read
 * are "everything this person did" and "everything that happened to this class".
 */
router.get("/admin/activity", async (req, res): Promise<void> => {
  const num = (value: unknown) => {
    const parsed = parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const result = await readActivity({
    userId: num(req.query.userId),
    subjectType: req.query.subjectType ? String(req.query.subjectType) : undefined,
    subjectId: num(req.query.subjectId),
    action: req.query.action ? String(req.query.action) : undefined,
    before: num(req.query.before),
    limit: num(req.query.limit) ?? 100,
  });
  res.json(result);
});

/**
 * Redeeming a reset code. Not an admin route — the person doing it is signed out.
 *
 * Mounted here because it only exists to complete something an agent started, and keeping the
 * two halves in one file is how they stay in step.
 */
export const passwordResetRouter: IRouter = Router();

passwordResetRouter.post("/auth/redeem-reset", async (req, res): Promise<void> => {
  const { email, code, newPassword } = req.body as { email?: string; code?: string; newPassword?: string };
  if (!email || !code || !newPassword) {
    res.status(400).json({ error: "email, code and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Please choose a password of at least 8 characters." });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  // One answer for every kind of failure. Saying which part was wrong turns this into a way to
  // find out which addresses have accounts and which codes are live.
  const refuse = () => res.status(400).json({ error: "That code is not valid. Please ask support for a new one." });
  if (!user) { refuse(); return; }

  const codeHash = createHash("sha256").update(code.trim()).digest("hex");
  const [reset] = await db
    .select({ id: passwordResetsTable.id })
    .from(passwordResetsTable)
    .where(
      and(
        eq(passwordResetsTable.userId, user.id),
        eq(passwordResetsTable.codeHash, codeHash),
        isNull(passwordResetsTable.usedAt),
        gte(passwordResetsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(passwordResetsTable.id))
    .limit(1);
  if (!reset) { refuse(); return; }

  await db.update(usersTable).set({ passwordHash: await hashPassword(newPassword) }).where(eq(usersTable.id, user.id));
  await db.update(passwordResetsTable).set({ usedAt: new Date() }).where(eq(passwordResetsTable.id, reset.id));

  recordActivity({
    userId: user.id,
    action: "auth.password_reset.redeemed",
    subjectType: "user",
    subjectId: user.id,
    ip: callerIp(req),
  });

  res.json({ ok: true });
});

export default router;
