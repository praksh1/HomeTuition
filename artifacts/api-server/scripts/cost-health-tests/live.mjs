/** Owner-authorized release smoke check. No token or provider secret is printed.
 * Run under the exact production Railway service. --send-test-email sends one labelled test.
 * Reads only the configured owner and cost dashboard; never edits customer data or budgets.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';

const service = 'be00bc18-98c7-4007-9ee4-9df080cdec8a';
const origin = 'https://workspaceapi-server-production-5a63.up.railway.app';
assert.equal(process.env.RAILWAY_SERVICE_ID, service, 'Exact production service required');
assert.ok(process.env.SESSION_SECRET && process.env.DATABASE_URL, 'Server credentials required');
const ownerId = Number(process.env.COST_HEALTH_OWNER_USER_ID);
assert.ok(Number.isSafeInteger(ownerId) && ownerId > 0, 'Exact owner must be configured');
const requireDb = createRequire(new URL('../../../../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
try {
  const { rows } = await pool.query('SELECT id,email,role,suspended_at FROM users WHERE id=$1', [ownerId]);
  const owner = rows[0];
  assert.equal(owner?.role, 'admin');
  assert.equal(owner?.suspended_at, null);
  assert.equal(owner?.email?.toLowerCase(), process.env.COST_HEALTH_ALERT_EMAIL?.toLowerCase());
  const token = jwt.sign({ userId: ownerId, email: owner.email, role: 'admin' }, process.env.SESSION_SECRET, { expiresIn: '5m' });
  const anonymous = await fetch(`${origin}/api/owner/cost-health`, { signal: AbortSignal.timeout(10000) });
  assert.equal(anonymous.status, 401);
  console.log('PASS unauthenticated access denied');
  async function request(path, method='GET') {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method==='POST'?{body:'{}'}:{}), signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, `${path} HTTP ${response.status}`);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    return response.json();
  }
  assert.equal((await request('/owner/access')).allowed, true);
  console.log('PASS configured owner admitted with private no-store responses');
  const dashboard = await request('/owner/cost-health/refresh', 'POST');
  assert.equal(dashboard.settings.monthlyBudgetUsd, null);
  for (const provider of ['railway','neon','cloudflare','brevo']) assert.equal(dashboard.settings.providerBudgetsUsd[provider], 15);
  assert.equal(dashboard.settings.providerBudgetsUsd.livekit, undefined);
  assert.equal(dashboard.monitoring.enabled, true);
  assert.equal(dashboard.monitoring.emailConfigured, true);
  assert.ok(dashboard.snapshot?.checkedAt);
  console.log('PASS approved per-provider budgets, scheduler and alert recipient configured');
  console.log(JSON.stringify({ checkedAt: dashboard.snapshot.checkedAt, providers: dashboard.snapshot.providers.map(p=>({id:p.id,status:p.status,meters:p.meters})), health:dashboard.snapshot.health.map(h=>({name:h.name,status:h.status})), warnings:dashboard.warnings.map(w=>w.title) }));
  if (process.argv.includes('--send-test-email')) {
    assert.equal((await request('/owner/cost-health/test-email', 'POST')).accepted, true);
    console.log('PASS labelled test email accepted by mail provider (inbox delivery unverified)');
  }
} catch (error) {
  console.error('Cost-health live verification failed:', error instanceof assert.AssertionError ? error.message : 'request or database failed; inspect privately');
  process.exitCode=1;
} finally { await pool.end(); }
