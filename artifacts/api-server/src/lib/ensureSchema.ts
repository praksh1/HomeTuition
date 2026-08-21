import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Creates the notification-preferences table if it is not there yet.
 *
 * This is **not** a migration system and must not grow into one. `pnpm run db:push` remains
 * how this project's schema changes; the reason for this one exception is the shape of the
 * deploy: the API redeploys itself on every push, while `db:push` is a command the owner runs
 * by hand from his laptop. Those two are never in step, and the owner should not have to be
 * the thing that keeps them in step.
 *
 * What makes it safe to do at boot:
 *
 * - It only ever *creates*. `IF NOT EXISTS` means it does nothing on a database that already
 *   has the table, and there is no statement here that can drop, alter or rewrite anything.
 * - It cannot stop the server starting. If it fails — no permission, database asleep — it is
 *   logged and the app runs; the only thing that does not work is the notifications settings
 *   screen, which already answers with the defaults when it has nothing stored.
 *
 * Anything beyond adding a new, empty, additive table belongs in `db:push`, where a human can
 * see what it is about to do.
 */
export async function ensureNotificationPrefsTable(): Promise<void> {
  try {
    // The foreign key is named explicitly to match what drizzle-kit generates. Left to
    // Postgres it would be `..._user_id_fkey`, and `db:push` would then drop and recreate it
    // on every run — harmless, but it makes a no-op push look like a schema change.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user_notification_prefs" (
        "user_id" integer PRIMARY KEY,
        "prefs" jsonb NOT NULL,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "user_notification_prefs_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    logger.info("notification preferences table is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the notification preferences table; run `pnpm run db:push`. " +
        "Everything else works — only the notifications settings screen is affected.",
    );
  }
}


/**
 * Creates the session-activity table if it is not there yet.
 *
 * Same reasoning as above, and the same narrow licence: create only, additive only, and
 * unable to stop the server starting. This one matters more than the last, because the code
 * that reads it sits in the path a teacher takes to **start a class** — without the table,
 * going live returns a 500 and the whole product stops working until someone runs `db:push`.
 * That was measured, not guessed, after shipping exactly that.
 */
export async function ensureSessionActivityTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session_activity" (
        "session_id" integer PRIMARY KEY,
        "teacher_last_seen_at" timestamp with time zone,
        "ended_at" timestamp with time zone,
        CONSTRAINT "session_activity_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE
      )
    `);
    logger.info("session activity table is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the session activity table; run `pnpm run db:push`. " +
        "Classes still start and run — only the rules about restarting an old class and " +
        "recovering from a force-closed browser fall back to the older behaviour.",
    );
  }
}


/**
 * Creates the whiteboard table if it is not there yet.
 *
 * Same narrow licence as the two above: create only, additive only, unable to stop the server
 * starting. Without it a deploy would run for a few minutes with code that stores boards and
 * a database with nowhere to put them — and the failure would be silent, which is the worst
 * shape for something whose whole job is not losing a lesson.
 */
export async function ensureSessionBoardTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session_board" (
        "session_id" integer PRIMARY KEY,
        "scene" jsonb,
        "files" jsonb,
        "view" jsonb,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "session_board_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE
      )
    `);
    logger.info("session board table is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the session board table; run `pnpm run db:push`. " +
        "Classes still run — a whiteboard just will not survive a server restart.",
    );
  }
}
