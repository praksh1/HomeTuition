// Narrow live release smoke: read existing synthetic staging accounts only.
// No booking, request, ticket, payment, document or account is created or modified.
// An enabled first GET may install the reviewed additive make-up tables transactionally.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { Client } = requireDb("pg"); const jwt = requireApi("jsonwebtoken");
const targets = {
  preview: { origin: "https://hometuition-api-staging-production.up.railway.app", service: "cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0" },
  production: { origin: "https://workspaceapi-server-production-5a63.up.railway.app", service: "be00bc18-98c7-4007-9ee4-9df080cdec8a" },
};
const target = targets[process.argv[2]];
assert(target, "Choose the explicit preview or production target.");
assert([undefined, "--check-accounts"].includes(process.argv[3]), "Unknown smoke mode.");
assert.equal(process.env.RAILWAY_SERVICE_ID, target.service, "Railway service does not match the release target.");
assert(process.env.DATABASE_URL && process.env.SESSION_SECRET, "Release credentials are not configured.");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
try {
  await client.connect(); await client.query("BEGIN READ ONLY");
  const { rows } = await client.query(`SELECT DISTINCT ON (role) id,email,role FROM users
    WHERE suspended_at IS NULL AND role IN ('teacher','student')
      AND email ~ '^staging\\.(teacher|student)\\.[0-9]+@example\\.com$'
    ORDER BY role,id`);
  await client.query("ROLLBACK");
  assert.equal(rows.length, 2, "Both existing synthetic staging roles are needed for this smoke.");
  if (process.argv[3] === "--check-accounts") {
    console.log(JSON.stringify({ check: "synthetic-smoke-prerequisites", target: process.argv[2], rolesReady: rows.length }));
  } else {
  for (const user of rows) {
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.SESSION_SECRET, { expiresIn: "2m" });
    const response = await fetch(`${target.origin}/api/lesson-remedies`, {
      headers: { Authorization: `Bearer ${token}`, "X-Fadko-Platform": "web" }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, `${user.role} make-up history unavailable`);
    const body = await response.json();
    assert.equal(body.enabled, true, "New requests should be enabled only after the release gates pass.");
    assert(Array.isArray(body.lessons) && Array.isArray(body.quotas), "Invalid make-up response shape.");
    console.log(JSON.stringify({ check: "live-makeups", target: process.argv[2], role: user.role,
      enabled: body.enabled, visibleLessonCount: body.lessons.length, visiblePurchaseCount: body.quotas.length }));
    const denied = await fetch(`${target.origin}/api/admin/lesson-remedies`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(denied.status, 403, "Participant must not read the operator make-up desk.");
    await denied.body?.cancel();
  }
  const anonymous = await fetch(`${target.origin}/api/lesson-remedies`, { signal: AbortSignal.timeout(15000) });
  assert.equal(anonymous.status, 401, "Anonymous make-up history must remain private.");
  await anonymous.body?.cancel();
  console.log("PASS participant/operator separation and anonymous make-up privacy");
  }
} catch {
  console.error("Live make-up smoke failed. No user booking or payment action was attempted; inspect release/auth/schema.");
  process.exitCode = 1;
} finally { await client.end(); }
