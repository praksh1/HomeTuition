import { index, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * Every time a teacher moved a class.
 *
 * Three jobs at once, which is why it is a log rather than a column:
 *
 * - It **counts against the allowance**: five changes a calendar month, per change rather than
 *   per class, so moving one lesson five times spends the lot.
 * - It **opens the refund window**: the students who had already paid get the whole price back
 *   for twenty-four hours after the change, and that clock starts here.
 * - It is **evidence**: a student saying "they kept moving it" and a teacher saying "I moved it
 *   once" are settled by reading this.
 *
 * A separate table rather than columns on `sessions`, for the reason recorded on
 * `session_activity`: `sessions` is read with a bare `select()` in six routes, and a column
 * added there is a 500 on all of them from the moment the code deploys until somebody runs
 * `db:push` by hand.
 */
export const scheduleChangesTable = pgTable(
  "schedule_changes",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    /** Whose allowance it came out of. */
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Where the class was before, so a student can be told what changed rather than that it did. */
    previousDate: timestamp("previous_date", { withTimezone: true }).notNull(),
    newDate: timestamp("new_date", { withTimezone: true }).notNull(),
    /** How many students had already paid, so the size of the disruption is on the record. */
    affectedStudents: integer("affected_students").notNull().default(0),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "How many has this teacher used this month" and "when was this class last moved".
    index("schedule_changes_teacher_idx").on(table.teacherId, table.changedAt),
    index("schedule_changes_session_idx").on(table.sessionId, table.id),
  ],
);

export type ScheduleChange = typeof scheduleChangesTable.$inferSelect;
