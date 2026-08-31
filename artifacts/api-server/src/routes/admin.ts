import { createHash, randomInt } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  db,
  disputesTable,
  passwordResetsTable,
  refundsTable,
  sessionEnrollmentsTable,
  sessionMessagesTable,
  sessionsTable,
  teacherProfilesTable,
  teacherCredentialsTable,
  accountSecurityTable,
  userOnboardingTable,
  usersTable,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { recordActivity, readActivity } from "../lib/activityLog";
import { attendanceFor, enrolledStudents } from "../lib/participation";
import { findingsFor } from "../lib/sessionEvidence";
import { costAt, egressGbAt, monthWindow, usageIn } from "../lib/videoUsage";
import { activityFor } from "../lib/sessionLifecycle";
import { hashPassword } from "../lib/auth";
import { notify } from "../lib/notify";
import { refundSplit } from "../lib/sessionChanges";
import { checkStorage, storageSettingsPresent } from "../lib/fileStore";
import { TICKET_STATUSES, displayStatus, nextStatuses, statusLabel, ticketRef } from "../lib/tickets";
import { historyFor, moveTicket, nameOf } from "../lib/ticketStore";
import { sendEmail } from "../lib/mailer";

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
/**
 * An operator still holding their one-time password may do nothing but replace it.
 *
 * Enforced here rather than by the login screen, because a forced change the app merely
 * insists on is a suggestion: the token issued at sign-in is a perfectly good token, and
 * anything that can send an HTTP request could simply skip the screen. This is the gate that
 * makes "the administrator never knows your password" true rather than aspirational — until
 * the operator has chosen one, the credential the administrator read out opens nothing.
 *
 * `/operator/password` is deliberately not behind this router, so the way out is always open.
 */
async function requirePasswordChanged(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { operatorByUserId } = await import("../lib/operatorStore");
    const operator = await operatorByUserId(req.user!.userId);

    // Not an operator record at all: an account promoted directly in the database, which is how
    // every agent was made before operator IDs existed. Those keep working.
    if (!operator) { next(); return; }

    if (operator.disabledAt) {
      res.status(403).json({ error: "This operator ID has been switched off.", code: "operator_disabled" });
      return;
    }
    if (operator.mustChangePassword) {
      res.status(403).json({
        error: "Choose your own password before using the support desk.",
        code: "must_change_password",
      });
      return;
    }
    next();
  } catch {
    // A lookup that failed is not permission granted.
    res.status(503).json({ error: "Could not check your access. Please try again." });
  }
}

router.use("/admin", requireAuth, requireAdmin, requirePasswordChanged);

/** How many refunds one page of the queue holds. */
const PAGE = 100;

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
    const [[open], [pending], [suspended], [refunds], [owed]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(disputesTable).where(eq(disputesTable.status, "open")),
      db.select({ n: sql<number>`count(*)::int` }).from(teacherProfilesTable).where(eq(teacherProfilesTable.approvalStatus, "pending")),
      db.select({ n: sql<number>`count(*)::int` }).from(usersTable).where(sql`${usersTable.suspendedAt} is not null`),
      db.select({ n: sql<number>`count(*)::int` }).from(refundsTable).where(eq(refundsTable.status, "owed")),
      db.select({ n: sql<number>`coalesce(sum(${refundsTable.amount}), 0)::int` }).from(refundsTable).where(eq(refundsTable.status, "owed")),
    ]);
    res.json({
      openTickets: open?.n ?? 0,
      pendingTeachers: pending?.n ?? 0,
      suspendedAccounts: suspended?.n ?? 0,
      refundsOwed: refunds?.n ?? 0,
      refundsOwedTotal: owed?.n ?? 0,
      known: true,
    });
  } catch (err) {
    // An agent must be able to tell "nothing to do" from "we could not look".
    res.status(503).json({
      openTickets: 0,
      pendingTeachers: 0,
      suspendedAccounts: 0,
      refundsOwed: 0,
      refundsOwedTotal: 0,
      known: false,
    });
  }
});

/**
 * The queue.
 *
 * Filtered rather than paged, because the owner's complaint about every other list in this app
 * applies here first: "I have only been testing for less than a month and already my pages look
 * overcrowded." `open` is the filter an agent starts a shift on; `mine` is the one they work
 * from after that.
 */
router.get("/admin/tickets", async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "");
  const mine = String(req.query.assigned ?? "");

  const filters = [];
  if (status === "active") {
    // Everything still waiting on somebody, which is what a queue actually is.
    filters.push(sql`${disputesTable.status} not in ('resolved', 'denied', 'cancelled')`);
  } else if ((TICKET_STATUSES as readonly string[]).includes(status)) {
    filters.push(eq(disputesTable.status, status as (typeof TICKET_STATUSES)[number]));
  }
  if (mine === "me") filters.push(eq(disputesTable.assignedTo, req.user!.userId));
  else if (mine === "unassigned") filters.push(isNull(disputesTable.assignedTo));

  const assignee = alias(usersTable, "assignee");
  const rows = await db
    .select({
      id: disputesTable.id,
      reason: disputesTable.reason,
      description: disputesTable.description,
      status: disputesTable.status,
      createdAt: disputesTable.createdAt,
      updatedAt: disputesTable.updatedAt,
      sessionId: disputesTable.sessionId,
      reporterId: disputesTable.userId,
      reporterName: usersTable.name,
      reporterRole: usersTable.role,
      assignedTo: disputesTable.assignedTo,
      assigneeName: assignee.name,
    })
    .from(disputesTable)
    .leftJoin(usersTable, eq(usersTable.id, disputesTable.userId))
    .leftJoin(assignee, eq(assignee.id, disputesTable.assignedTo))
    .where(filters.length ? and(...filters) : sql`true`)
    .orderBy(desc(disputesTable.id))
    .limit(100);

  res.json({
    tickets: rows.map((row) => ({
      ...row,
      /** The number the reporter quotes on the phone. */
      ref: ticketRef(row.id),
      statusLabel: statusLabel(row.status),
    })),
  });
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

  /**
   * Reading a new request is itself a step, and the reporter should see it.
   *
   * "Operator Opened" was in the owner's own list of states, and it is the one that answers the
   * question behind this whole feature — has a human looked at this yet. Recording it when an
   * agent actually opens the ticket is the only way it can be true; a button for it would be a
   * button nobody presses.
   */
  let status = ticket.status;
  if (status === "open") {
    const opened = await moveTicket({
      ticketId: id,
      to: "opened",
      actorId: req.user!.userId,
      actorRole: "agent",
      actorName: await nameOf(req.user!.userId),
    });
    if (opened.ok) status = opened.ticket.status;
  }

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

  res.json({
    ticket: {
      ...ticket,
      status,
      ref: ticketRef(ticket.id),
      statusLabel: statusLabel(status),
    },
    /** Internal notes included: this is the agents' own view of the ticket. */
    history: await historyFor(id, true),
    /** What the desk may do next, taken from the same rules the server enforces. */
    nextStatuses: nextStatuses(status).map((next) => ({ value: next, label: statusLabel(next) })),
    session,
    attendance,
    findings,
    messages,
    reporterActivity,
  });
});

/**
 * Taking a ticket on.
 *
 * Separate from the status change because they are different acts: an agent can pick up a
 * ticket they are not ready to work on yet, and a ticket can move on without changing hands.
 */
router.post("/admin/tickets/:id/assign", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket id" }); return; }

  const { agentId } = req.body as { agentId?: number };
  const to = agentId === undefined || agentId === null ? req.user!.userId : Number(agentId);
  if (!Number.isFinite(to)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  // Only an agent may hold a ticket. Assigning one to a student would put a support queue in
  // front of somebody with no way to see it and no business seeing it.
  const [agent] = await db.select({ role: usersTable.role, name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, to));
  if (!agent || agent.role !== "admin") {
    res.status(400).json({ error: "A ticket can only be assigned to a support agent." });
    return;
  }

  const moved = await moveTicket({
    ticketId: id,
    to: "assigned",
    actorId: req.user!.userId,
    actorRole: "agent",
    actorName: await nameOf(req.user!.userId),
    note: to === req.user!.userId ? null : `Assigned to ${agent.name}.`,
    assignTo: to,
  });
  if (!moved.ok) { res.status(moved.status).json({ error: moved.reason }); return; }

  recordActivity({
    userId: req.user!.userId,
    action: "admin.ticket.assigned",
    subjectType: "dispute",
    subjectId: id,
    detail: { assignedTo: to },
    ip: callerIp(req),
  });

  res.json({
    ticket: { ...moved.ticket, ref: ticketRef(id), statusLabel: statusLabel(moved.ticket.status) },
    history: await historyFor(id, true),
    nextStatuses: nextStatuses(moved.ticket.status).map((next) => ({ value: next, label: statusLabel(next) })),
  });
});

/**
 * Moving a ticket along, or writing a note on it.
 *
 * Both go through lib/ticketStore.ts, which changes the status and records the move in one
 * transaction. The pair is the point: a status that changed with nothing behind it is what the
 * reporter is currently looking at, and it tells them nothing about what is being done.
 *
 * An agent may also attach a document. The owner asked for "Justification/Supporting Documents
 * attached by the Agents" — the justification is the note, the document is the file, and a
 * decision that rests on a payment record or a screenshot should carry it.
 */
router.patch("/admin/tickets/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket id" }); return; }

  const { status, resolution, fileKey, internal } = req.body as {
    status?: string; resolution?: string; fileKey?: string | null; internal?: boolean;
  };
  const text = typeof resolution === "string" ? resolution.trim() : "";

  /**
   * A note without a status change is a note, not a move.
   *
   * An agent part-way through a case needs somewhere to write what they have found so far, and
   * forcing that into a status change would either invent states nobody wants or lose the note.
   */
  if (status === undefined || status === null || status === "") {
    if (!text) { res.status(400).json({ error: "Write something before saving." }); return; }

    const noted = await moveTicket({
      ticketId: id,
      to: "",
      noteOnly: true,
      actorId: req.user!.userId,
      actorRole: "agent",
      actorName: await nameOf(req.user!.userId),
      note: text,
      fileKey: typeof fileKey === "string" && fileKey ? fileKey : null,
      internal: internal === true,
    });
    if (!noted.ok) { res.status(noted.status).json({ error: noted.reason }); return; }

    recordActivity({
      userId: req.user!.userId,
      action: "admin.ticket.noted",
      subjectType: "dispute",
      subjectId: id,
      detail: { internal: internal === true },
      ip: callerIp(req),
    });

    const after = noted.ticket;
    res.json({
      ticket: { ...after, ref: ticketRef(id), statusLabel: statusLabel(after.status) },
      history: await historyFor(id, true),
      nextStatuses: nextStatuses(after.status).map((next) => ({ value: next, label: statusLabel(next) })),
    });
    return;
  }

  const moved = await moveTicket({
    ticketId: id,
    to: status,
    actorId: req.user!.userId,
    actorRole: "agent",
    actorName: await nameOf(req.user!.userId),
    note: text || null,
    fileKey: typeof fileKey === "string" && fileKey ? fileKey : null,
    internal: internal === true,
  });
  if (!moved.ok) { res.status(moved.status).json({ error: moved.reason }); return; }

  const updated = moved.ticket;
  const now = displayStatus(updated.status);

  recordActivity({
    userId: req.user!.userId,
    action: `admin.ticket.${now}`,
    subjectType: "dispute",
    subjectId: id,
    detail: { status: now, resolution: text || undefined },
    ip: callerIp(req),
  });

  /**
   * The person who reported it is told, and told which request.
   *
   * The ticket number is in the message because somebody with three open requests reading "your
   * report has been updated" learns nothing from it.
   */
  if (updated.userId && !(internal === true)) {
    notify(updated.userId, {
      kind: "message",
      fromName: "Sikshya Support",
      preview: text
        ? `${ticketRef(id)} — ${statusLabel(now)}: ${text.slice(0, 100)}`
        : `${ticketRef(id)} — ${statusLabel(now)}`,
      at: new Date().toISOString(),
    });
  }

  res.json({
    ticket: { ...updated, ref: ticketRef(id), statusLabel: statusLabel(now) },
    history: await historyFor(id, true),
    nextStatuses: nextStatuses(now).map((next) => ({ value: next, label: statusLabel(next) })),
  });
});

/**
 * Can this server actually store a file?
 *
 * Not "are the settings present" — every R2 variable can be set and the API token still be
 * read-only, which is exactly far enough to pass every configuration check and fail every
 * upload. So this writes a small object, reads it back, and deletes it, and says which of
 * those three failed and what to change.
 *
 * Behind the support desk because the answer names environment variables. It never returns a
 * value, only which names are set — see `storageSettingsPresent`.
 */
/**
 * What the video cost this month, in the units a provider bills in.
 *
 * The owner is weighing Daily against a self-hosted alternative and asked for real numbers
 * rather than a guess. Both halves of the comparison come out of one figure — participant
 * minutes — because a managed provider charges per minute and a self-hosted one charges per
 * gigabyte of egress, and the second is derived from the first.
 *
 * Nothing new is measured to produce this. `session_participation.present_ms` has been written
 * on every socket disconnect since the attendance work; this only adds it up.
 *
 * ### Two knobs, both honest
 *
 * `rate` is your provider's price per participant-minute, off your own invoice. `kbps` is the
 * video bitrate you actually observe. Neither is hard-coded: a stale constant in here would be
 * trusted precisely because it looked authoritative. Passing nothing gives you the minutes and
 * a zero cost, which is the true answer for self-hosting anyway.
 */
router.get("/admin/video-usage", async (req, res): Promise<void> => {
  const monthParam = String(req.query.month ?? "");
  // `?month=2026-08`, or this month. Parsed as the 15th so no timezone can push it into a
  // neighbouring month on the way in.
  const anchorDate = /^\d{4}-\d{2}$/.test(monthParam)
    ? new Date(`${monthParam}-15T00:00:00Z`)
    : new Date();

  const rate = Number(req.query.rate ?? 0);
  const kbps = Number(req.query.kbps ?? 1500);

  const window = monthWindow(anchorDate);
  const totals = await usageIn(window);

  res.json({
    ...totals,
    /** What a per-minute provider would charge, at the rate given. Zero when none is. */
    estimatedCost: Number.isFinite(rate) && rate > 0 ? Number(costAt(totals.participantMinutes, rate).toFixed(2)) : 0,
    rateUsed: Number.isFinite(rate) && rate > 0 ? rate : null,
    /** What a self-hosted SFU would have to move for the same classes. */
    estimatedEgressGb: egressGbAt(totals.participantMinutes, Number.isFinite(kbps) && kbps > 0 ? kbps : 1500),
    kbpsAssumed: Number.isFinite(kbps) && kbps > 0 ? kbps : 1500,
    /**
     * Said out loud, because a number without its caveat gets quoted without it. This counts
     * time on the classroom socket, which includes somebody sitting with their camera off, so
     * it is an upper bound on real video minutes.
     */
    note: "Counts time on the classroom socket, so this is an upper bound on real video minutes.",
  });
});

router.get("/admin/storage/check", async (req, res): Promise<void> => {
  const result = await checkStorage();
  recordActivity({
    userId: req.user!.userId,
    action: "admin.storage.checked",
    detail: { ok: result.ok, ...(result.ok ? {} : { code: result.failure.code, failedAt: result.failedAt }) },
    ip: callerIp(req),
  });

  res.json({
    ok: result.ok,
    settings: storageSettingsPresent(),
    // "write", "read", "delete" — how far it got before it stopped.
    completed: result.steps,
    /**
     * The address it actually used, which is the thing a wrong setting shows up in. A hostname
     * is not a secret — the bucket is reached by credentials, not by obscurity — and without it
     * "could not reach R2" is unactionable.
     */
    endpoint: result.endpoint ?? null,
    note: result.note ?? null,
    ...(result.ok
      ? { bucket: result.bucket, message: "A file can be written, read back and deleted." }
      : {
          failedAt: result.failedAt,
          code: result.failure.code,
          advice: result.failure.advice,
          detail: result.failure.detail,
        }),
  });
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

  let credentials: (typeof teacherCredentialsTable.$inferSelect)[] = [];
  if (profile) {
    // Opening the case locks submitted files against deletion. This is the real event, not a
    // button an operator might forget to press.
    await db
      .update(teacherCredentialsTable)
      .set({ status: "opened", openedAt: new Date(), openedBy: req.user!.userId, updatedAt: new Date() })
      .where(and(eq(teacherCredentialsTable.teacherId, id), eq(teacherCredentialsTable.status, "submitted")));
    credentials = await db
      .select()
      .from(teacherCredentialsTable)
      .where(and(eq(teacherCredentialsTable.teacherId, id), sql`${teacherCredentialsTable.status} <> 'withdrawn'`))
      .orderBy(asc(teacherCredentialsTable.documentType), desc(teacherCredentialsTable.id));
  }

  const [security] = await db
    .select({ emailVerifiedAt: accountSecurityTable.emailVerifiedAt })
    .from(accountSecurityTable)
    .where(eq(accountSecurityTable.userId, id));
  const [onboarding] = await db.select().from(userOnboardingTable).where(eq(userOnboardingTable.userId, id));

  const activity = await readActivity({ userId: id, limit: 80 });
  res.json({
    user,
    teacherProfile: profile ?? null,
    credentials,
    onboarding: onboarding ?? null,
    emailVerified: security ? security.emailVerifiedAt !== null : true,
    activity,
  });
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
      emailVerifiedAt: accountSecurityTable.emailVerifiedAt,
    })
    .from(teacherProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, teacherProfilesTable.userId))
    .leftJoin(accountSecurityTable, eq(accountSecurityTable.userId, usersTable.id))
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

  const credentials = await db
    .select({ status: teacherCredentialsTable.status, type: teacherCredentialsTable.documentType })
    .from(teacherCredentialsTable)
    .where(eq(teacherCredentialsTable.teacherId, userId));
  if (decision === "approved") {
    const active = credentials.filter((row) => row.status !== "withdrawn" && row.status !== "rejected");
    if (active.length === 0) {
      res.status(409).json({ error: "Open and approve the teacher's submitted identity documents before approving the account." });
      return;
    }
    if (active.some((row) => row.status !== "approved")) {
      res.status(409).json({ error: "Every submitted document must be approved or rejected before the teacher account can be approved." });
      return;
    }
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

router.post("/admin/teacher-credentials/:id/decision", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid document id." }); return; }
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "Choose approved or rejected." });
    return;
  }
  if (decision === "rejected" && !reason) {
    res.status(400).json({ error: "Explain what is wrong so the teacher can send the right document." });
    return;
  }
  const [existing] = await db
    .select({
      id: teacherCredentialsTable.id,
      teacherId: teacherCredentialsTable.teacherId,
      status: teacherCredentialsTable.status,
      documentType: teacherCredentialsTable.documentType,
      teacherEmail: usersTable.email,
      teacherName: usersTable.name,
    })
    .from(teacherCredentialsTable)
    .innerJoin(usersTable, eq(usersTable.id, teacherCredentialsTable.teacherId))
    .where(eq(teacherCredentialsTable.id, id));
  if (!existing || existing.status === "withdrawn") { res.status(404).json({ error: "Document not found." }); return; }

  const [updated] = await db
    .update(teacherCredentialsTable)
    .set({
      status: decision,
      reviewedAt: new Date(),
      reviewedBy: req.user!.userId,
      rejectionReason: decision === "rejected" ? reason : null,
      openedAt: sql`coalesce(${teacherCredentialsTable.openedAt}, now())`,
      openedBy: sql`coalesce(${teacherCredentialsTable.openedBy}, ${req.user!.userId})`,
      updatedAt: new Date(),
    })
    .where(eq(teacherCredentialsTable.id, id))
    .returning();

  if (decision === "rejected") {
    await db.update(teacherProfilesTable).set({ approvalStatus: "rejected" }).where(eq(teacherProfilesTable.userId, existing.teacherId));
  }
  const label = existing.documentType.replaceAll("_", " ");
  const message = decision === "approved"
    ? `Your ${label} was approved.`
    : `Your ${label} was rejected: ${reason}. You may now upload a replacement.`;
  notify(existing.teacherId, { kind: "message", fromName: "Sikshya Support", preview: message, at: new Date().toISOString() });
  void sendEmail({
    to: existing.teacherEmail,
    subject: decision === "approved" ? "Sikshya document approved" : "Sikshya document needs to be replaced",
    text: `Hello ${existing.teacherName},\n\n${message}`,
  });
  recordActivity({
    userId: req.user!.userId,
    action: `admin.teacher_credential.${decision}`,
    subjectType: "teacher_credential",
    subjectId: id,
    detail: { teacherId: existing.teacherId, reason: reason || undefined },
    ip: callerIp(req),
  });
  res.json({ credential: updated });
});

/**
 * The activity log, for a question that has not been anticipated.
 *
 * Filterable by person, by thing, and by action, because the two ways this is actually read
 * are "everything this person did" and "everything that happened to this class".
 */
/**
 * Money the platform owes people.
 *
 * **This queue is the payment system.** There is no provider — see REFUNDS.md — so every row
 * here is a debt somebody settles by hand, and marking it paid is a person saying they did it,
 * not the app saying it happened. Naming that plainly in the code is the only thing keeping the
 * two from being confused later.
 */
router.get("/admin/refunds", async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "owed");
  const wanted = status === "all" ? null : status === "paid" ? "paid" : "owed";
  /**
   * One person's refunds, for an agent answering "where is my money" about a named student.
   *
   * The queue is ordered oldest-first, because a payout queue is worked from whoever has waited
   * longest, and it shows one page at a time — so a row past that page can only be reached by
   * naming who it belongs to, either with this or with the search below.
   */
  const forStudent = Number(req.query.studentId);
  const student = Number.isInteger(forStudent) ? forStudent : null;
  /** Search by the person's name or address, for finding one row in a long queue. */
  const q = String(req.query.q ?? "").trim();

  try {
    const rows = await db
      .select({
        id: refundsTable.id,
        sessionId: refundsTable.sessionId,
        studentId: refundsTable.studentId,
        studentName: usersTable.name,
        studentEmail: usersTable.email,
        topic: sessionsTable.topic,
        sessionDate: sessionsTable.date,
        pricePaid: refundsTable.pricePaid,
        amount: refundsTable.amount,
        teacherShare: refundsTable.teacherShare,
        platformShare: refundsTable.platformShare,
        reason: refundsTable.reason,
        status: refundsTable.status,
        note: refundsTable.note,
        requestedAt: refundsTable.requestedAt,
        paidAt: refundsTable.paidAt,
      })
      .from(refundsTable)
      .leftJoin(usersTable, eq(usersTable.id, refundsTable.studentId))
      .leftJoin(sessionsTable, eq(sessionsTable.id, refundsTable.sessionId))
      .where(
        and(
          wanted ? eq(refundsTable.status, wanted) : sql`true`,
          student === null ? sql`true` : eq(refundsTable.studentId, student),
          q ? or(ilike(usersTable.name, `%${q}%`), ilike(usersTable.email, `%${q}%`)) : sql`true`,
        ),
      )
      .orderBy(asc(refundsTable.id))
      .limit(PAGE + 1);

    const [owed] = await db
      .select({ n: sql<number>`coalesce(sum(${refundsTable.amount}), 0)::int` })
      .from(refundsTable)
      .where(eq(refundsTable.status, "owed"));

    /**
     * Say when there is more than fits.
     *
     * One row too many is fetched purely to answer this. A queue worked oldest-first that
     * silently stops at a page means anything past that point is invisible to the agent, and a
     * refund nobody can see is one nobody pays — so the screen has to be able to say "there are
     * more, search for the person" rather than looking complete.
     */
    const truncated = rows.length > PAGE;

    res.json({
      refunds: rows.slice(0, PAGE),
      totalOwed: owed?.n ?? 0,
      truncated,
      known: true,
    });
  } catch (err) {
    // An empty queue and an unreadable one look identical on screen, and only one of them
    // means there is nothing to pay.
    res.status(503).json({ refunds: [], totalOwed: 0, truncated: false, known: false });
  }
});

/**
 * Mark a refund settled.
 *
 * Requires a reference — a transaction id, a bank slip number, something. A refund marked paid
 * with nothing to point at is indistinguishable from one that was never paid, and the student
 * asking about it a week later has to be answerable.
 */
router.post("/admin/refunds/:id/paid", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid refund id" }); return; }

  const { reference } = req.body as { reference?: string };
  const text = typeof reference === "string" ? reference.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Please record how this was paid — a transaction id or receipt number." });
    return;
  }

  const [existing] = await db.select().from(refundsTable).where(eq(refundsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Refund not found" }); return; }
  if (existing.status === "paid") {
    res.status(409).json({ error: "This refund is already marked paid." });
    return;
  }

  const [updated] = await db
    .update(refundsTable)
    .set({ status: "paid", paidAt: new Date(), paidBy: req.user!.userId, note: text })
    .where(and(eq(refundsTable.id, id), eq(refundsTable.status, "owed")))
    .returning();
  if (!updated) { res.status(409).json({ error: "This refund is already marked paid." }); return; }

  recordActivity({
    userId: req.user!.userId,
    action: "admin.refund.paid",
    subjectType: "refund",
    subjectId: id,
    detail: { amount: updated.amount, reference: text },
    ip: callerIp(req),
  });

  notify(updated.studentId, {
    kind: "message",
    fromUserId: req.user!.userId,
    fromName: "Sikshya Support",
    preview: `Your refund of NPR ${updated.amount} has been paid. Reference: ${text}`,
    at: new Date().toISOString(),
  });

  res.json({ paid: true, refund: updated });
});

/**
 * A full refund an agent decides on.
 *
 * The owner drew the line and it is a narrow one: "It has to be for out of one's control type
 * of situations!" — a teacher who never appeared, a power cut across the valley, something that
 * happened *to* the student rather than something they chose. It is not a way around the
 * half-refund a student accepts when they change their mind, and the required note is what
 * makes that reviewable afterwards rather than a matter of trust.
 *
 * It refunds the whole price. An agent reaching for this has already decided the student did
 * nothing wrong, and a partial version of that would only invite arguing over the fraction.
 */
router.post("/admin/sessions/:sessionId/refund", async (req, res): Promise<void> => {
  const sessionId = parseInt(String(req.params.sessionId), 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }

  const { studentId, note } = req.body as { studentId?: number; note?: string };
  const student = Number(studentId);
  if (!Number.isInteger(student)) { res.status(400).json({ error: "Which student?" }); return; }

  const text = typeof note === "string" ? note.trim() : "";
  if (!text) {
    res.status(400).json({
      error:
        "Please say why this refund is being given in full. Full refunds are for things " +
        "outside the student's control, and the reason is what makes that reviewable.",
    });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const [enrolment] = await db
    .select({ id: sessionEnrollmentsTable.id, paymentStatus: sessionEnrollmentsTable.paymentStatus })
    .from(sessionEnrollmentsTable)
    .where(
      and(
        eq(sessionEnrollmentsTable.sessionId, sessionId),
        eq(sessionEnrollmentsTable.studentId, student),
      ),
    );
  if (!enrolment) { res.status(404).json({ error: "That student is not booked into this class." }); return; }

  const [already] = await db
    .select({ id: refundsTable.id })
    .from(refundsTable)
    .where(and(eq(refundsTable.sessionId, sessionId), eq(refundsTable.studentId, student)))
    .limit(1);
  if (already) {
    res.status(409).json({ error: "A refund is already recorded for this student and class." });
    return;
  }

  const split = refundSplit(session.price, "agent_discretion");

  const refund = await db.transaction(async (tx) => {
    /**
     * The seat only goes back on sale if there is still a class to sell it into.
     *
     * Most refunds an agent grants are for a class that already happened badly, and quietly
     * decrementing the count on a finished class would leave its record saying fewer people
     * were there than actually were — which is the record the next dispute is argued from.
     */
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

    if (freed.length > 0 && session.status === "upcoming") {
      await tx
        .update(sessionsTable)
        .set({ enrolledCount: sql`GREATEST(0, ${sessionsTable.enrolledCount} - 1)` })
        .where(eq(sessionsTable.id, sessionId));
    }

    const [row] = await tx
      .insert(refundsTable)
      .values({
        sessionId,
        studentId: student,
        pricePaid: session.price,
        amount: split.studentRefund,
        teacherShare: split.teacherShare,
        platformShare: split.platformShare,
        reason: "agent_discretion",
        status: "owed",
        note: text,
      })
      .returning();
    return row;
  });

  recordActivity({
    userId: req.user!.userId,
    action: "admin.refund.granted",
    subjectType: "session",
    subjectId: sessionId,
    detail: { studentId: student, amount: refund.amount, note: text },
    ip: callerIp(req),
  });

  notify(student, {
    kind: "message",
    fromUserId: req.user!.userId,
    fromName: "Sikshya Support",
    preview:
      `A full refund of NPR ${refund.amount} has been requested for "${session.topic}". ` +
      `It will be processed within 5-7 business days.`,
    at: new Date().toISOString(),
  });

  res.json({ refund });
});

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
