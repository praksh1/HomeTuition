// Read-only release check. Never prints credentials, names, login IDs or user IDs.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
const services = { production: "be00bc18-98c7-4007-9ee4-9df080cdec8a", preview: "cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0" };
const target = process.argv[2];
assert(services[target], "Choose production or preview explicitly.");
assert.equal(process.env.RAILWAY_SERVICE_ID, services[target], "Service does not match the requested target.");
assert(process.env.DATABASE_URL, "Database is not configured.");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const ownerId = process.env.COST_HEALTH_OWNER_USER_ID;
  const validOwner = /^[1-9][0-9]*$/.test(ownerId ?? "");
  const { rows: [schema] } = await client.query("SELECT to_regclass('public.operator_accounts') IS NOT NULL AS ready");
  const owner = validOwner ? (await client.query("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='admin' AND suspended_at IS NULL) AS ready", [ownerId])).rows[0] : null;
  const operator = schema.ready && validOwner ? (await client.query("SELECT must_change_password,disabled_at IS NOT NULL AS disabled,is_administrator FROM operator_accounts WHERE user_id=$1", [ownerId])).rows[0] : null;
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ check: "operator-owner-access", target, operatorSchemaReady: schema.ready,
    exactOwnerConfigured: validOwner, ownerAccountReady: owner?.ready ?? false,
    ownerHasOperatorAccount: !!operator, ownerOperatorAdministrator: operator?.is_administrator ?? false,
    ownerOperatorNeedsPasswordChange: operator?.must_change_password ?? false,
    ownerOperatorDisabled: operator?.disabled ?? false,
    legacyOwnerAccessMustRemain: !operator || !!operator.must_change_password || !!operator.disabled }));
} catch {
  console.error(JSON.stringify({ check: "operator-owner-access", target, available: false, noDataChanged: true }));
  process.exitCode = 1;
} finally { await client.end(); }
