// Read-only deployment diagnostic. No identities, message content or credentials are printed.
import { createRequire } from "node:module";
import { assertLessonRemedyStorage } from "../artifacts/api-server/src/lib/lessonRemedySchemaChecks.ts";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
if (!process.env.DATABASE_URL) throw new Error("Database connection is not configured.");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const { rows: [dependencies] } = await client.query(`SELECT
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['users','sessions','session_enrollments',
      'learning_program_batches','batch_test_bookings','batch_test_payments',
      'batch_test_sessions','batch_test_ledger_entries','disputes']) AS d(name)
      WHERE to_regclass('public.' || d.name) IS NULL) AS dependencies_ready`);
  const { rows: [catalog] } = await client.query(`SELECT
    to_regclass('public.lesson_remedy_cases') AS cases,
    to_regclass('public.lesson_remedy_offers') AS offers,
    to_regclass('public.lesson_remedy_events') AS events,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('tableName',t.relname,'name',a.attname))
      FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid WHERE a.attnum>0 AND NOT a.attisdropped AND
        a.attrelid IN (to_regclass('public.lesson_remedy_cases'),to_regclass('public.lesson_remedy_offers'),to_regclass('public.lesson_remedy_events'))),'[]'::jsonb) AS columns,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',i.relname,'tableName',t.relname,
      'isUnique',x.indisunique,'isValid',x.indisvalid,'isReady',x.indisready,'isImmediate',x.indimmediate,
      'columns',ARRAY(SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY k(attnum,position)
        JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.attnum WHERE k.position<=x.indnkeyatts ORDER BY k.position),
      'predicate',pg_get_expr(x.indpred,x.indrelid)))
      FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid WHERE
        x.indrelid IN (to_regclass('public.lesson_remedy_cases'),to_regclass('public.lesson_remedy_offers'),to_regclass('public.lesson_remedy_events'))),'[]'::jsonb) AS indexes`);
  await client.query("ROLLBACK");
  const storageReady = assertLessonRemedyStorage(catalog);
  if (!dependencies?.dependencies_ready || (!storageReady && !dependencies.can_create))
    throw Error("Make-up schema dependencies or migration privileges are not ready.");
  console.log(JSON.stringify({ check: "lesson-remedies-readiness", ...dependencies,
    storageReady, storage: storageReady ? "complete" : "not_installed",
    service: process.env.RAILWAY_SERVICE_ID ?? "unset",
    makeupsEnabled: process.env.LESSON_REMEDIES_ENABLED === "1",
    identityCollection: process.env.IDENTITY_COLLECTION_ENABLED ?? "unset",
    closureCompletion: process.env.ACCOUNT_CLOSURE_COMPLETION_ENABLED ?? "unset" }));
} catch {
  console.error("Make-up readiness failed; no data was changed. Check schema/access before activation.");
  process.exitCode = 1;
} finally {
  await client.end();
}
