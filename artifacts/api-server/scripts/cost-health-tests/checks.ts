import assert from "node:assert/strict";
import express from "express";
import costHealthRouter from "../../src/routes/costHealth";
import { signToken } from "../../src/lib/auth";
import { pool } from "./database";
import { claimCheck, ensureCostHealthSchema, releaseCheck } from "../../src/lib/costHealth/store";
import { sendCostWarnings } from "../../src/lib/costHealth/service";
import * as mocks from "./mocks";
import type { CostSnapshot } from "../../src/lib/costHealth/types";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
const app = express();
app.use(express.json());
app.use("/api", costHealthRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("Could not open synthetic HTTP listener");
const origin = `http://127.0.0.1:${address.port}`;
const token = (userId: number, role: string) => signToken({ userId, role, email: `synthetic-${userId}@example.invalid` });
const ownerToken = token(1, "admin");
const otherAdminToken = token(2, "admin");
const teacherToken = token(3, "teacher");
const studentToken = token(4, "student");
const paths = [
  { path: "/owner/access", method: "GET" },
  { path: "/owner/cost-health", method: "GET" },
  { path: "/owner/cost-health/refresh", method: "POST" },
  { path: "/owner/cost-health/settings", method: "PATCH", body: { monthlyBudgetUsd: 20, providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: true } },
  { path: "/owner/cost-health/test-email", method: "POST" },
] as const;
async function api(path: string, options: { method?: string; bearer?: string; body?: unknown } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method: options.method ?? "GET",
    headers: { ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { body = raw; }
  assert.equal(response.headers.get("cache-control"), "private, no-store", `${path} must never be shared-cached`);
  assert.equal(response.headers.get("pragma"), "no-cache", `${path} must opt out of old caches`);
  assert.ok(!raw.includes("do-not-expose-synthetic-secret"), `${path} must not echo a provider secret`);
  assert.ok(!raw.includes("DATABASE_URL"), `${path} must not expose private configuration`);
  return { status: response.status, body };
}
async function count(table: "owner_cost_health_history" | "owner_cost_health_alerts") {
  return Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
}
try {
  assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, process.env.COST_HEALTH_TEST_SCHEMA);
  await pool.query(`INSERT INTO users(id,email,name,role,password_hash) VALUES
    (1,'owner@example.invalid','Synthetic Owner','admin','synthetic'),
    (2,'other-admin@example.invalid','Synthetic Admin','admin','synthetic'),
    (3,'teacher@example.invalid','Synthetic Teacher','teacher','synthetic'),
    (4,'student@example.invalid','Synthetic Student','student','synthetic')`);
  await ensureCostHealthSchema();
  mocks.resetMocks();

  await test("all private HTTP endpoints refuse missing and invalid JWTs", async () => {
    for (const spec of paths) {
      assert.equal((await api(spec.path, { method: spec.method, body: "body" in spec ? spec.body : undefined })).status, 401);
      assert.equal((await api(spec.path, { method: spec.method, bearer: "invalid-jwt", body: "body" in spec ? spec.body : undefined })).status, 401);
    }
    assert.equal(await count("owner_cost_health_history"), 0);
    assert.equal(mocks.sent.length, 0);
  });
  await test("students, teachers and unrelated admins cannot read or mutate cost-health", async () => {
    for (const bearer of [studentToken, teacherToken, otherAdminToken]) {
      for (const spec of paths) {
        const result = await api(spec.path, { method: spec.method, bearer, body: "body" in spec ? spec.body : undefined });
        assert.equal(result.status, bearer === otherAdminToken && spec.path === "/owner/access" ? 200 : 403,
          `${spec.path} must deny every non-owner`);
        if (spec.path === "/owner/access" && bearer === otherAdminToken) assert.deepEqual(result.body, { allowed: false });
      }
    }
    assert.equal(await count("owner_cost_health_history"), 0);
    assert.equal(mocks.sent.length, 0);
  });
  await test("explicitly configured legacy owner opens only their private dashboard", async () => {
    assert.deepEqual(await api("/owner/access", { bearer: ownerToken }), { status: 200, body: { allowed: true } });
    const dashboard = await api("/owner/cost-health", { bearer: ownerToken });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.snapshot, null);
    assert.equal(dashboard.body.summary.knownSpendUsd, null);
    assert.equal(dashboard.body.monitoring.alertRecipient, "synthetic-owner@example.invalid");
  });
  await test("missing owner configuration fails closed even for a valid admin JWT", async () => {
    const configured = process.env.COST_HEALTH_OWNER_USER_ID;
    delete process.env.COST_HEALTH_OWNER_USER_ID;
    try {
      assert.deepEqual((await api("/owner/access", { bearer: ownerToken })).body, { allowed: false });
      assert.equal((await api("/owner/cost-health", { bearer: ownerToken })).status, 403);
      assert.equal((await api("/owner/cost-health/settings", { method: "PATCH", bearer: ownerToken, body: paths[3].body })).status, 403);
    } finally {
      if (configured) process.env.COST_HEALTH_OWNER_USER_ID = configured;
      else delete process.env.COST_HEALTH_OWNER_USER_ID;
    }
  });
  await test("issued operator flags are rechecked rather than trusting a stale owner JWT", async () => {
    await pool.query(`INSERT INTO operator_accounts(user_id,login_id,is_administrator,must_change_password)
      VALUES(1,'synthetic.owner',false,false)`);
    assert.deepEqual((await api("/owner/access", { bearer: ownerToken })).body, { allowed: false });
    assert.equal((await api("/owner/cost-health", { bearer: ownerToken })).status, 403);
    await pool.query("UPDATE operator_accounts SET is_administrator=true,must_change_password=true WHERE user_id=1");
    assert.equal((await api("/owner/cost-health/settings", { method: "PATCH", bearer: ownerToken, body: paths[3].body })).status, 403);
    await pool.query("UPDATE operator_accounts SET must_change_password=false,disabled_at=now() WHERE user_id=1");
    assert.equal((await api("/owner/cost-health/test-email", { method: "POST", bearer: ownerToken })).status, 403);
    await pool.query("UPDATE operator_accounts SET disabled_at=NULL WHERE user_id=1");
    assert.deepEqual((await api("/owner/access", { bearer: ownerToken })).body, { allowed: true });
    await pool.query("UPDATE users SET role='teacher' WHERE id=1");
    assert.equal((await api("/owner/access", { bearer: ownerToken })).status, 403);
    assert.equal((await api("/owner/cost-health/refresh", { method: "POST", bearer: ownerToken })).status, 403);
    await pool.query("UPDATE users SET role='admin',suspended_at=now() WHERE id=1");
    assert.equal((await api("/owner/cost-health", { bearer: ownerToken })).status, 403);
    await pool.query("UPDATE users SET suspended_at=NULL WHERE id=1");
    assert.equal((await api("/owner/cost-health", { bearer: ownerToken })).status, 200);
    assert.equal(mocks.sent.length, 0);
  });
  await test("settings validation refuses malformed budgets and persists valid settings with owner attribution", async () => {
    const invalid = [
      { monthlyBudgetUsd: -1, providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: true },
      { monthlyBudgetUsd: "20", providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: true },
      { monthlyBudgetUsd: 20.001, providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: true },
      { monthlyBudgetUsd: 20, providerBudgetsUsd: { railway: 0 }, emailAlertsEnabled: true },
      { monthlyBudgetUsd: 20, providerBudgetsUsd: { unknown: 10 }, emailAlertsEnabled: true },
      { monthlyBudgetUsd: 20, providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: "yes" },
      { monthlyBudgetUsd: 20, providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: true, secret: "bad" },
    ];
    for (const body of invalid) assert.equal((await api("/owner/cost-health/settings", { method: "PATCH", bearer: ownerToken, body })).status, 400);
    const body = { monthlyBudgetUsd: 20, providerBudgetsUsd: { railway: 15 }, emailAlertsEnabled: true };
    const saved = await api("/owner/cost-health/settings", { method: "PATCH", bearer: ownerToken, body });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.settings, body);
    const record = (await pool.query("SELECT settings,updated_by FROM owner_cost_health WHERE id=1")).rows[0];
    assert.deepEqual(record.settings, body);
    assert.equal(record.updated_by, 1);
  });
  await test("real HTTP refresh writes one snapshot/history and a single warning digest", async () => {
    const response = await api("/owner/cost-health/refresh", { method: "POST", bearer: ownerToken });
    assert.equal(response.status, 200);
    assert.equal(response.body.snapshot.providers[0].cost.amountUsd, 12);
    assert.equal(response.body.summary.knownSpendUsd, 12);
    assert.equal(response.body.summary.complete, true);
    assert.equal(response.body.history.length, 1);
    assert.equal(mocks.providerCalls, 1);
    assert.equal(mocks.healthCalls, 1);
    assert.equal(mocks.sent.length, 1, "all first-check warnings must be one digest");
    assert.equal(mocks.sent[0].to, "synthetic-owner@example.invalid");
    assert.ok(mocks.sent[0].subject.includes("warning"));
    assert.ok((await count("owner_cost_health_alerts")) >= 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM owner_cost_health_history")).rows[0].n, 1);
    const second = await api("/owner/cost-health/refresh", { method: "POST", bearer: ownerToken });
    assert.equal(second.status, 200);
    assert.equal(mocks.providerCalls, 1, "the persisted five-minute floor must stop repeat collection");
    assert.equal(await count("owner_cost_health_history"), 1);
    assert.equal(mocks.sent.length, 1);
  });
  await test("the PostgreSQL refresh lease admits one concurrent worker and enforces five minutes", async () => {
    await pool.query("UPDATE owner_cost_health SET last_attempt_at=NULL,lease_id=NULL,lease_until=NULL WHERE id=1");
    const ids = ["synthetic-a", "synthetic-b"];
    const results = await Promise.all(ids.map(id => claimCheck(id, 5 * 60_000)));
    assert.equal(results.filter(Boolean).length, 1);
    await releaseCheck(ids[results.indexOf(true)]);
    assert.equal(await claimCheck("synthetic-third", 5 * 60_000), false);
    const state = (await pool.query("SELECT lease_id,lease_until,last_attempt_at FROM owner_cost_health WHERE id=1")).rows[0];
    assert.equal(state.lease_id, null);
    assert.equal(state.lease_until, null);
    assert.ok(state.last_attempt_at);
  });
  await test("warning dedup survives repeated calls; failed email retries only after persisted cooldown", async () => {
    const snapshot = (await api("/owner/cost-health", { bearer: ownerToken })).body.snapshot as CostSnapshot;
    await sendCostWarnings(snapshot);
    assert.equal(mocks.sent.length, 1, "accepted warning keys must not send again");
    const degraded: CostSnapshot = { ...snapshot, health: [{ id: "synthetic-offline", name: "Synthetic Offline",
      status: "degraded", checkedAt: new Date().toISOString(), latencyMs: 1, note: "Synthetic failure" }] };
    const key = `health:synthetic-offline:${degraded.health[0].checkedAt.slice(0, 10)}`;
    mocks.setEmailAcceptance(false);
    await sendCostWarnings(degraded);
    assert.equal(mocks.sent.length, 2);
    let row = (await pool.query("SELECT state,attempts,accepted_at FROM owner_cost_health_alerts WHERE key=$1", [key])).rows[0];
    assert.equal(row.state, "failed");
    assert.equal(row.attempts, 1);
    assert.equal(row.accepted_at, null);
    await sendCostWarnings(degraded);
    assert.equal(mocks.sent.length, 2, "failed submission must respect 30-minute retry cooldown");
    await pool.query("UPDATE owner_cost_health_alerts SET attempted_at=now()-interval '31 minutes' WHERE key=$1", [key]);
    mocks.setEmailAcceptance(true);
    await sendCostWarnings(degraded);
    assert.equal(mocks.sent.length, 3);
    row = (await pool.query("SELECT state,attempts,accepted_at FROM owner_cost_health_alerts WHERE key=$1", [key])).rows[0];
    assert.equal(row.state, "accepted");
    assert.equal(row.attempts, 2);
    assert.ok(row.accepted_at);
    await sendCostWarnings(degraded);
    assert.equal(mocks.sent.length, 3, "accepted retry remains durably deduplicated");
  });
  await test("owner-only test email is submitted once per window without touching a real mail service", async () => {
    const first = await api("/owner/cost-health/test-email", { method: "POST", bearer: ownerToken });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { accepted: true });
    assert.equal(mocks.sent.length, 4);
    const second = await api("/owner/cost-health/test-email", { method: "POST", bearer: ownerToken });
    assert.equal(second.status, 429);
    assert.equal(mocks.sent.length, 4);
    assert.equal((await pool.query("SELECT last_email_status FROM owner_cost_health WHERE id=1")).rows[0].last_email_status, "accepted");
  });
  console.log(`${passed} isolated HTTP/PostgreSQL cost-health checks passed; providers and email were simulated.`);
} catch (error) {
  const e = error as { name?: string; code?: string; message?: string; cause?: { code?: string } };
  console.error("FAIL", error instanceof assert.AssertionError ? error.message : { name: e.name, code: e.code, causeCode: e.cause?.code });
  process.exitCode = 1;
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
