import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// Additive and awaited by quiz routes: a failed migration never breaks auth or paid bookings.
export const QUIZ_DDL = [
  `CREATE TABLE IF NOT EXISTS class_quizzes (
    id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES learning_program_batches(id) ON DELETE CASCADE,
    teacher_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title text NOT NULL, questions jsonb NOT NULL, status text NOT NULL DEFAULT 'draft',
    revision integer NOT NULL DEFAULT 1, due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS class_quizzes_batch_idx ON class_quizzes(batch_id, id)`,
  `ALTER TABLE class_quizzes ADD COLUMN IF NOT EXISTS request_key text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS class_quizzes_request_idx ON class_quizzes(batch_id, request_key)`,
  `CREATE TABLE IF NOT EXISTS class_quiz_attempts (
    id serial PRIMARY KEY, quiz_id integer NOT NULL REFERENCES class_quizzes(id) ON DELETE CASCADE,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, revision integer NOT NULL,
    answers jsonb NOT NULL, score integer NOT NULL, possible integer NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS class_quiz_attempt_once_idx ON class_quiz_attempts(quiz_id, student_id)`,
] as const;
let ready: Promise<void> | null = null;
export function ensureQuizSchema(): Promise<void> {
  if (!ready) ready = db.transaction(async tx => {
    // Serializes first use across deployment replicas, including CREATE TYPE/index races.
    await tx.execute(sql`select pg_advisory_xact_lock(741296238)`);
    for (const statement of QUIZ_DDL) await tx.execute(sql.raw(statement));
  }).catch(error => { ready = null; throw error; });
  return ready;
}
