import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * Money owed back to somebody, and what happened to it.
 *
 * **Nothing here moves money.** There is no payment provider yet — see REFUNDS.md — so a row
 * in this table is a debt written down, and a person pays it. That is the honest shape of it
 * today, and the shape does not change when a provider is wired up: the row is still created
 * the same way, and settling it stops being manual.
 *
 * Saying that plainly matters more than usual. A button that tells somebody "you have been
 * refunded" when nothing has been refunded is the app lying to a person about their money, and
 * this project has already had to remove one control that lied about something far cheaper.
 *
 * The three shares always add back to the price paid. See lib/sessionChanges.ts.
 */
export const refundsTable = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    /**
     * The class this is about — null for a monthly refund.
     *
     * A monthly refund is owed for a *month*, not for one class: the teacher fell short across
     * thirty of them, or was suspended part-way through. Pointing it at one arbitrary class of
     * the month would be a lie in the one table an agent uses to decide what to pay somebody.
     * `recurringId` and `cycleIndex` below say what it is really about.
     */
    sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** What the student paid, kept here so the row explains itself without a join. */
    pricePaid: integer("price_paid").notNull(),
    /** What goes back to the student. */
    amount: integer("amount").notNull(),
    /** What the teacher keeps for having held the slot. Zero when the teacher caused it. */
    teacherShare: integer("teacher_share").notNull().default(0),
    /** What the platform keeps — a cancellation fee, not a processing fee. */
    platformShare: integer("platform_share").notNull().default(0),
    /**
     * `schedule_change` | `student_drop` | `agent_discretion` | `monthly_shortfall` |
     * `monthly_suspension`.
     */
    reason: text("reason").notNull(),
    /** The monthly class this is about, when it is about one. */
    recurringId: integer("recurring_id"),
    /** Which month of it. Null alongside `recurringId`. */
    cycleIndex: integer("cycle_index"),
    /** `owed` until somebody pays it, then `paid`. Never `refunded` — nothing here refunds. */
    status: text("status").notNull().default("owed"),
    /** An agent's explanation, when the refund was their judgement rather than a rule's. */
    note: text("note"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** The agent who settled it. "Who paid this out" is always the next question. */
    paidBy: integer("paid_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => [
    // The queue an agent works through, and one student's history.
    index("refunds_status_idx").on(table.status, table.id),
    index("refunds_student_idx").on(table.studentId, table.id),
  ],
);

export type Refund = typeof refundsTable.$inferSelect;
