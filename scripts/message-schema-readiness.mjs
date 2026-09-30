// Read-only release check. Never logs connection strings, identities or message content.
import { createRequire } from "node:module";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
if (!process.env.DATABASE_URL) throw new Error("Database connection is not configured.");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const { rows: [row] } = await client.query(`SELECT
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
    to_regclass('public.users') IS NOT NULL AS users_ready,
    to_regclass('public.messages') IS NOT NULL AS messages_ready,
    to_regclass('public.message_reactions') IS NOT NULL AS reactions_ready,
    to_regclass('public.disputes') IS NOT NULL AS reports_parent_ready,
    to_regclass('public.message_delivery_suppressions') IS NOT NULL AS delivery_table_ready,
    to_regclass('public.message_reaction_suppressions') IS NOT NULL AS reaction_table_ready,
    to_regclass('public.user_reports') IS NOT NULL AS reports_table_ready`);
  await client.query("ROLLBACK");
  if (!row.users_ready || !row.messages_ready || !row.reactions_ready || !row.reports_parent_ready)
    throw new Error("Message safety schema dependencies are not ready.");
  if (!row.can_create && !(row.delivery_table_ready && row.reaction_table_ready && row.reports_table_ready))
    throw new Error("Additive message safety tables need a migration before this release.");
  console.log(JSON.stringify({ check: "message-schema-readiness", ...row }));
} catch {
  console.error("Message safety readiness check failed; no data was changed. Inspect access/schema before release.");
  process.exitCode = 1;
} finally {
  await client.end();
}
