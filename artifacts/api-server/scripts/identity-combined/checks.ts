import assert from "node:assert/strict";
import express from "express";
import { pool } from "../identity-db/database";
import router from "../../src/routes/identityVerification";
import { signToken } from "../../src/lib/auth";
import { ensureIdentitySchema } from "../../src/lib/identitySchema";
import { identityStorageReady } from "../../src/lib/identityFiles";
import { identityRetentionHealth } from "../../src/lib/identityRetentionScheduler";

// Actual HTTP router, PostgreSQL, encryption and private R2 adapter. Every identity is synthetic.
await pool.query(`CREATE TABLE users(id integer PRIMARY KEY,role text,name text,suspended_at timestamptz);
  INSERT INTO users(id,role,name) VALUES(101,'student','Synthetic student'),
    (102,'student','Other synthetic student'),(201,'admin','Synthetic reviewer'),
    (202,'admin','Unlisted synthetic operator');
  CREATE TABLE account_security(user_id integer PRIMARY KEY,email_verified_at timestamptz);
  INSERT INTO account_security VALUES(101,now()),(102,now());
  CREATE TABLE operator_accounts(id serial PRIMARY KEY,user_id integer,login_id text,
    is_administrator boolean DEFAULT false,must_change_password boolean DEFAULT false,
    disabled_at timestamptz,last_sign_in_at timestamptz,created_at timestamptz DEFAULT now());
  INSERT INTO operator_accounts(user_id,login_id) VALUES(201,'synthetic-reviewer'),
    (202,'synthetic-unlisted-operator');
  CREATE TABLE user_notification_events(id serial PRIMARY KEY,user_id integer,event jsonb,
    created_at timestamptz DEFAULT now());`);
await ensureIdentitySchema();
await pool.query("INSERT INTO identity_retention_job(name,last_cycle_at) VALUES('private_identity_v1',now())");
assert.equal(identityStorageReady(), true, "Private storage configuration is unavailable");
assert.equal((await identityRetentionHealth()).healthy, true, "Synthetic cleanup health is unavailable");
process.env.IDENTITY_REVIEWER_USER_IDS = "201";
const tokens = new Map([
  [101, signToken({ userId: 101, email: "synthetic-101@example.invalid", role: "student" })],
  [102, signToken({ userId: 102, email: "synthetic-102@example.invalid", role: "student" })],
  [201, signToken({ userId: 201, email: "synthetic-201@example.invalid", role: "admin" })],
  [202, signToken({ userId: 202, email: "synthetic-202@example.invalid", role: "admin" })],
]);
const app = express();
app.use(express.json());
app.use("/api", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("Local test listener unavailable");
const base = `http://127.0.0.1:${address.port}/api`;
async function call(path: string, userId: number, body?: object | Buffer, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${tokens.get(userId)}`,
      "Content-Type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json",
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    body: response.headers.get("content-type")?.includes("json") ? JSON.parse(bytes.toString()) : null,
    bytes,
  };
}
const details = {
  holder: "self", documentType: "citizenship", legalName: "Synthetic Test Person",
  documentNumber: "TEST-NOT-A-REAL-ID", dateOfBirth: "1990-01-01",
  issuingDistrict: "Test district", issuingMunicipality: "Test municipality", consent: true,
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=", "base64");
try {
  const prepared = await call("/identity-verification/prepare", 101, details);
  assert.equal(prepared.status, 200, "Private preparation failed after local readiness checks");
  const id = prepared.body.id;
  assert.ok(Number.isSafeInteger(id));
  console.log("PASS synthetic user prepared a private encrypted submission");
  assert.equal((await call(`/identity-verification/${id}/document`, 102, png, "PUT")).status, 404);
  console.log("PASS second user cannot upload into the submission");
  const uploaded = await call(`/identity-verification/${id}/document`, 101, png, "PUT");
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.verification.status, "submitted");
  assert.equal((await call(`/identity-verification/${id}/document`, 101, png, "PUT")).status, 200);
  console.log("PASS actual HTTP upload stored encrypted bytes in private R2; retry is idempotent");
  const mine = await call("/identity-verification/me", 101);
  assert.equal(mine.status, 200);
  assert.equal(mine.cacheControl, "no-store");
  assert.equal(mine.body.verification.status, "submitted");
  for (const sensitive of [details.legalName, details.documentNumber])
    assert.ok(!JSON.stringify(mine.body).includes(sensitive));
  assert.equal((await call("/identity-verification/me", 102)).body.verification, null);
  console.log("PASS public account status excludes legal identity fields");
  assert.equal((await call(`/identity-review/${id}/open`, 102, {})).status, 403);
  assert.equal((await call("/identity-review/access", 202)).body.allowed, false);
  assert.equal((await call(`/identity-review/${id}/open`, 202, {})).status, 403);
  assert.equal((await call(`/identity-review/${id}/document`, 202, {})).status, 403);
  await pool.query("UPDATE operator_accounts SET must_change_password=true WHERE user_id=201");
  assert.equal((await call(`/identity-review/${id}/open`, 201, {})).status, 403);
  await pool.query("UPDATE operator_accounts SET must_change_password=false WHERE user_id=201");
  console.log("PASS unlisted and password-change-required operators cannot read private identity data");
  assert.equal((await call(`/identity-review/${id}/decision`, 201, { decision: "approved" })).status, 409);
  const opened = await call(`/identity-review/${id}/open`, 201, {});
  assert.equal(opened.status, 200);
  assert.equal(opened.body.details.legalName, details.legalName);
  await pool.query(`CREATE FUNCTION reject_document_opened() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action = 'document_opened' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER reject_document_opened BEFORE INSERT ON identity_access_events
      FOR EACH ROW EXECUTE FUNCTION reject_document_opened();`);
  const failedAudit = await call(`/identity-review/${id}/document`, 201, {});
  assert.equal(failedAudit.status, 503);
  assert.notDeepEqual(failedAudit.bytes, png, "Audit failure must not deliver private document bytes");
  await pool.query("DROP TRIGGER reject_document_opened ON identity_access_events; DROP FUNCTION reject_document_opened()");
  console.log("PASS private R2 document is not delivered when the audit write fails");
  const document = await call(`/identity-review/${id}/document`, 201, {});
  assert.equal(document.status, 200);
  assert.equal(document.contentType, "image/png");
  assert.deepEqual(document.bytes, png);
  assert.equal(document.cacheControl, "no-store");
  console.log("PASS authorized reviewer read actual private R2 image after audited access");
  const decided = await call(`/identity-review/${id}/decision`, 201, { decision: "approved" });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.verification.status, "approved");
  assert.equal((await call(`/identity-review/${id}/decision`, 201, { decision: "approved" })).status, 409);
  const notices = await pool.query("SELECT event FROM user_notification_events WHERE user_id=101");
  assert.equal(notices.rowCount, 1);
  assert.deepEqual(Object.keys(notices.rows[0].event).sort(), ["at", "kind"]);
  console.log("PASS reviewer decision creates one generic notification without legal identity data");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
}
