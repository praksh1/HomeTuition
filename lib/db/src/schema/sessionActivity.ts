import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";

/**
 * What actually happened to a class, as opposed to what was scheduled.
 *
 * A table of its own rather than columns on `sessions`, and that is not a style choice — it
 * was measured. Drizzle names every column of a table in its INSERT and in a bare `select()`,
 * and `sessions` is read with a bare select in several routes. Adding a column there breaks
 * every one of them from the moment the code deploys until someone runs `db:push`, and those
 * two are never in step: the API redeploys itself on a push while `db:push` is a command the
 * owner runs by hand. Keeping this separate means the worst case is that these two timestamps
 * are missing for a few minutes, not that classes cannot be read at all.
 *
 * A row appears when a class first starts. No row means a class that has never run.
 */
export const sessionActivityTable = pgTable("session_activity", {
  sessionId: integer("session_id")
    .primaryKey()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  /**
   * The last moment the teacher's classroom connection was known to be alive.
   *
   * This is what tells a force-closed browser apart from a lesson in progress. Without it a
   * teacher who force-quit was locked out of starting anything else until the class's own
   * length ran out, with no way back into the class either.
   */
  teacherLastSeenAt: timestamp("teacher_last_seen_at", { withTimezone: true }),
  /** When the class ended, however it ended: the teacher leaving, or being gone long enough. */
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export type SessionActivity = typeof sessionActivityTable.$inferSelect;
