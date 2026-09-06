import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * Temporary, operator-granted permission to **book** a test class without paying.
 *
 * The companion to `test_teaching_grants`, and deliberately its mirror image rather than a second
 * security model. Read that table's comment first; everything it says about why this is a table
 * and not a column, and about why a grant is read from dates rather than a boolean, applies here
 * unchanged.
 *
 * ## What problem this solves
 *
 * The owner has to walk the whole journey — find a class, book it, enter the real Daily classroom
 * — on the live site, while the payment gateway is configured and taking real money from real
 * students. Every quick way to do that is a way to give the public a free door: removing the
 * payment keys, a global "simulated payments" flag, running production as `NODE_ENV=test`, a
 * hardcoded owner email, or a client flag the server believes.
 *
 * This is the narrow way instead. Three separate things must all be true before one booking skips
 * the gateway:
 *
 * 1. `ALLOW_TEST_STUDENT_ACCESS` is on for this server;
 * 2. this student holds a live, unexpired, unrevoked grant in this table;
 * 3. **this class is marked a test class** in `test_classes`.
 *
 * Any one of them missing and the booking goes to the gateway like anybody else's. That is why a
 * test student cannot get a free seat in an ordinary teacher's paid class, and why an ordinary
 * student booking a test class still pays.
 *
 * ## What it does not open
 *
 * Payment, and only payment. Not email verification, not onboarding, not a suspension, not
 * membership, not the classroom clock, not seat limits, not booking atomicity. And the enrolment
 * it writes is never `paid`: it is `test`, with `payment_method = 'test_access'` and no gateway
 * reference, so no report that counts money can mistake it for one.
 */
export const testStudentGrantsTable = pgTable(
  "test_student_grants",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
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
    // The hot read is "has this student a live grant", asked on every booking of a test class.
    index("test_student_grants_student_idx").on(table.studentId, table.validUntil),
  ],
);

/**
 * The classes that were created under a teacher's test grant, written down once and kept.
 *
 * **A class is test or it is not, and that is decided the moment it is created.** The tempting
 * shortcut — ask at booking time whether the teacher currently holds a test grant — is wrong in
 * both directions and quietly so. A teacher whose grant lapses on Tuesday would have Monday's
 * test classes turn into paid ones nobody paid for; a teacher granted access on Friday would have
 * every class they ever ran retroactively become free to any test student. Neither is a decision
 * anybody made. So the fact is recorded when it is true and never re-derived.
 *
 * Keyed by session id, one row per class, and nothing here is ever updated: a class cannot stop
 * having been a test class.
 */
export const testClassesTable = pgTable("test_classes", {
  sessionId: integer("session_id")
    .primaryKey()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  /** The teacher who created it, copied so the audit question survives the session being deleted. */
  teacherId: integer("teacher_id").references(() => usersTable.id, { onDelete: "set null" }),
  /**
   * The teacher grant that was live when this class was created.
   *
   * Informational, not a foreign key that anything reads back: the grant may be revoked, expire or
   * be superseded, and none of that changes what this class already is.
   */
  grantId: integer("grant_id"),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
});
