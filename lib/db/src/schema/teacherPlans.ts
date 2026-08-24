import { sql } from "drizzle-orm";
import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A teacher's monthly tier: one purchase, one thirty-day clock, one recurring class.
 *
 * The clock is the whole reason this table exists. The teacher is charged the day they buy,
 * but the owner was explicit that the cycle starts when they **create their recurring class** —
 * so `cycleAnchor` is null between those two moments, and every rate in the tier is worked out
 * from it once it is set. See `lib/monthly.ts`, which holds the arithmetic and knows nothing
 * about this table.
 *
 * A plan that is paid for and never started would otherwise sit with a null anchor forever,
 * having bought nothing; `PLAN_AUTOSTART_DAYS` closes that by starting the clock anyway after
 * a week.
 *
 * A separate table rather than columns on `users` or `teacher_profiles`, for the reason
 * recorded on `session_activity`: the wide tables here are read with bare `select()`s in
 * several routes, and a column added to one is a 500 on all of them from the moment the code
 * deploys until somebody runs `db:push` by hand.
 */
export const teacherPlansTable = pgTable(
  "teacher_plans",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** What they were charged, in rupees. Stored rather than read from a constant, so that
     *  changing the tier price never rewrites what somebody already paid. */
    price: integer("price").notNull(),
    /** Sikshya's cut of that, held back at purchase. The teacher's share is the remainder. */
    platformShare: integer("platform_share").notNull().default(0),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The moment cycle zero began — the instant the recurring class was created, not the
     * purchase. Null while the teacher has bought the tier and not yet set up their class.
     *
     * A timestamp, deliberately, and never a date. Cycles are counted in thirty times
     * twenty-four hours precisely so that a platform showing both Bikram Sambat and Gregorian
     * dates cannot end up with two different answers about how long somebody paid for.
     */
    cycleAnchor: timestamp("cycle_anchor", { withTimezone: true }),
    /** active | lapsed | suspended. */
    status: text("status").notNull().default("active"),
    /** Set when a suspension is served; the teacher may teach again after it. */
    suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
    /** Why, in words a teacher can read. Shown to them, so it is not a code. */
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One live plan per teacher. Enforced in the database rather than in a route, because two
    // routes disagreeing about "may this user be in this class?" is the exact bug this project
    // has already had once — see lib/membership.ts.
    uniqueIndex("teacher_plans_active_idx")
      .on(table.teacherId)
      .where(sql`status = 'active'`),
    index("teacher_plans_teacher_idx").on(table.teacherId, table.id),
  ],
);

export type TeacherPlan = typeof teacherPlansTable.$inferSelect;
