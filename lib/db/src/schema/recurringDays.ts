import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { recurringSessionsTable } from "./recurringSessions";
import { sessionsTable } from "./sessions";

/**
 * One row per class-day: the ledger the delivery floor, the make-up allowance and the abuse
 * count are all read from.
 *
 * Each row points at a real `sessions` row, so a monthly class is the same object as any other
 * class once it starts — same video room, same whiteboard, same membership check. This table
 * only says *why* that class exists and what became of it.
 *
 * It is the ledger that makes the money honest. "Held twenty-nine of thirty" is a count of
 * rows here, not a number somebody incremented, so a refund can always be traced back to the
 * classes that did and did not happen.
 *
 * `kind` separates the two allowances the owner set: at most five make-ups in a cycle, and at
 * most forty classes in a cycle including them.
 */
export const recurringDaysTable = pgTable(
  "recurring_days",
  {
    id: serial("id").primaryKey(),
    recurringId: integer("recurring_id")
      .notNull()
      .references(() => recurringSessionsTable.id, { onDelete: "cascade" }),
    /** The real class. Null only in the window between planning a day and creating its session. */
    sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
    /** Which thirty-day cycle this day belongs to, counted from the plan's anchor. */
    cycleIndex: integer("cycle_index").notNull(),
    /** regular | makeup. */
    kind: text("kind").notNull().default("regular"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    /** planned | held | missed | cancelled. */
    status: text("status").notNull().default("planned"),
    heldAt: timestamp("held_at", { withTimezone: true }),
    missedAt: timestamp("missed_at", { withTimezone: true }),
    /**
     * For a make-up, the missed day it answers for.
     *
     * This is what stops a miss becoming a black mark: `isAbuse` asks whether a make-up was put
     * on the calendar within forty-eight hours, and the answer is whether any row points here.
     * Derived rather than stored as a flag on the missed row, so the two can never disagree.
     */
    makeupForId: integer("makeup_for_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The count behind every rule in lib/monthly.ts: how many held, missed, made up, this cycle.
    index("recurring_days_cycle_idx").on(table.recurringId, table.cycleIndex, table.status),
    index("recurring_days_schedule_idx").on(table.recurringId, table.scheduledFor),
    index("recurring_days_makeup_idx").on(table.makeupForId),
    // A class-day exists once. Generating a cycle twice — a retry, two workers, a redeploy
    // mid-run — must not double the ledger the refunds are counted from.
    uniqueIndex("recurring_days_slot_idx").on(table.recurringId, table.scheduledFor, table.kind),
  ],
);

export type RecurringDay = typeof recurringDaysTable.$inferSelect;
