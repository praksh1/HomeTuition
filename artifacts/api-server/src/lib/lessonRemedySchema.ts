import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertLessonRemedyStorage, type RemedyStorageCatalog } from "./lessonRemedySchemaChecks.ts";

/** New tables only; no changes to existing bookings, sessions, people or payment columns. */
export const LESSON_REMEDY_DDL = [
  `CREATE TABLE IF NOT EXISTS lesson_remedy_cases (
    id serial PRIMARY KEY, original_booking_id integer NOT NULL REFERENCES batch_test_bookings(id) ON DELETE RESTRICT,
    original_position integer NOT NULL CHECK(original_position>=0), original_session_id integer NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, teacher_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK(reason IN ('student_missed','teacher_missed')),
    teacher_non_delivery_confirmed boolean NOT NULL DEFAULT false, teacher_failed_replacement boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','offered','accepted','delivered_review','review_required','resolved','withdrawn')),
    policy_version text NOT NULL CHECK(length(policy_version)>0), policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
    requested_before_start boolean NOT NULL DEFAULT false, original_claim_closes_at timestamptz NOT NULL,
    replacement_deadline_at timestamptz NOT NULL, replacement_review_closes_at timestamptz,
    outcome text CHECK(outcome IN ('replacement_delivered','student_missed_replacement','teacher_missed_replacement','refund_review','no_adjustment')),
    resolved_by integer REFERENCES users(id) ON DELETE RESTRICT, resolved_at timestamptz,
    requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lesson_remedy_cases_original_idx ON lesson_remedy_cases(original_booking_id,original_position)`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_cases_student_idx ON lesson_remedy_cases(student_id,status,id)`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_cases_teacher_idx ON lesson_remedy_cases(teacher_id,status,id)`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_cases_session_idx ON lesson_remedy_cases(original_session_id,id)`,
  `CREATE TABLE IF NOT EXISTS lesson_remedy_offers (
    id serial PRIMARY KEY, case_id integer NOT NULL REFERENCES lesson_remedy_cases(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK(version>0), offered_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','declined','expired','withdrawn')),
    replacement_session_id integer REFERENCES sessions(id) ON DELETE RESTRICT, accepted_at timestamptz, declined_at timestamptz, withdrawn_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lesson_remedy_offers_time_check CHECK(ends_at>starts_at AND expires_at>created_at),
    CONSTRAINT lesson_remedy_offers_acceptance_check CHECK(status<>'accepted' OR
      (accepted_at IS NOT NULL AND replacement_session_id IS NOT NULL AND accepted_at<expires_at AND accepted_at<starts_at))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lesson_remedy_offers_version_idx ON lesson_remedy_offers(case_id,version)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lesson_remedy_offers_pending_idx ON lesson_remedy_offers(case_id) WHERE status='proposed'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lesson_remedy_offers_accepted_idx ON lesson_remedy_offers(case_id) WHERE accepted_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_offers_session_idx ON lesson_remedy_offers(replacement_session_id,id)`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_offers_expiry_idx ON lesson_remedy_offers(status,expires_at)`,
  `CREATE TABLE IF NOT EXISTS lesson_remedy_events (
    id serial PRIMARY KEY, case_id integer NOT NULL REFERENCES lesson_remedy_cases(id) ON DELETE RESTRICT,
    offer_id integer REFERENCES lesson_remedy_offers(id) ON DELETE RESTRICT, actor_id integer REFERENCES users(id) ON DELETE RESTRICT,
    actor_role text NOT NULL, event text NOT NULL, from_status text, to_status text NOT NULL, request_key text,
    detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object'), created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_events_case_idx ON lesson_remedy_events(case_id,id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lesson_remedy_events_request_idx ON lesson_remedy_events(case_id,request_key)`,
] as const;

export function lessonRemediesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LESSON_REMEDIES_ENABLED === "1";
}

let ready: Promise<void> | undefined;
/** Durable obligations continue to apply when new user writes are paused. Missing storage is not empty history. */
export async function lessonRemedySchemaReady(source: Pick<typeof db, "execute"> = db): Promise<boolean> {
  const result = await source.execute(sql`SELECT to_regclass('lesson_remedy_cases') AS cases,
    to_regclass('lesson_remedy_offers') AS offers,to_regclass('lesson_remedy_events') AS events,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('tableName',t.relname,'name',a.attname))
      FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid WHERE a.attnum>0 AND NOT a.attisdropped AND
        a.attrelid IN (to_regclass('lesson_remedy_cases'),to_regclass('lesson_remedy_offers'),to_regclass('lesson_remedy_events'))),'[]'::jsonb) AS columns,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',i.relname,'tableName',t.relname,
      'isUnique',x.indisunique,'isValid',x.indisvalid,'isReady',x.indisready,'isImmediate',x.indimmediate,
      'columns',ARRAY(SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY k(attnum,position)
        JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.attnum WHERE k.position<=x.indnkeyatts ORDER BY k.position),
      'predicate',pg_get_expr(x.indpred,x.indrelid)))
      FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid WHERE
        x.indrelid IN (to_regclass('lesson_remedy_cases'),to_regclass('lesson_remedy_offers'),to_regclass('lesson_remedy_events'))),'[]'::jsonb) AS indexes`);
  return assertLessonRemedyStorage(result.rows[0] as unknown as RemedyStorageCatalog | undefined);
}
/** Called only when explicitly activated. Any missing/wrong schema refuses remedies, not sign-in. */
export function ensureLessonRemedySchema(): Promise<void> {
  return ready ??= (async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(838209, 1)`);
      for (const statement of LESSON_REMEDY_DDL) await tx.execute(sql.raw(statement));
      // IF NOT EXISTS must not hide an older incompatible dormant schema.
      await tx.execute(sql`SELECT teacher_non_delivery_confirmed,teacher_failed_replacement,policy_snapshot,
        replacement_review_closes_at FROM lesson_remedy_cases LIMIT 0`);
      await tx.execute(sql`SELECT accepted_at,replacement_session_id FROM lesson_remedy_offers LIMIT 0`);
      if (!await lessonRemedySchemaReady(tx)) throw Error("Make-up storage was not installed.");
    });
  })().catch((error) => { ready = undefined; throw error; });
}
