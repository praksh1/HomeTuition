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


/**
 * Creates the participation table if it is not there yet.
 *
 * Same narrow licence as the three above: create only, additive only, unable to stop the
 * server starting. This one is written from inside the classroom hub, on every join and every
 * flush, so a missing table would otherwise throw on the busiest path in the product. It does
 * not — `recordParticipation` swallows its own errors — but the gap it leaves is worse than
 * the usual one: the evidence for a lesson taught during those minutes is not late, it is
 * gone, and a refund argued weeks later has nothing to read.
 */
export async function ensureSessionParticipationTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session_participation" (
        "session_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "role" text NOT NULL,
        "first_joined_at" timestamp with time zone NOT NULL DEFAULT now(),
        "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
        "present_ms" integer NOT NULL DEFAULT 0,
        "join_count" integer NOT NULL DEFAULT 0,
        "draw_count" integer NOT NULL DEFAULT 0,
        "message_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "session_participation_session_id_user_id_pk"
          PRIMARY KEY ("session_id", "user_id"),
        CONSTRAINT "session_participation_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "session_participation_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    logger.info("session participation table is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the session participation table; run `pnpm run db:push`. " +
        "Classes still run — but nothing is being recorded about who attended them, so a " +
        "refund argued over one of these lessons will have no evidence to read.",
    );
  }
}


/**
 * Brings the disputes table up to date if it is behind.
 *
 * This one goes slightly beyond "create a new table", so it is worth being explicit about
 * what it does and why that is still safe:
 *
 * - `ADD COLUMN IF NOT EXISTS session_id` — additive, nullable, and does nothing on a database
 *   that already has it. Without it, `disputes` is read with a bare `select()` in
 *   /disputes/mine, so the moment the code knows about the column and the database does not,
 *   every report a user has ever filed becomes a 500.
 * - `ALTER COLUMN evidence_url DROP NOT NULL` — strictly widening. It cannot fail on existing
 *   rows, cannot lose data, and is idempotent. Requiring a file was wrong for the person who
 *   most needs to file a report: a student whose teacher never arrived has nothing to attach.
 *
 * Nothing here drops, renames, or narrows anything, and none of it can stop the server
 * starting. Anything that does belongs in `db:push`, where a human can see it first.
 */
export async function ensureDisputeColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "session_id" integer`);
    // Added separately and tolerantly: the constraint may already be there from `db:push`, and
    // a duplicate is not a reason to leave the column unusable.
    await db.execute(sql`
      DO $$
      BEGIN
        ALTER TABLE "disputes"
          ADD CONSTRAINT "disputes_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await db.execute(sql`ALTER TABLE "disputes" ALTER COLUMN "evidence_url" DROP NOT NULL`);
    logger.info("disputes table is up to date");
  } catch (err) {
    logger.warn(
      { err },
      "could not update the disputes table; run `pnpm run db:push`. " +
        "Reports about a specific class, and reports filed without a file attached, will be " +
        "refused until it is.",
    );
  }
}


/**
 * Creates the session message table if it is not there yet.
 *
 * Same narrow licence as the others: create only, additive only, unable to stop the server
 * starting. This one carries a teacher's "running ten minutes late" and the thread a refund is
 * argued from, so a gap here is not a cosmetic one — the messages sent during those minutes
 * are refused, and the person sending them is told the class has no thread.
 */
export async function ensureSessionMessagesTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session_messages" (
        "id" serial PRIMARY KEY,
        "session_id" integer NOT NULL,
        "sender_id" integer NOT NULL,
        "sender_name" text NOT NULL,
        "sender_role" text NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "session_messages_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "session_messages_sender_id_users_id_fk"
          FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "session_messages_session_id_idx"
        ON "session_messages" ("session_id", "id")
    `);
    logger.info("session messages table is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the session messages table; run `pnpm run db:push`. " +
        "Classes still run — but the message thread on a class is unavailable, which is how a " +
        "late teacher tells the people waiting for them.",
    );
  }
}


/**
 * Creates the activity log if it is not there yet.
 *
 * Same narrow licence as the others. This one is written from a middleware on every request
 * that changes anything, so a missing table would otherwise be the loudest failure in the
 * product; it is not, because `recordActivity` swallows its own errors. What is lost while it
 * is missing cannot be recovered — an audit log has no way to backfill what nobody wrote down.
 */
export async function ensureActivityLogTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "activity_log" (
        "id" serial PRIMARY KEY,
        "user_id" integer,
        "action" text NOT NULL,
        "subject_type" text,
        "subject_id" integer,
        "detail" jsonb,
        "ip" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "activity_log_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "activity_log_user_idx" ON "activity_log" ("user_id", "id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "activity_log_subject_idx"
        ON "activity_log" ("subject_type", "subject_id", "id")
    `);
    logger.info("activity log table is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the activity log table; run `pnpm run db:push`. " +
        "Everything still works — but nothing is being recorded about who did what, and a " +
        "support agent looking at a complaint from this period will have nothing to read.",
    );
  }
}


/**
 * Adds the reasons a report can be filed under, if the database is behind.
 *
 * `ADD VALUE IF NOT EXISTS` on an enum is additive and idempotent: it cannot remove a value,
 * cannot rewrite a row, and does nothing on a database that already has it. Without it, a
 * server that knows about "Refund Request" and a database that does not would reject every
 * refund request with a foreign-looking database error, and refunds are the reports that
 * matter most.
 */
export async function ensureDisputeReasons(): Promise<void> {
  try {
    await db.execute(sql`ALTER TYPE "dispute_reason" ADD VALUE IF NOT EXISTS 'Refund Request'`);
    logger.info("dispute reasons are up to date");
  } catch (err) {
    logger.warn(
      { err },
      "could not add the refund reason; run `pnpm run db:push`. " +
        "Reports still work — a refund request just cannot be filed under its own reason.",
    );
  }
}
