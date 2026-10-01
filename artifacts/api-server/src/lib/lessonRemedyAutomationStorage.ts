/** Additive, explicit-install SHADOW storage. No existing table/column changes or boot-time migration. */
export const LESSON_REMEDY_AUTOMATION_DDL = [
  `CREATE TABLE IF NOT EXISTS lesson_remedy_automation_purchase_terms (
    booking_id integer PRIMARY KEY REFERENCES batch_test_bookings(id) ON DELETE RESTRICT,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    policy_version text NOT NULL CHECK(policy_version='2026-09-30-v2'),
    policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
    accepted_at timestamptz NOT NULL, terms_digest text NOT NULL CHECK(terms_digest~'^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS lesson_remedy_automation_warning_consents (
    offer_id integer PRIMARY KEY REFERENCES lesson_remedy_offers(id) ON DELETE RESTRICT,
    booking_id integer NOT NULL REFERENCES batch_test_bookings(id) ON DELETE RESTRICT,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    original_position integer NOT NULL CHECK(original_position>=0),
    consent jsonb NOT NULL CHECK(jsonb_typeof(consent)='object'),
    accepted_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS lesson_remedy_automation_evidence (
    session_id integer NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attestation jsonb NOT NULL CHECK(jsonb_typeof(attestation)='object'),
    finalized_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id,student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lesson_remedy_automation_shadow_actions (
    action_key text PRIMARY KEY,
    booking_id integer NOT NULL REFERENCES batch_test_bookings(id) ON DELETE RESTRICT,
    original_position integer NOT NULL CHECK(original_position>=0),
    original_session_id integer NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    policy_version text NOT NULL CHECK(policy_version='2026-09-30-v2'),
    decision jsonb NOT NULL CHECK(jsonb_typeof(decision)='object'),
    evidence_references jsonb NOT NULL CHECK(jsonb_typeof(evidence_references)='object'),
    payment_moved boolean NOT NULL DEFAULT false CHECK(payment_moved=false),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS lesson_remedy_automation_actions_original_idx
    ON lesson_remedy_automation_shadow_actions(booking_id,original_position,created_at)`,
] as const;

/** Used by the guarded dry-run harness, never by app startup or user reads. */
export const AUTOMATION_STORAGE_TABLES = ["lesson_remedy_automation_purchase_terms", "lesson_remedy_automation_warning_consents",
  "lesson_remedy_automation_evidence", "lesson_remedy_automation_shadow_actions"] as const;
