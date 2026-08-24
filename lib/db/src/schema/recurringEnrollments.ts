import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { recurringSessionsTable } from "./recurringSessions";
import { usersTable } from "./users";

/**
 * A student's place in a monthly class, for one cycle.
 *
 * One row per student **per cycle**, not one per student: renewing writes a new row. That is
 * what makes "nobody is charged twice for the same class" checkable rather than hoped for —
 * the unique index below is the actual guarantee, and it is in the database rather than in a
 * route because this project has already had two routes disagree about enrolment once.
 *
 * The denominator is frozen here. A student joining with nine classes left pays nine
 * thirtieths, and `sessionsPaidFor` / `sessionsPlanned` record exactly that, so what they are
 * owed later is worked out against what they actually bought rather than against whatever the
 * class looks like by then. `lib/monthly.ts` does the arithmetic; this stores its inputs.
 *
 * There is no state between "not enrolled" and "enrolled and paid" — the same rule as ordinary
 * booking, for the same reason: the old two-step flow left students holding classes they
 * believed they had bought and could not enter.
 */
export const recurringEnrollmentsTable = pgTable(
  "recurring_enrollments",
  {
    id: serial("id").primaryKey(),
    recurringId: integer("recurring_id")
      .notNull()
      .references(() => recurringSessionsTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** The teacher's cycle. There is only one clock, so this is the student's cycle too. */
    cycleIndex: integer("cycle_index").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    /** What they actually paid, in rupees, after pro-rating. */
    amountPaid: integer("amount_paid").notNull(),
    platformShare: integer("platform_share").notNull().default(0),
    teacherShare: integer("teacher_share").notNull().default(0),
    /** Classes left when they joined — the numerator they were charged on. */
    sessionsPaidFor: integer("sessions_paid_for").notNull(),
    /** Classes the cycle held in total — the denominator, frozen at the moment of joining. */
    sessionsPlanned: integer("sessions_planned").notNull(),
    /** active | ended | refunded. */
    status: text("status").notNull().default("active"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The guarantee. One place per student per cycle, whatever a retry or a double tap does.
    uniqueIndex("recurring_enrollments_once_idx").on(
      table.recurringId,
      table.studentId,
      table.cycleIndex,
    ),
    index("recurring_enrollments_student_idx").on(table.studentId, table.status),
    index("recurring_enrollments_cycle_idx").on(table.recurringId, table.cycleIndex),
  ],
);

export type RecurringEnrollment = typeof recurringEnrollmentsTable.$inferSelect;
