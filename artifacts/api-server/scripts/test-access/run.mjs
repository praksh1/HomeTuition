/**
 * Temporary test teaching access, and everything it must still refuse.
 *
 * The owner needs a few real teacher accounts to create classes without a plan payment that cannot
 * be verified. The whole risk of that feature is scope creep: a bypass written for payment quietly
 * becoming a bypass for approval, for the session allowance, or for everybody.
 *
 * So most of this suite is about what a grant does *not* do. The one thing it may do — let an
 * approved, verified teacher create a class without paying — is four checks. The rest is the
 * fence around it.
 *
 * Runs its own server so it can control `ALLOW_TEST_TEACHING_ACCESS`, which is read per request
 * but has to be absent for the "off by default" case and present for the rest.
 *
 * Usage: PGURL=... node scripts/test-access/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

/** Boots a server with a chosen environment and hands back a client bound to its port. */
async function withServer(port, extraEnv, run) {
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-access-secret",
      // chargeForMonthly refuses a simulated *teacher plan* without this, on purpose.
      NODE_ENV: "test",
      ...extraEnv,
    },
    stdio: "ignore",
  });
  const stop = () => { try { server.kill("SIGKILL"); } catch { /* gone */ } };
  const base = `http://127.0.0.1:${port}`;

  let up = false;
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${base}/api/healthz`)).ok) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) { stop(); throw new Error(`server on ${port} never came up`); }

  const api = async (p, { method = "GET", token, body } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/api${p}`, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  };

  try { await run(api); } finally { stop(); }
}

let seq = 0;
async function register(api, role, name) {
  seq += 1;
  const email = `ta_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  const id = Number(sql(`select id from users where email = '${email}'`));
  return { ...res.body, email, id };
}

/** An agent exists only by promotion in the database; the role travels in the token. */
async function makeAgent(api) {
  const agent = await register(api, "student", "Agent");
  sql(`update users set role = 'admin' where id = ${agent.id}`);
  const again = await api("/auth/login", { method: "POST", body: { email: agent.email, password: "password123" } });
  return again.body.token;
}

const verify = (id) => sql(`update account_security set email_verified_at = now() where user_id = ${id}`);
const approve = (id) => sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${id}`);

const DAY = 86_400_000;
const makeClass = (api, token, atMs, topic = "Algebra") =>
  api("/sessions", { method: "POST", token, body: {
    subject: "Maths", topic, date: new Date(atMs).toISOString(),
    duration: 60, maxStudents: 20, price: 500 } });
const soon = () => Date.now() + 100 * DAY;

/* ------------------------------------------------------------------ off by default */

console.log("\nOff unless the server says otherwise\n");
await withServer(8091, { ALLOW_TEST_TEACHING_ACCESS: "" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await register(api, "teacher", "Unswitched Uma");
  verify(teacher.id);
  approve(teacher.id);

  const granted = await api(`/admin/teachers/${teacher.id}/test-access`, {
    method: "POST", token: agentToken, body: { tier: "base", reason: "testing" } });
  check("an operator cannot grant while the switch is off",
    granted.status === 409 && granted.body?.code === "TEST_ACCESS_DISABLED",
    `status ${granted.status} ${JSON.stringify(granted.body)}`);

  // A grant that predates the switch being turned off must also stop working.
  sql(`insert into test_teaching_grants (teacher_id, tier, reason, valid_until)
       values (${teacher.id}, 'base', 'planted', now() + interval '7 days')`);
  const blocked = await makeClass(api, teacher.token, soon());
  check("and an existing grant does nothing while it is off",
    blocked.status === 402, `status ${blocked.status} ${JSON.stringify(blocked.body)}`);
  sql(`delete from test_teaching_grants where teacher_id = ${teacher.id}`);
});

/* --------------------------------------------------------------------- switched on */

await withServer(8092, { ALLOW_TEST_TEACHING_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);

  console.log("\nIt skips payment, and only payment\n");
  {
    const unverified = await register(api, "teacher", "Unverified Ujwal");
    const refusedUnverified = await api(`/admin/teachers/${unverified.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "base", reason: "testing" } });
    check("an unverified teacher cannot be granted test access",
      refusedUnverified.status === 409, `status ${refusedUnverified.status}`);

    const pending = await register(api, "teacher", "Pending Pemba");
    verify(pending.id);
    const refusedPending = await api(`/admin/teachers/${pending.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "base", reason: "testing" } });
    check("nor can one still waiting on operator review",
      refusedPending.status === 409, `status ${refusedPending.status}`);
    check("and neither attempt wrote a grant",
      sql(`select count(*) from test_teaching_grants where teacher_id in (${unverified.id}, ${pending.id})`) === "0");

    /*
      The dangerous case. A grant is planted for a teacher who was later un-approved: the row is
      live, but the human gate has closed. `ordinaryTeachingAccess` checks approval *before* it
      looks for a grant, so the grant must not rescue them.
    */
    sql(`insert into test_teaching_grants (teacher_id, tier, reason, valid_until)
         values (${pending.id}, 'base', 'stale grant', now() + interval '7 days')`);
    const stillBlocked = await makeClass(api, pending.token, soon());
    check("a stale grant cannot rescue an unapproved teacher",
      stillBlocked.status === 403 && stillBlocked.body?.code === "OPERATOR_REVIEW",
      `status ${stillBlocked.status} ${JSON.stringify(stillBlocked.body)}`);
  }

  console.log("\nA granted teacher can teach, within a real allowance\n");
  {
    const teacher = await register(api, "teacher", "Granted Gita");
    verify(teacher.id);
    approve(teacher.id);

    const before = await makeClass(api, teacher.token, soon());
    check("without a grant they are refused for payment",
      before.status === 402 && before.body?.code === "PLAN_REQUIRED", `status ${before.status}`);

    const granted = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "base", reason: "owner acceptance testing" } });
    check("an approved, verified teacher can be granted", granted.status === 201, `status ${granted.status}`);
    check("the grant records who and why",
      granted.body?.grant?.reason === "owner acceptance testing" && granted.body?.grant?.grantedBy != null,
      JSON.stringify(granted.body?.grant));

    const after = await makeClass(api, teacher.token, soon());
    check("and then they can create a class", after.status === 201 || after.status === 200,
      `status ${after.status} ${JSON.stringify(after.body)}`);

    /*
      No purchase may be invented anywhere a purchase is recorded.

      There is no `payments` table — a charge is not persisted as a row of its own. What records
      that a teacher bought something is `teacher_profiles.subscription_active` for a tier and a
      `teacher_plans` row for the monthly plan, so those are the two places a fake receipt could
      appear, and both must stay empty.
    */
    check("the profile is still not marked as subscribed",
      sql(`select subscription_active from teacher_profiles where user_id = ${teacher.id}`) === "f");
    check("and no plan was invented for them",
      sql(`select count(*) from teacher_plans where teacher_id = ${teacher.id}`) === "0");

    // The Base allowance is ten classes in any thirty days. A grant does not lift it.
    const from = soon() + 200 * DAY;
    let made = 0;
    for (let i = 0; i < 10; i += 1) {
      const r = await makeClass(api, teacher.token, from + i * DAY, `Class ${i + 1}`);
      if (r.status === 201 || r.status === 200) made += 1;
    }
    check("the grant's tier allowance still applies", made === 10, `created ${made}`);
    const eleventh = await makeClass(api, teacher.token, from + 10 * DAY, "One too many");
    check("and the eleventh in thirty days is refused",
      eleventh.status === 402, `status ${eleventh.status}`);

    // What the teacher is shown, so the screen cannot present it as a bought plan.
    const allowance = await api("/teachers/me/allowance", { token: teacher.token });
    check("the teacher's own allowance says this is test access",
      allowance.body?.testAccess?.validUntil != null, JSON.stringify(allowance.body));
    check("and carries the reason it was given",
      allowance.body?.testAccess?.reason === "owner acceptance testing");

    console.log("\nRevoking, and expiry\n");
    const revoked = await api(`/admin/teachers/${teacher.id}/test-access/revoke`, {
      method: "POST", token: agentToken, body: {} });
    check("an operator can end it", revoked.status === 200 && revoked.body?.revoked === 1,
      JSON.stringify(revoked.body));
    const afterRevoke = await makeClass(api, teacher.token, soon() + 500 * DAY);
    check("and it stops working on the next protected action",
      afterRevoke.status === 402, `status ${afterRevoke.status}`);
    check("the row is kept for the audit question",
      sql(`select count(*) from test_teaching_grants where teacher_id = ${teacher.id}`) === "1");

    // Expiry needs nobody to act.
    sql(`update test_teaching_grants set revoked_at = null, valid_until = now() - interval '1 hour'
          where teacher_id = ${teacher.id}`);
    const afterExpiry = await makeClass(api, teacher.token, soon() + 600 * DAY);
    check("an expired grant stops working without anybody revoking it",
      afterExpiry.status === 402, `status ${afterExpiry.status}`);
  }

  console.log("\nWho may grant, and what a grant must say\n");
  {
    const teacher = await register(api, "teacher", "Target Tara");
    verify(teacher.id);
    approve(teacher.id);

    const nosy = await register(api, "student", "Nosy Nabin");
    const asStudent = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: nosy.token, body: { tier: "base", reason: "please" } });
    check("a student cannot grant themselves anything", asStudent.status === 403, `status ${asStudent.status}`);

    const asTeacher = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: teacher.token, body: { tier: "base", reason: "please" } });
    check("nor can the teacher grant it to themselves", asTeacher.status === 403, `status ${asTeacher.status}`);

    const noReason = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "base" } });
    check("a grant without a reason is refused", noReason.status === 400, `status ${noReason.status}`);

    const tooLong = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "base", reason: "forever", days: 400 } });
    check("and one that is not temporary is refused", tooLong.status === 400, `status ${tooLong.status}`);

    const first = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "base", reason: "first" } });
    const second = await api(`/admin/teachers/${teacher.id}/test-access`, {
      method: "POST", token: agentToken, body: { tier: "tier2", reason: "second" } });
    check("granting twice leaves exactly one live grant",
      first.status === 201 && second.status === 201
        && sql(`select count(*) from test_teaching_grants
                 where teacher_id = ${teacher.id} and revoked_at is null`) === "1");

    check("both actions are in the activity log",
      Number(sql(`select count(*) from activity_log
                   where action = 'admin.test_teaching.granted' and subject_id = ${teacher.id}`)) >= 2);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
