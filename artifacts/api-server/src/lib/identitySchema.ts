import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Additive tables only. Never alter auth/user tables or run destructive db:push at startup. */
export const IDENTITY_DDL = [
  `CREATE TABLE IF NOT EXISTS identity_verifications (
    id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    holder text NOT NULL CHECK (holder IN ('self','parent')),
    status text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload','submitted','approved','rejected')),
    policy_version text NOT NULL, details_ciphertext text, encryption_key_version text NOT NULL,
    file_key text, consent_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz, reviewed_by integer REFERENCES users(id) ON DELETE SET NULL, rejection_code text,
    file_deleted_at timestamptz, details_deleted_at timestamptz, account_closed_at timestamptz,
    hold_started_at timestamptz, hold_reviewed_at timestamptz, hold_review_requested_at timestamptz, hold_case_id integer
  )`,
  `CREATE INDEX IF NOT EXISTS identity_verifications_user_idx ON identity_verifications(user_id,id)`,
  `ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS hold_version integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS identity_access_events (
    id serial PRIMARY KEY, verification_id integer NOT NULL REFERENCES identity_verifications(id) ON DELETE RESTRICT,
    actor_id integer REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, purpose text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS identity_access_events_record_idx ON identity_access_events(verification_id,id)`,
  `CREATE TABLE IF NOT EXISTS identity_retention_job (
    name text PRIMARY KEY, cursor_id integer NOT NULL DEFAULT 0,
    lease_owner text, lease_until timestamptz, next_run_at timestamptz NOT NULL DEFAULT now(),
    last_attempt_at timestamptz, last_success_at timestamptz, last_cycle_at timestamptz,
    failure_count integer NOT NULL DEFAULT 0
  )`,
];
let ready: Promise<void> | undefined;
export function ensureIdentitySchema(): Promise<void> {
  if (!ready) ready = (async () => { for (const statement of IDENTITY_DDL) await db.execute(sql.raw(statement)); })().catch(error => { ready = undefined; throw error; });
  return ready;
}
