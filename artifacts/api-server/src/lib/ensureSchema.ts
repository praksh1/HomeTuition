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


/**
 * Brings the tables the support desk needs up to date.
 *
 * Additive and idempotent throughout: new nullable columns and a new table, nothing dropped,
 * renamed or narrowed. Grouped into one call because they arrive together and are useless
 * apart — an agent who can suspend an account but cannot record why has a worse tool than none.
 */
export async function ensureSupportDeskSchema(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone`);
    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_reason" text`);
    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_by" integer`);

    await db.execute(sql`ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "resolution" text`);
    await db.execute(sql`ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "resolved_by" integer`);
    await db.execute(sql`ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "password_resets" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "code_hash" text NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "used_at" timestamp with time zone,
        "issued_by" integer,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "password_resets_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "password_resets_issued_by_users_id_fk"
          FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "password_resets_user_idx" ON "password_resets" ("user_id", "id")
    `);
    logger.info("support desk tables are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not prepare the support desk tables; run `pnpm run db:push`. " +
        "The app works — but an agent cannot suspend an account, record a decision on a " +
        "ticket, or issue a password reset until this succeeds.",
    );
  }
}


/**
 * Creates the tables behind rescheduling and refunds if they are not there yet.
 *
 * Same narrow licence as the others: create only, additive only, unable to stop the server
 * starting. Grouped because they arrive together — a schedule change writes one row and may
 * owe several refunds, and half of that working is worse than none of it.
 */
export async function ensureScheduleAndRefundTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "schedule_changes" (
        "id" serial PRIMARY KEY,
        "session_id" integer NOT NULL,
        "teacher_id" integer NOT NULL,
        "previous_date" timestamp with time zone NOT NULL,
        "new_date" timestamp with time zone NOT NULL,
        "affected_students" integer NOT NULL DEFAULT 0,
        "changed_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "schedule_changes_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "schedule_changes_teacher_id_users_id_fk"
          FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "schedule_changes_teacher_idx"
        ON "schedule_changes" ("teacher_id", "changed_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "schedule_changes_session_idx"
        ON "schedule_changes" ("session_id", "id")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "refunds" (
        "id" serial PRIMARY KEY,
        "session_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "price_paid" integer NOT NULL,
        "amount" integer NOT NULL,
        "teacher_share" integer NOT NULL DEFAULT 0,
        "platform_share" integer NOT NULL DEFAULT 0,
        "reason" text NOT NULL,
        "status" text NOT NULL DEFAULT 'owed',
        "note" text,
        "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
        "paid_at" timestamp with time zone,
        "paid_by" integer,
        CONSTRAINT "refunds_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "refunds_student_id_users_id_fk"
          FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "refunds_paid_by_users_id_fk"
          FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "refunds_status_idx" ON "refunds" ("status", "id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "refunds_student_idx" ON "refunds" ("student_id", "id")
    `);
    logger.info("schedule change and refund tables are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the schedule and refund tables; run `pnpm run db:push`. " +
        "Classes still run — but a teacher cannot move one and a student cannot drop one, " +
        "and both will be refused rather than half-completed.",
    );
  }
}

/**
 * Creates the monthly tier's four tables if they are not there yet.
 *
 * Same narrow licence as everything above: create only, additive only, unable to stop the
 * server starting. It matters as much as `ensureSessionActivityTable` did, and for the same
 * measured reason — the routes that read these sit in the path a teacher takes to **buy the
 * tier and set up their class**, and without the tables that is a 500 rather than a message.
 *
 * The unique indexes are created here as well as in the schema, deliberately. They are not
 * tidiness: `recurring_enrollments_once_idx` is what actually stops a student being charged
 * twice for one cycle, and `recurring_days_slot_idx` is what stops a retried cycle generation
 * doubling the ledger every refund is counted from. Both must exist from the first boot after
 * a deploy, not from whenever `db:push` is next run by hand.
 */
export async function ensureMonthlyTierTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "teacher_plans" (
        "id" serial PRIMARY KEY,
        "teacher_id" integer NOT NULL,
        "price" integer NOT NULL,
        "platform_share" integer NOT NULL DEFAULT 0,
        "purchased_at" timestamp with time zone NOT NULL DEFAULT now(),
        "cycle_anchor" timestamp with time zone,
        "status" text NOT NULL DEFAULT 'active',
        "suspended_until" timestamp with time zone,
        "suspended_reason" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "teacher_plans_teacher_id_users_id_fk"
          FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "teacher_plans_active_idx"
        ON "teacher_plans" ("teacher_id") WHERE status = 'active'
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "teacher_plans_teacher_idx" ON "teacher_plans" ("teacher_id", "id")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "recurring_sessions" (
        "id" serial PRIMARY KEY,
        "plan_id" integer NOT NULL,
        "teacher_id" integer NOT NULL,
        "subject" text NOT NULL,
        "topic" text NOT NULL,
        "start_minute" integer NOT NULL,
        "duration_minutes" integer NOT NULL DEFAULT 60,
        "time_zone" text NOT NULL DEFAULT 'Asia/Kathmandu',
        "monthly_price" integer NOT NULL,
        "max_students" integer NOT NULL DEFAULT 45,
        "status" text NOT NULL DEFAULT 'active',
        "time_changed_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "recurring_sessions_plan_id_teacher_plans_id_fk"
          FOREIGN KEY ("plan_id") REFERENCES "teacher_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "recurring_sessions_teacher_id_users_id_fk"
          FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_sessions_teacher_idx"
        ON "recurring_sessions" ("teacher_id", "status")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_sessions_plan_idx" ON "recurring_sessions" ("plan_id")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "recurring_days" (
        "id" serial PRIMARY KEY,
        "recurring_id" integer NOT NULL,
        "session_id" integer,
        "cycle_index" integer NOT NULL,
        "kind" text NOT NULL DEFAULT 'regular',
        "scheduled_for" timestamp with time zone NOT NULL,
        "status" text NOT NULL DEFAULT 'planned',
        "held_at" timestamp with time zone,
        "missed_at" timestamp with time zone,
        "makeup_for_id" integer,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "recurring_days_recurring_id_recurring_sessions_id_fk"
          FOREIGN KEY ("recurring_id") REFERENCES "recurring_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "recurring_days_session_id_sessions_id_fk"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_days_cycle_idx"
        ON "recurring_days" ("recurring_id", "cycle_index", "status")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_days_schedule_idx"
        ON "recurring_days" ("recurring_id", "scheduled_for")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_days_makeup_idx" ON "recurring_days" ("makeup_for_id")
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "recurring_days_slot_idx"
        ON "recurring_days" ("recurring_id", "scheduled_for", "kind")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "recurring_enrollments" (
        "id" serial PRIMARY KEY,
        "recurring_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "cycle_index" integer NOT NULL,
        "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
        "amount_paid" integer NOT NULL,
        "platform_share" integer NOT NULL DEFAULT 0,
        "teacher_share" integer NOT NULL DEFAULT 0,
        "sessions_paid_for" integer NOT NULL,
        "sessions_planned" integer NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "ended_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "recurring_enrollments_recurring_id_recurring_sessions_id_fk"
          FOREIGN KEY ("recurring_id") REFERENCES "recurring_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "recurring_enrollments_student_id_users_id_fk"
          FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "recurring_enrollments_once_idx"
        ON "recurring_enrollments" ("recurring_id", "student_id", "cycle_index")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_enrollments_student_idx"
        ON "recurring_enrollments" ("student_id", "status")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "recurring_enrollments_cycle_idx"
        ON "recurring_enrollments" ("recurring_id", "cycle_index")
    `);
    logger.info("monthly tier tables are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the monthly tier tables; run `pnpm run db:push`. " +
        "Ordinary classes still run — only the monthly recurring tier is affected, and it " +
        "refuses rather than half-completing.",
    );
  }
}

/**
 * Brings the tables the monthly tier's enforcement writes to up to date.
 *
 * Two changes, both additive, and one of them is an `ALTER` — same licence as
 * `ensureDisputeColumns`, which already drops a NOT NULL at boot for the same reason: the API
 * redeploys itself and `db:push` is run by hand, and the gap between them is where a 500 lives.
 *
 * Dropping NOT NULL from `refunds.session_id` cannot break a reader. The agent's queue already
 * left-joins the class, so it is already written for a row that has none, and the one place
 * that matches on `session_id` is asking about a specific class — a monthly row simply is not
 * an answer to that question.
 */
export async function ensureMonthlyEnforcementColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE "refunds" ALTER COLUMN "session_id" DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "recurring_id" integer`);
    await db.execute(sql`ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "cycle_index" integer`);
    await db.execute(sql`
      ALTER TABLE "teacher_plans"
        ADD COLUMN IF NOT EXISTS "warned_at_abuses" integer NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE "teacher_plans"
        ADD COLUMN IF NOT EXISTS "settled_through_cycle" integer NOT NULL DEFAULT -1
    `);
    logger.info("monthly enforcement columns are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not update the tables the monthly tier settles money in; run `pnpm run db:push`. " +
        "Classes still run and students can still join — but a month cannot be closed, so no " +
        "refund is written and nobody is suspended, and both wait rather than half-happening.",
    );
  }
}

/**
 * Creates the homework tables and opens the class thread to a monthly course.
 *
 * Same licence as everything above: create only, additive only, unable to stop the server
 * starting. Dropping NOT NULL from `session_messages.session_id` is safe for the same reason it
 * was on `refunds`: the one other reader matches on a specific class, and a monthly row is
 * simply not an answer to that question.
 */
export async function ensureMonthlyPortalTables(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE "session_messages" ALTER COLUMN "session_id" DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE "session_messages" ADD COLUMN IF NOT EXISTS "recurring_id" integer`);
    await db.execute(sql`
      ALTER TABLE "session_messages" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone
    `);
    await db.execute(sql`ALTER TABLE "session_messages" ADD COLUMN IF NOT EXISTS "pinned_by" integer`);
    await db.execute(sql`
      DO $$
      BEGIN
        ALTER TABLE "session_messages"
          ADD CONSTRAINT "session_messages_pinned_by_users_id_fk"
          FOREIGN KEY ("pinned_by") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "session_messages_recurring_idx"
        ON "session_messages" ("recurring_id", "id")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "homework" (
        "id" serial PRIMARY KEY,
        "recurring_id" integer NOT NULL,
        "teacher_id" integer NOT NULL,
        "cycle_index" integer NOT NULL,
        "title" text NOT NULL,
        "instructions" text,
        "file_key" text,
        "file_type" text,
        "due_at" timestamp with time zone,
        "status" text NOT NULL DEFAULT 'open',
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "homework_recurring_id_recurring_sessions_id_fk"
          FOREIGN KEY ("recurring_id") REFERENCES "recurring_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "homework_teacher_id_users_id_fk"
          FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "homework_class_idx" ON "homework" ("recurring_id", "cycle_index")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "homework_teacher_idx" ON "homework" ("teacher_id", "id")
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "homework_submissions" (
        "id" serial PRIMARY KEY,
        "homework_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "file_key" text NOT NULL,
        "file_type" text NOT NULL,
        "note" text,
        "submitted_at" timestamp with time zone NOT NULL DEFAULT now(),
        "status" text NOT NULL DEFAULT 'submitted',
        "feedback" text,
        "annotated_key" text,
        "annotated_type" text,
        "annotation" text,
        "returned_at" timestamp with time zone,
        CONSTRAINT "homework_submissions_homework_id_homework_id_fk"
          FOREIGN KEY ("homework_id") REFERENCES "homework"("id") ON DELETE CASCADE,
        CONSTRAINT "homework_submissions_student_id_users_id_fk"
          FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "homework_submissions_once_idx"
        ON "homework_submissions" ("homework_id", "student_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "homework_submissions_student_idx"
        ON "homework_submissions" ("student_id", "id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "homework_submissions_status_idx"
        ON "homework_submissions" ("homework_id", "status")
    `);
    logger.info("monthly portal tables are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not ensure the monthly portal tables; run `pnpm run db:push`. " +
        "Classes still run — only the monthly course's group chat and homework are affected, " +
        "and both refuse rather than half-working.",
    );
  }
}

/**
 * Adds the ticket lifecycle: the new statuses, who a ticket is assigned to, and its history.
 *
 * Same licence as everything above: additive only, and unable to stop the server starting.
 *
 * `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is the one statement here that is not a plain create.
 * It cannot remove a value or change one, and a status a row already carries keeps working — so
 * a deploy that lands before `db:push` widens the enum and nothing narrows.
 */
export async function ensureTicketLifecycle(): Promise<void> {
  try {
    for (const value of ["opened", "assigned", "processing", "denied", "cancelled"]) {
      await db.execute(sql.raw(`ALTER TYPE "dispute_status" ADD VALUE IF NOT EXISTS '${value}'`));
    }

    await db.execute(sql`ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "assigned_to" integer`);
    await db.execute(sql`
      ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone
    `);
    await db.execute(sql`
      ALTER TABLE "disputes"
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        ALTER TABLE "disputes"
          ADD CONSTRAINT "disputes_assigned_to_users_id_fk"
          FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "ticket_events" (
        "id" serial PRIMARY KEY,
        "ticket_id" integer NOT NULL,
        "actor_id" integer,
        "actor_role" text NOT NULL,
        "actor_name" text,
        "from_status" text,
        "to_status" text NOT NULL,
        "note" text,
        "file_key" text,
        "file_type" text,
        "internal" boolean NOT NULL DEFAULT false,
        "at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "ticket_events_ticket_id_disputes_id_fk"
          FOREIGN KEY ("ticket_id") REFERENCES "disputes"("id") ON DELETE CASCADE,
        CONSTRAINT "ticket_events_actor_id_users_id_fk"
          FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "ticket_events_ticket_idx" ON "ticket_events" ("ticket_id", "id")
    `);
    logger.info("ticket lifecycle is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not add the ticket lifecycle; run `pnpm run db:push`. " +
        "Support requests can still be filed and read — but they cannot be moved through their " +
        "stages, so an agent's update is refused rather than half-recorded.",
    );
  }
}

/**
 * The operators' own accounts.
 *
 * Create-only, like every guard in this file, and a new table rather than columns on `users`
 * for the reason recorded in the schema itself: a new column on `users` takes sign-in down for
 * everybody until `db:push` runs, and the API redeploys itself while `db:push` does not.
 */
export async function ensureOperatorAccounts(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "operator_accounts" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "login_id" text NOT NULL,
        "is_administrator" boolean NOT NULL DEFAULT false,
        "must_change_password" boolean NOT NULL DEFAULT true,
        "created_by" integer,
        "disabled_at" timestamp with time zone,
        "disabled_by" integer,
        "last_sign_in_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "operator_accounts_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "operator_accounts_created_by_users_id_fk"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "operator_accounts_disabled_by_users_id_fk"
          FOREIGN KEY ("disabled_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    // One operator account per person, and one person per login ID — enforced by the database
    // rather than by a check-then-insert, which two administrators can both pass at once.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "operator_accounts_user_idx" ON "operator_accounts" ("user_id")
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "operator_accounts_login_idx" ON "operator_accounts" ("login_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "operator_accounts_created_idx" ON "operator_accounts" ("created_at")
    `);
    logger.info("operator accounts are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not create the operator accounts table; run `pnpm run db:push`. " +
        "The support desk still works for whoever can already sign in — but no new operator " +
        "can be issued an ID, and nobody can be forced to change a one-time password.",
    );
  }
}

/**
 * The days a teacher has said they are away.
 *
 * Create-only, like every guard here. A new table rather than a column, for the reason recorded
 * in `.agents/memory/schema-change-deploy-window.md`: the API redeploys itself and `db:push` is
 * a step somebody has to remember, and in that window a new column on an existing table takes
 * sign-in down for everybody.
 */
export async function ensureTeacherLeave(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "teacher_leave" (
        "id" serial PRIMARY KEY,
        "teacher_id" integer NOT NULL,
        "starts_at" timestamp with time zone NOT NULL,
        "ends_at" timestamp with time zone NOT NULL,
        "reason" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "teacher_leave_teacher_id_users_id_fk"
          FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "teacher_leave_teacher_idx" ON "teacher_leave" ("teacher_id", "starts_at")
    `);
    logger.info("teacher leave is present");
  } catch (err) {
    logger.warn(
      { err },
      "could not create the teacher leave table; run `pnpm run db:push`. " +
        "Monthly classes still work — but a teacher cannot mark themselves away, so nothing " +
        "stops a make-up being scheduled onto a day they will miss.",
    );
  }
}

/**
 * Files and reactions on messages.
 *
 * New tables rather than columns on `messages`, deliberately: two routes read that table with
 * a bare `select()`, so a column declared before `db:push` runs turns listing conversations
 * and opening a thread into 500s for the length of the deploy window. See
 * `.agents/memory/schema-change-deploy-window.md`, and the comment on the schema itself.
 */
export async function ensureMessageExtras(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "message_attachments" (
        "id" serial PRIMARY KEY,
        "message_id" integer NOT NULL,
        "file_key" text NOT NULL,
        "file_type" text NOT NULL,
        "file_name" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "message_attachments_message_id_messages_id_fk"
          FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "message_attachments_message_idx" ON "message_attachments" ("message_id")
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "message_reactions" (
        "id" serial PRIMARY KEY,
        "message_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "emoji" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "message_reactions_message_id_messages_id_fk"
          FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE,
        CONSTRAINT "message_reactions_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    /*
     * One per person per message, enforced by the database rather than by reading first and
     * then writing — two taps in quick succession both pass that read.
     */
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_one_each_idx"
        ON "message_reactions" ("message_id", "user_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "message_reactions_message_idx" ON "message_reactions" ("message_id")
    `);
    logger.info("message attachments and reactions are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not create the message attachment and reaction tables; run `pnpm run db:push`. " +
        "Messages still send and arrive — but a file cannot be attached to one, and reacting " +
        "to a message will fail.",
    );
  }
}

/**
 * Files and reactions on class messages.
 *
 * The private-message pair's twin — see `ensureMessageExtras`. Separate tables because a class
 * message and a private message have different answers to "who may read this", and one table
 * with two nullable keys is one forgotten `where` away from a private attachment surfacing in
 * a classroom.
 */
export async function ensureSessionMessageExtras(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session_message_attachments" (
        "id" serial PRIMARY KEY,
        "message_id" integer NOT NULL,
        "file_key" text NOT NULL,
        "file_type" text NOT NULL,
        "file_name" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "session_message_attachments_message_id_fk"
          FOREIGN KEY ("message_id") REFERENCES "session_messages"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "session_message_attachments_message_idx"
        ON "session_message_attachments" ("message_id")
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session_message_reactions" (
        "id" serial PRIMARY KEY,
        "message_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "emoji" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "session_message_reactions_message_id_fk"
          FOREIGN KEY ("message_id") REFERENCES "session_messages"("id") ON DELETE CASCADE,
        CONSTRAINT "session_message_reactions_user_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "session_message_reactions_one_each_idx"
        ON "session_message_reactions" ("message_id", "user_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "session_message_reactions_message_idx"
        ON "session_message_reactions" ("message_id")
    `);
    logger.info("class message attachments and reactions are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not create the class message attachment and reaction tables; run `pnpm run db:push`. " +
        "Class chat still works — but a file cannot be sent in one, and reacting will fail.",
    );
  }
}

/**
 * Account security, onboarding, credential review, and moderation tables.
 *
 * These are deliberately new tables instead of columns on `users` or the two profile tables.
 * Railway deploys code before anybody can run `db:push`; an additive `CREATE TABLE IF NOT
 * EXISTS` keeps every existing sign-in and class route alive throughout that window.
 */
export async function ensureAccountOnboardingTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "account_security" (
        "user_id" integer PRIMARY KEY,
        "email_verified_at" timestamp with time zone,
        "password_auth_enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "account_security_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "account_tokens" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "purpose" text NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "used_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "account_tokens_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "account_tokens_hash_idx" ON "account_tokens" ("token_hash")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "account_tokens_user_idx" ON "account_tokens" ("user_id", "purpose", "id")`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "external_identities" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "provider" text NOT NULL,
        "provider_subject" text NOT NULL,
        "provider_email" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "external_identities_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_provider_subject_idx" ON "external_identities" ("provider", "provider_subject")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "external_identities_user_idx" ON "external_identities" ("user_id", "id")`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user_onboarding" (
        "user_id" integer PRIMARY KEY,
        "date_of_birth" date,
        "phone" text,
        "province" text,
        "district" text,
        "local_level" text,
        "locality" text,
        "institution_name" text,
        "affiliation_status" text,
        "guardian_name" text,
        "guardian_email" text,
        "guardian_phone" text,
        "guardian_relationship" text,
        "profile_photo_key" text,
        "completed_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "user_onboarding_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "teacher_credentials" (
        "id" serial PRIMARY KEY,
        "teacher_id" integer NOT NULL,
        "document_type" text NOT NULL,
        "file_key" text NOT NULL,
        "original_name" text NOT NULL,
        "content_type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'submitted',
        "opened_at" timestamp with time zone,
        "opened_by" integer,
        "reviewed_at" timestamp with time zone,
        "reviewed_by" integer,
        "rejection_reason" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "teacher_credentials_teacher_id_users_id_fk"
          FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "teacher_credentials_opened_by_users_id_fk"
          FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "teacher_credentials_reviewed_by_users_id_fk"
          FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "teacher_credentials_teacher_idx" ON "teacher_credentials" ("teacher_id", "document_type", "id")`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "moderation_flags" (
        "id" serial PRIMARY KEY,
        "user_id" integer,
        "surface" text NOT NULL,
        "subject_id" integer,
        "excerpt" text NOT NULL,
        "matched_terms" text[] NOT NULL DEFAULT '{}',
        "status" text NOT NULL DEFAULT 'open',
        "resolved_by" integer,
        "resolution" text,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "resolved_at" timestamp with time zone,
        CONSTRAINT "moderation_flags_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "moderation_flags_resolved_by_users_id_fk"
          FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "moderation_flags_status_idx" ON "moderation_flags" ("status", "id")`);
    logger.info("account security and onboarding tables are present");
  } catch (err) {
    logger.warn(
      { err },
      "could not prepare account security and onboarding tables; run `pnpm run db:push`. " +
        "Existing accounts still work, but verification, onboarding, credentials, and moderation are unavailable.",
    );
  }
}
