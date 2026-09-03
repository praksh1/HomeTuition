import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Temporary, operator-granted permission to teach without paying for a plan.
 *
 * The owner needs a handful of real teacher accounts to create classes and use the whiteboard
 * during testing, without a plan payment that cannot be verified. The dangerous ways to do that
 * are all obvious and all rejected: flipping `subscription_active` for everybody, honouring a flag
 * the client sends, hardcoding an email address, treating production as development, or letting
 * the payment mock write a receipt that looks real.
 *
 * What this is instead: a row, with a name against it, a reason, and an end date. It bypasses the
 * **payment** door and nothing else — not email verification, not operator approval, not class
 * ownership, not membership, not the session allowance, not booking atomicity, not refunds.
 *
 * ## Why a table and not a column on `teacher_profiles`
 *
 * The API redeploys itself on push while `db:push` is run by hand, so between the two there is a
 * window where new code is live against the old schema. A new *column* on a table read with a bare
 * `select()` is a 500 during that window. A new *table* is only touched by new code. See
 * `.agents/memory/schema-change-deploy-window.md`.
 *
 * ## Reading a grant
 *
 * A grant is live when `revoked_at is null` and `valid_until > now()`. There is no "active" boolean
 * to fall out of step with the dates, and expiry needs no job to run — a grant nobody revokes
 * simply stops counting. Rows are kept after they lapse because the audit question is "who could
 * teach for free in August, and who said so", which a deleted row cannot answer.
 */
export const testTeachingGrantsTable = pgTable(
  "test_teaching_grants",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Which tier's allowance the grant carries.
     *
     * A grant still obeys a session limit. Free access to teach is not free access to teach without
     * end, and a test account that can create unlimited classes is not testing the product the
     * owner sells.
     */
    tier: text("tier").notNull(),
    /** The operator who granted it. `set null` only if that account is later deleted. */
    grantedBy: integer("granted_by").references(() => usersTable.id, { onDelete: "set null" }),
    /** Why, in the operator's words. Required by the route — an unexplained grant is unauditable. */
    reason: text("reason").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    /** When it stops working, with no action required from anybody. */
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => [
    // The hot read is "has this teacher a live grant", asked on every class creation.
    index("test_teaching_grants_teacher_idx").on(table.teacherId, table.validUntil),
  ],
);
