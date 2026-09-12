/** Additive pilot storage and narrow protection of promises that already have test bookings. */
export const BATCH_TEST_DDL = [
  `CREATE TABLE IF NOT EXISTS batch_test_contracts (
    batch_id integer PRIMARY KEY REFERENCES learning_program_batches(id) ON DELETE RESTRICT,
    snapshot jsonb NOT NULL, teacher_grant_id integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS batch_test_sessions (
    id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES batch_test_contracts(batch_id) ON DELETE RESTRICT,
    position integer NOT NULL, session_id integer NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS batch_test_sessions_lesson_idx ON batch_test_sessions(batch_id, position)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS batch_test_sessions_session_idx ON batch_test_sessions(session_id)`,
  `CREATE TABLE IF NOT EXISTS batch_test_bookings (
    id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES batch_test_contracts(batch_id) ON DELETE RESTRICT,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    student_grant_id integer NOT NULL, quote jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS batch_test_bookings_student_idx ON batch_test_bookings(batch_id, student_id)`,
  `CREATE TABLE IF NOT EXISTS batch_test_payments (
    booking_id integer PRIMARY KEY REFERENCES batch_test_bookings(id) ON DELETE RESTRICT,
    receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS batch_test_ledger_entries (
    id serial PRIMARY KEY,
    booking_id integer NOT NULL REFERENCES batch_test_bookings(id) ON DELETE RESTRICT,
    position integer NOT NULL,
    actor_id integer REFERENCES users(id) ON DELETE SET NULL,
    event text NOT NULL, from_state text NOT NULL, to_state text NOT NULL,
    gross_npr integer NOT NULL, teacher_npr integer NOT NULL, fadko_npr integer NOT NULL,
    detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS batch_test_ledger_booking_idx ON batch_test_ledger_entries(booking_id, id)`,
  `CREATE OR REPLACE FUNCTION protect_batch_test_ledger_entry() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'SIMULATED_LEDGER_IMMUTABLE' USING ERRCODE='P0001'; END $$`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='batch_test_ledger_immutable' AND tgrelid='batch_test_ledger_entries'::regclass) THEN
    CREATE TRIGGER batch_test_ledger_immutable BEFORE UPDATE OR DELETE ON batch_test_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION protect_batch_test_ledger_entry(); END IF; END $$`,
  `CREATE OR REPLACE FUNCTION protect_batch_test_payment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'SIMULATED_RECEIPT_IMMUTABLE' USING ERRCODE='P0001'; END $$`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='batch_test_payment_immutable' AND tgrelid='batch_test_payments'::regclass) THEN
    CREATE TRIGGER batch_test_payment_immutable BEFORE UPDATE OR DELETE ON batch_test_payments
    FOR EACH ROW EXECUTE FUNCTION protect_batch_test_payment(); END IF; END $$`,
  // Trigger checks are the backstop for older editors and concurrent lifecycle routes. No
  // existing row is changed. Without a test contract, these functions return immediately.
  `CREATE OR REPLACE FUNCTION protect_batch_test_promise() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE protected boolean := false;
   BEGIN
    IF TG_TABLE_NAME = 'learning_program_batches' THEN
      SELECT EXISTS(SELECT 1 FROM batch_test_contracts WHERE batch_id=OLD.id) INTO protected;
    ELSIF TG_TABLE_NAME = 'learning_program_batch_lessons' THEN
      SELECT EXISTS(SELECT 1 FROM batch_test_contracts WHERE batch_id=OLD.batch_id) INTO protected;
    ELSIF TG_TABLE_NAME = 'learning_programs' THEN
      SELECT EXISTS(SELECT 1 FROM batch_test_contracts c JOIN learning_program_batches b ON b.id=c.batch_id WHERE b.program_id=OLD.id) INTO protected;
    ELSIF TG_TABLE_NAME = 'sessions' THEN
      SELECT EXISTS(SELECT 1 FROM batch_test_sessions WHERE session_id=OLD.id) INTO protected;
      IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','started_at','enrolled_count','updated_at']) =
        (to_jsonb(OLD)-ARRAY['status','started_at','enrolled_count','updated_at']) THEN RETURN NEW; END IF;
    END IF;
    IF protected THEN RAISE EXCEPTION 'BATCH_TEST_LOCKED' USING ERRCODE='P0001'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
   END $$`,
  ...["learning_program_batches", "learning_program_batch_lessons", "learning_programs", "sessions"].map((table) =>
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='${table}_test_promise_guard' AND tgrelid='${table}'::regclass) THEN
     CREATE TRIGGER ${table}_test_promise_guard BEFORE UPDATE OR DELETE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION protect_batch_test_promise(); END IF; END $$`),
  `CREATE OR REPLACE FUNCTION protect_batch_test_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE linked integer;
   BEGIN
    SELECT batch_id INTO linked FROM batch_test_sessions WHERE session_id=NEW.session_id;
    IF linked IS NOT NULL AND (NEW.payment_status IS DISTINCT FROM 'test' OR NEW.payment_method IS DISTINCT FROM 'test_access' OR NEW.payment_reference IS NOT NULL OR
       NOT EXISTS(SELECT 1 FROM batch_test_bookings WHERE batch_id=linked AND student_id=NEW.student_id)) THEN
      RAISE EXCEPTION 'BATCH_TEST_BOOKING_REQUIRED' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
   END $$`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='batch_test_enrollment_guard' AND tgrelid='session_enrollments'::regclass) THEN
    CREATE TRIGGER batch_test_enrollment_guard BEFORE INSERT OR UPDATE ON session_enrollments
    FOR EACH ROW EXECUTE FUNCTION protect_batch_test_enrollment(); END IF; END $$`,
] as const;
