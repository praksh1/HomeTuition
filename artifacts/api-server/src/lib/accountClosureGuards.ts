import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
/** Additive, feature-local guards. All booking generations share the same user-row lock as closure.
 * No HTTP check alone can prevent a request authenticated just before closure committing afterward.
 * Does not block a pending closure request or decide any refund/settlement.
 */
export async function installAccountClosureGuards() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
    await tx.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION fadko_guard_closed_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE payload jsonb; student integer; teacher integer; account record;
      BEGIN
        payload=to_jsonb(NEW);
        student=(payload->>'student_id')::integer;
        teacher=(payload->>'teacher_id')::integer;
        IF TG_TABLE_NAME='session_enrollments' THEN
          SELECT teacher_id INTO teacher FROM sessions WHERE id=(payload->>'session_id')::integer;
        ELSIF TG_TABLE_NAME IN ('learning_program_batches','learning_program_enrollments') THEN
          SELECT teacher_id INTO teacher FROM learning_programs WHERE id=(payload->>'program_id')::integer;
        ELSIF TG_TABLE_NAME IN ('batch_test_bookings','learning_program_batch_lessons') THEN
          SELECT p.teacher_id INTO teacher FROM learning_program_batches b JOIN learning_programs p ON p.id=b.program_id WHERE b.id=(payload->>'batch_id')::integer;
        ELSIF TG_TABLE_NAME IN ('recurring_enrollments','recurring_days') THEN
          SELECT teacher_id INTO teacher FROM recurring_sessions WHERE id=(payload->>'recurring_id')::integer;
        END IF;
        FOR account IN SELECT id FROM users WHERE id IN (student,teacher) ORDER BY id FOR SHARE LOOP
          IF EXISTS(SELECT 1 FROM account_closure_requests WHERE user_id=account.id AND status='closed') THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Account closure prevents a new or changed teaching commitment.';
          END IF;
        END LOOP;
        RETURN NEW;
      END $$`),
    );
    for (const table of [
      "sessions",
      "session_enrollments",
      "learning_programs",
      "learning_program_batches",
      "learning_program_batch_lessons",
      "learning_program_enrollments",
      "batch_test_bookings",
      "recurring_sessions",
      "recurring_enrollments",
      "recurring_days",
    ]) {
      // Identifiers are a fixed source-controlled allowlist, never request input.
      await tx.execute(
        sql.raw(`DROP TRIGGER IF EXISTS fadko_closed_commitment ON ${table}`),
      );
      await tx.execute(
        sql.raw(`CREATE TRIGGER fadko_closed_commitment BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION fadko_guard_closed_commitment()`),
      );
    }
  });
}
