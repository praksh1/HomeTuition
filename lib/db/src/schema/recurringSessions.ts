import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { teacherPlansTable } from "./teacherPlans";
import { usersTable } from "./users";

/**
 * The recurring class itself: one per plan, running at the same time every day.
 *
 * The time of day is stored as **minutes past midnight in a named zone**, not as a timestamp.
 * A timestamp would pin the class to one instant and the daily classes would then be generated
 * by adding twenty-four hours to it, which is fine until it isn't; a time-of-day plus a zone is
 * what a teacher actually promised their students — "every day at four" — and it is what a
 * student reads on the card. Nepal keeps a single offset all year (UTC+05:45, no daylight
 * saving), so the two agree today; storing the zone means they still agree if this ever runs
 * anywhere that does.
 *
 * Note what is *not* here: nothing about which calendar anybody reads. Bikram Sambat and
 * Gregorian are both display, converted at the edge in `utils/nepaliDate.ts`. Neither ever
 * reaches a stored time or a price.
 */
export const recurringSessionsTable = pgTable(
  "recurring_sessions",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => teacherPlansTable.id, { onDelete: "cascade" }),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    topic: text("topic").notNull(),
    /** Minutes past midnight, 0–1439, in `timeZone`. */
    startMinute: integer("start_minute").notNull(),
    /** How long each class runs. Capped at ninety by `isAllowedDuration`. */
    durationMinutes: integer("duration_minutes").notNull().default(60),
    timeZone: text("time_zone").notNull().default("Asia/Kathmandu"),
    /** What a student pays for a whole cycle, in rupees. Pro-rated on joining, never on renewal. */
    monthlyPrice: integer("monthly_price").notNull(),
    maxStudents: integer("max_students").notNull().default(45),
    /** active | ended. */
    status: text("status").notNull().default("active"),
    /**
     * When the daily time was last moved. The eighteen-hour notice rule is judged against the
     * *next class*, not against this, but a teacher moving the time repeatedly is something a
     * student is entitled to see, and it is cheaper to keep than to reconstruct.
     */
    timeChangedAt: timestamp("time_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("recurring_sessions_teacher_idx").on(table.teacherId, table.status),
    index("recurring_sessions_plan_idx").on(table.planId),
  ],
);

export type RecurringSession = typeof recurringSessionsTable.$inferSelect;
