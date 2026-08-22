import { integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
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

export const disputeStatusEnum = pgEnum("dispute_status", ["open", "in_review", "resolved"]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDisputeSchema = createInsertSchema(disputesTable).omit({
  id: true,
  status: true,
  createdAt: true,
});
export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputesTable.$inferSelect;
