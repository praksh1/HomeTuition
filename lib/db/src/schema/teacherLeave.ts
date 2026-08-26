import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Days a teacher has said they will not be teaching.
 *
 * From the owner's question: *"A teacher is planning to go out of town 2 weeks from now, can
 * the teacher schedule make up classes when he is out of town?"* Today nothing stops them,
 * because nothing in the app knows they are away — so a teacher arranging cover for a class
 * they missed can put it on a day they will miss too, and be marked down twice for one absence.
 *
 * ### What this is not
 *
 * It is **not** a way to run a class for only part of the month. That is a bigger question —
 * the price, the 25-class delivery floor and the suspension count all assume a class runs every
 * day — and it is parked pending the owner's decisions. See
 * `.agents/backlog/monthly-partial-months-and-dropping.md`.
 *
 * So this changes nothing about what a teacher owes. Marking leave does not cancel the daily
 * classes inside it and does not excuse missing them; the teacher is told plainly how many days
 * fall inside, which is the honest thing to show somebody about to book a holiday. All it does
 * is stop a make-up being scheduled into a hole.
 */
export const teacherLeaveTable = pgTable(
  "teacher_leave",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Inclusive of the whole first day. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Inclusive of the whole last day — a one-day trip has both ends on the same date. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /**
     * Why, in the teacher's own words, and optional.
     *
     * Shown back to them when a make-up is refused, because "you are away then" is a great deal
     * easier to act on when it says "you are away then — wedding in Pokhara".
     */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("teacher_leave_teacher_idx").on(table.teacherId, table.startsAt)],
);

export type TeacherLeave = typeof teacherLeaveTable.$inferSelect;
