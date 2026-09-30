// Narrow live release smoke: existing staging fixtures, or proven repository demo seeds in Production.
// No booking, request, ticket, payment, document or account is created or modified.
// An enabled first GET may install the reviewed additive make-up tables transactionally.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
let stage = "database_connect";
let fixture = "staging";
const counts = { strictRoles: 0, seedCandidates: { teacher: 0, student: 0 }, seedVerified: { teacher: 0, student: 0 } };
try {
  await client.connect(); stage = "read_only_transaction"; await client.query("BEGIN READ ONLY");
  stage = "staging_fixture_selection";
  let { rows } = await client.query(`SELECT DISTINCT ON (role) id,email,role FROM users
    WHERE suspended_at IS NULL AND role IN ('teacher','student')
      AND email ~ '^staging\\.(teacher|student)\\.[0-9]+@example\\.com$'
    ORDER BY role,id`);
  counts.strictRoles = rows.length;
  if (process.argv[2] === "production" && rows.length !== 2) {
    fixture = "repository_seed"; stage = "repository_seed_selection";
    // These exact role/email patterns come from scripts/src/seed.ts, not arbitrary live accounts.
    // Bound the proof work; a changed-password or malformed-hash account is never selected.
    const candidates = (await client.query(`SELECT id,email,role,password_hash FROM (
      SELECT id,email,role,password_hash,ROW_NUMBER() OVER (PARTITION BY role ORDER BY id) AS ordinal
      FROM users WHERE suspended_at IS NULL
        AND ((role='teacher' AND email ~ '^teacher[0-9]+@sikshya\\.np$')
          OR (role='student' AND email ~ '^student[0-9]+@sikshya\\.np$'))
    ) known_seeds WHERE ordinal <= 20 ORDER BY role,id`)).rows;
    // Read the public demo fixture literal only; NEVER import/run the destructive seed script.
    const source = readFileSync(new URL("./src/seed.ts", import.meta.url), "utf8");
    const demoPassword = /const passwordHash = await hashPassword\("([^"]+)"\);/.exec(source)?.[1];
    assert(demoPassword, "Repository demo credential definition is unavailable.");
    const { verifyPassword } = await import("../artifacts/api-server/src/lib/auth.ts");
    stage = "repository_seed_credential_proof";
    rows = [];
    for (const candidate of candidates) {
      counts.seedCandidates[candidate.role]++;
      if (rows.some((row) => row.role === candidate.role)) continue;
      if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(candidate.password_hash)) continue;
      if (!await verifyPassword(demoPassword, candidate.password_hash)) continue;
      counts.seedVerified[candidate.role]++;
      rows.push({ id: candidate.id, email: candidate.email, role: candidate.role });
    }
  }
  stage = "read_only_rollback";
  await client.query("ROLLBACK");
  stage = "synthetic_roles_required";
  assert.equal(rows.length, 2, "Both existing proven synthetic roles are needed for this smoke.");
  if (process.argv[3] === "--check-accounts") {
    console.log(JSON.stringify({ check: "synthetic-smoke-prerequisites", target: process.argv[2], fixture, rolesReady: rows.length, counts }));
  } else {
  for (const user of rows) {
    stage = `${user.role}_history`;
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.SESSION_SECRET, { expiresIn: "2m" });
    const response = await fetch(`${target.origin}/api/lesson-remedies`, {
      headers: { Authorization: `Bearer ${token}`, "X-Fadko-Platform": "web" }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, `${user.role} make-up history unavailable`);
    const body = await response.json();
    assert.equal(body.enabled, true, "New requests should be enabled only after the release gates pass.");
    assert(Array.isArray(body.lessons) && Array.isArray(body.quotas), "Invalid make-up response shape.");
    console.log(JSON.stringify({ check: "live-makeups", target: process.argv[2], fixture, role: user.role,
      enabled: body.enabled, visibleLessonCount: body.lessons.length, visiblePurchaseCount: body.quotas.length }));
    stage = `${user.role}_operator_separation`;
    const denied = await fetch(`${target.origin}/api/admin/lesson-remedies`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(denied.status, 403, "Participant must not read the operator make-up desk.");
    await denied.body?.cancel();
  }
  stage = "anonymous_privacy";
  const anonymous = await fetch(`${target.origin}/api/lesson-remedies`, { signal: AbortSignal.timeout(15000) });
  assert.equal(anonymous.status, 401, "Anonymous make-up history must remain private.");
  await anonymous.body?.cancel();
  console.log("PASS participant/operator separation and anonymous make-up privacy");
  }
} catch {
  console.error(JSON.stringify({ check: "live-makeups-failed", target: process.argv[2], fixture, stage, counts,
    noBookingOrPaymentAction: true }));
  process.exitCode = 1;
} finally { await client.end(); }
