import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * What everybody did, and when.
 *
 * The owner asked for "a comprehensive activity log tracking every action taken by all users",
 * and the reason is customer care: an agent looking at a complaint needs to see what actually
 * happened rather than take either side's word for it. It is also the only way to answer the
 * questions nobody thinks to ask until they matter — who suspended this account, who reset
 * this password, when did this class change hands.
 *
 * Two things it is deliberately not:
 *
 * - **Not the attendance ledger.** That records presence in a class, in one row per person,
 *   updated as they come and go. This records events, append-only, and never changes.
 * - **Not application logs.** Those are for whoever is debugging the server and roll away.
 *   This is a record people are entitled to be shown, so it lives in the database.
 *
 * `userId` is nullable because not every action has a person behind it — a class expiring on
 * its own schedule, a payment webhook arriving. Those are real events and hiding them would
 * make the log less useful, not more.
 */
export const activityLogTable = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    /** Who did it. Null for something the server did on its own. */
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /**
     * What they did, as a dotted name: `session.started`, `account.suspended`,
     * `dispute.filed`. Named rather than free text so a log can be filtered and counted.
     */
    action: text("action").notNull(),
    /** What it was done to: "session", "user", "dispute", "review". Null for a plain event. */
    subjectType: text("subject_type"),
    subjectId: integer("subject_id"),
    /**
     * Anything else worth keeping, as JSON.
     *
     * Deliberately loose. The alternative is a column per fact, and a log that needs a schema
     * change to record something new is a log that stops recording things.
     *
     * **Nothing secret goes in here.** Not passwords, not tokens, not payment credentials — an
     * audit log is read by support agents, which is exactly the wrong audience for a secret.
     */
    detail: jsonb("detail"),
    /** The address the request came from, when there was one. Useful for an abuse report. */
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The two ways a log is actually read: everything one person did, and everything that
    // happened to one thing.
    index("activity_log_user_idx").on(table.userId, table.id),
    index("activity_log_subject_idx").on(table.subjectType, table.subjectId, table.id),
  ],
);

export type ActivityLogEntry = typeof activityLogTable.$inferSelect;
