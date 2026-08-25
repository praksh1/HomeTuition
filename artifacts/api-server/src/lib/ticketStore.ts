import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db, disputesTable, ticketEventsTable, usersTable } from "@workspace/db";
import {
  TICKET_COOLDOWN_HOURS,
  canTransition,
  displayStatus,
  isTerminal,
  needsJustification,
  statusExplains,
  statusLabel,
  ticketAllowance,
  ticketRef,
  type TicketAllowance,
} from "./tickets";

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** How many requests this person has open against them in the rolling window. */
export async function allowanceFor(userId: number, now: number = Date.now()): Promise<TicketAllowance> {
  const since = new Date(now - TICKET_COOLDOWN_HOURS * 60 * 60 * 1000);
  const rows = await db
    .select({ createdAt: disputesTable.createdAt })
    .from(disputesTable)
    .where(and(eq(disputesTable.userId, userId), gt(disputesTable.createdAt, since)));
  return ticketAllowance(rows.map((r) => r.createdAt), now);
}

export interface MoveTicket {
  ticketId: number;
  to: string;
  actorId: number | null;
  actorRole: "student" | "teacher" | "agent" | "system";
  actorName: string | null;
  note?: string | null;
  fileKey?: string | null;
  fileType?: string | null;
  internal?: boolean;
  /** Set when this move is an agent taking the ticket on. */
  assignTo?: number | null;
  /**
   * Write the note, leave the status where it is.
   *
   * An agent part-way through a case needs somewhere to put what they have found. Forcing that
   * into a status change would either invent states nobody asked for or lose the note, and a
   * note is the thing the reporter most wants to read.
   */
  noteOnly?: boolean;
}

export type MoveResult =
  | { ok: true; ticket: typeof disputesTable.$inferSelect }
  | { ok: false; status: number; reason: string };

/**
 * Moves a ticket, and writes down that it moved.
 *
 * The two happen together or not at all. A status that changed with no history behind it is
 * exactly the thing being fixed here — a single word that changes when somebody happens to
 * look, which tells the person who reported it nothing about what is being done.
 *
 * The row is locked and its status re-read inside the transaction, so two agents pressing
 * "Resolve" at the same moment produce one move and one history entry rather than two.
 */
export async function moveTicket(move: MoveTicket): Promise<MoveResult> {
  const note = typeof move.note === "string" ? move.note.trim() : "";

  if (move.noteOnly && !note) {
    return { ok: false, status: 400, reason: "Write something before saving." };
  }

  if (!move.noteOnly && needsJustification(move.to) && !note) {
    return {
      ok: false,
      status: 400,
      reason:
        displayStatus(move.to) === "denied"
          ? "Say why this is being turned down. The person who reported it will read it."
          : "Say what was decided before closing this request.",
    };
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(disputesTable)
      .where(eq(disputesTable.id, move.ticketId))
      .for("update");

    if (!current) return { ok: false as const, status: 404, reason: "That request was not found." };

    /**
     * A note still cannot be added to something that is finished.
     *
     * Once a request is resolved, denied or withdrawn its history is what an appeal is argued
     * against. Letting anybody keep writing on it would leave the reporter unable to tell what
     * the decision actually rested on.
     */
    if (move.noteOnly) {
      if (isTerminal(current.status)) {
        return {
          ok: false as const,
          status: 409,
          reason: `This request is ${statusLabel(current.status).toLowerCase()} and cannot be changed.`,
        };
      }
    } else {
      const verdict = canTransition(current.status, move.to);
      if (!verdict.ok) return { ok: false as const, status: 409, reason: verdict.reason };
    }

    const to = move.noteOnly ? displayStatus(current.status) : displayStatus(move.to);
    const finishing = !move.noteOnly && (to === "resolved" || to === "denied");

    const [updated] = await tx
      .update(disputesTable)
      .set({
        // A note is still a change to the ticket, and an update that sets nothing at all is
        // one Drizzle refuses outright. Touching the timestamp says both.
        ...(move.noteOnly ? { updatedAt: new Date() } : { status: to }),
        ...(move.assignTo !== undefined && move.assignTo !== null
          ? { assignedTo: move.assignTo, assignedAt: new Date() }
          : {}),
        ...(finishing && note
          ? { resolution: note, resolvedBy: move.actorId ?? null, resolvedAt: new Date() }
          : {}),
      })
      .where(eq(disputesTable.id, move.ticketId))
      .returning();

    await tx.insert(ticketEventsTable).values({
      ticketId: move.ticketId,
      actorId: move.actorId,
      actorRole: move.actorRole,
      actorName: move.actorName,
      fromStatus: current.status,
      toStatus: to,
      note: note || null,
      fileKey: move.fileKey ?? null,
      fileType: move.fileType ?? null,
      internal: move.internal === true,
    });

    return { ok: true as const, ticket: updated! };
  });
}

/** Writes the opening entry, so a request's history starts where the request does. */
export async function recordOpened(
  ticketId: number,
  actorId: number,
  actorRole: string,
  actorName: string | null,
  conn: Db = db,
): Promise<void> {
  await conn.insert(ticketEventsTable).values({
    ticketId,
    actorId,
    actorRole: actorRole === "teacher" ? "teacher" : "student",
    actorName,
    fromStatus: null,
    toStatus: "open",
    note: null,
  });
}

export interface TicketHistoryEntry {
  id: number;
  at: string;
  status: string;
  label: string;
  by: string | null;
  byRole: string;
  note: string | null;
  fileKey: string | null;
}

/**
 * What has happened to a request, for the person who reported it.
 *
 * Internal notes are left out. An agent writing to other agents has not written to the
 * reporter, and showing it anyway would either stop agents writing anything down or hand
 * somebody half a conversation about themselves.
 */
export async function historyFor(
  ticketId: number,
  includeInternal: boolean,
): Promise<TicketHistoryEntry[]> {
  const rows = await db
    .select()
    .from(ticketEventsTable)
    .where(eq(ticketEventsTable.ticketId, ticketId))
    .orderBy(asc(ticketEventsTable.id));

  return rows
    .filter((row) => includeInternal || !row.internal)
    .map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      status: row.toStatus,
      label: statusLabel(row.toStatus),
      by: row.actorName,
      byRole: row.actorRole,
      note: row.note,
      fileKey: row.fileKey,
    }));
}

/** One request, described the way a person reads it rather than the way it is stored. */
export function describeTicket(row: typeof disputesTable.$inferSelect) {
  const status = displayStatus(row.status);
  return {
    id: row.id,
    /** The number they quote when they ask about it. */
    ref: ticketRef(row.id),
    reason: row.reason,
    description: row.description,
    sessionId: row.sessionId,
    evidenceUrl: row.evidenceUrl,
    status,
    statusLabel: statusLabel(status),
    statusExplains: statusExplains(status),
    resolution: row.resolution,
    assignedTo: row.assignedTo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

/** The reporter's name, for the history entry. */
export async function nameOf(userId: number): Promise<string | null> {
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.name ?? null;
}

export { desc };
