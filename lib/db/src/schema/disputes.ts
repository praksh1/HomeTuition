import { boolean, index, integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export const disputeReasonEnum = pgEnum("dispute_reason", [
  "Payment Issue",
  "Technical Failure",
  "Inappropriate Behavior",
  // Its own reason rather than "Other". A refund is the one thing a report can ask for that
  // has money at the end of it, and a support queue where those are indistinguishable from
  // general questions is one where they get answered last. See REFUNDS.md.
  "Refund Request",
  "Other",
]);

/**
 * Where a request is in its life.
 *
 * `in_review` is kept because rows already carry it, and is not offered any more — it means the
 * same thing as `processing`, and two words for one state is how somebody ends up asking what
 * the difference is. See lib/tickets.ts, which holds the rules about what may follow what.
 */
export const disputeStatusEnum = pgEnum("dispute_status", [
  "open",
  "opened",
  "assigned",
  "processing",
  "in_review",
  "resolved",
  "denied",
  "cancelled",
]);

export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /**
   * The class this is about, when it is about one.
   *
   * Null for a general report — a payment problem, a question. When it is set, the class's own
   * record answers most of what a reviewer needs to know: who was in the room, when they
   * arrived, how long they stayed, whether the teacher came at all. See the API's
   * lib/participation.ts and REFUNDS.md.
   *
   * `set null` rather than `cascade`: a complaint about a class must outlive the class. If a
   * session row is ever removed, the report and its description stay, which is the whole point
   * of having written it down.
   */
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
  reason: disputeReasonEnum("reason").notNull(),
  description: text("description").notNull(),
  /**
   * A file the reporter attached, if they had one.
   *
   * Was mandatory, and that was wrong for the case that matters most: a student whose teacher
   * never turned up has nothing to photograph. Demanding a screenshot from them meant the
   * report could not be filed at all. A report that names a class does not need one — the
   * server's own record of that class is better evidence than a photograph, and neither side
   * can edit it.
   */
  evidenceUrl: text("evidence_url"),
  status: disputeStatusEnum("status").notNull().default("open"),
  /**
   * What the agent decided, and who decided it.
   *
   * A ticket that only moves from "open" to "resolved" tells the next person nothing: not what
   * was found, not what was done about it, not who to ask. REFUNDS.md is explicit that the
   * outcome of a dispute is a person's decision rather than a rule's, and a decision with no
   * reasoning written down is one nobody can appeal against or learn from.
   */
  resolution: text("resolution"),
  resolvedBy: integer("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /**
   * The agent who has taken this on.
   *
   * Separate from `resolvedBy`, which is whoever finished it. A queue where nobody can see who
   * picked something up is one where two agents work the same ticket and neither knows.
   */
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Everything that has happened to a request, in order.
 *
 * This is what the person who reported it reads. Without it a ticket is a single word that
 * changes when somebody happens to look, and "you can create several hundred requests without
 * knowing the status" is the result — so it is a log, not a column, and every move writes a row.
 *
 * An agent's justification and any supporting file live here rather than on the ticket, because
 * a ticket has one outcome and several steps, and the reason for each step is worth keeping.
 */
export const ticketEventsTable = pgTable(
  "ticket_events",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => disputesTable.id, { onDelete: "cascade" }),
    /** Who did it. Null when the system did, rather than pretending a person did. */
    actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** `student` | `teacher` | `agent` | `system` — their part in this, not their account type. */
    actorRole: text("actor_role").notNull(),
    /** The name at the time, so a history read months later says who, not a number. */
    actorName: text("actor_name"),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    /** The agent's reasoning. Required on the endings somebody will argue with. */
    note: text("note"),
    /** A file the agent attached to justify it. */
    fileKey: text("file_key"),
    fileType: text("file_type"),
    /** True for a note the reporter should not see — an agent talking to other agents. */
    internal: boolean("internal").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Every read is "this ticket's history, oldest first".
    index("ticket_events_ticket_idx").on(table.ticketId, table.id),
  ],
);

export type TicketEvent = typeof ticketEventsTable.$inferSelect;

export const insertDisputeSchema = createInsertSchema(disputesTable).omit({
  id: true,
  status: true,
  createdAt: true,
});
export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputesTable.$inferSelect;
