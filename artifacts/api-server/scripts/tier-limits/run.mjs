/**
 * The teacher's session tier, enforced.
 *
 * Sikshya takes no commission on a pay-per-class booking. What it sells instead is capacity: a
 * teacher buys a tier — NPR 2,000 for ten classes a month up to NPR 4,700 for thirty — and the
 * tier says how much they may teach. Until this work the allowance was stored, displayed and
 * never once compared to anything, so every teacher had every tier for the price of the
 * cheapest.
 *
 * Three things are checked here, and the middle one is the one that would have gone unnoticed:
 *
 *  1. The limit holds, at the exact boundary, and upgrading lifts it.
 *  2. **Days of a monthly recurring class do not count against it.** Those are materialised as
 *     ordinary `sessions` rows on purpose, so that the video room, the board and the chat all
 *     work on them untouched — which means a naive count charges a teacher for classes they
 *     already paid NPR 6,500 for, and locks them out of a plan they are not using.
 *  3. Subscribing no longer approves the teacher. It used to, which let anybody who could
 *     register put themselves in front of students for free, with no agent ever seeing them.
 *
 * Usage: node scripts/tier-limits/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

const API_PORT = Number(process.env.TIER_PORT ?? 8099);
const API = `http://127.0.0.1:${API_PORT}`;
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

const DAY = 86_400_000;

let passed = 0, failed = 0;
const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();
/** `insert ... returning id` prints the id and then psql's own "INSERT 0 1". Keep the id. */
const sqlId = (s) => sql(s).split("\n")[0].trim();

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role, name) {
  seq += 1;
  const email = `tier_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

/** Base is one hundred days out, so nothing collides with "cannot be created in the past". */
const base = () => Date.now() + 100 * DAY;

const makeClass = (token, atMs, topic = "Algebra") =>
  api("/sessions", { method: "POST", token, body: {
    subject: "Maths", topic, date: new Date(atMs).toISOString(),
    duration: 60, maxStudents: 20, price: 500 } });

/** Puts a teacher straight onto a tier, without going through payment. */
const setTier = (userId, tier, sessions) =>
  sql(`update teacher_profiles set subscription_tier = '${tier}', max_sessions_per_month = ${sessions},
       subscription_active = true where user_id = ${userId}`);

/**
 * Open every gate in front of creating a class, not just the operator one.
 *
 * This set `approval_status` alone, which was the whole gate when the suite was written. Account
 * verification landed afterwards and added an email check ahead of it, so every teacher here
 * started failing with "Verify your email before creating a class." — and because this suite is
 * not wired into CI, nothing said so. Ten checks about the tier allowance had quietly stopped
 * testing the tier allowance and were reporting a 403 from a different gate entirely.
 *
 * It sets both directly rather than calling the shared `prepareTeacherForClass` helper because
 * this suite must leave `subscription_active` alone: one of the things it proves is that
 * subscribing does not approve a teacher, and the helper turns that flag on.
 */
const approve = (userId) =>
  sql(`update account_security set email_verified_at = now(), updated_at = now() where user_id = ${userId};
       update teacher_profiles set approval_status = 'approved' where user_id = ${userId}`);

async function main() {
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "tier-limits-test-secret",
      /*
        `chargeForMonthly` refuses a *teacher plan* in simulated mode unless this is set, on
        purpose: a plan grants the right to create and sell classes, so a running development or
        production server must never accept an unverifiable payment for one. Integration suites
        are the sanctioned exception, and this one spawns its own server rather than loading the
        repo `.env`, so it has to say so itself. Without it the tier purchase comes back 402 and
        the failure reads as a broken allowance rather than a payment mode.
      */
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  const stop = () => { try { server.kill("SIGKILL"); } catch { /* gone */ } };
  process.on("exit", stop);

  let up = false;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) { up = true; break; } } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) { stop(); throw new Error("the server never came up"); }

  try {
    console.log("\nThe allowance holds\n");
    {
      const t = await register("teacher", "Base Plan Bimala");
      approve(t.user.id);
      setTier(t.user.id, "base", 10);
      const from = base();

      let created = 0;
      for (let i = 0; i < 10; i += 1) {
        const r = await makeClass(t.token, from + i * DAY, `Class ${i + 1}`);
        if (r.status === 201 || r.status === 200) created += 1;
      }
      check("a base plan takes its full ten classes", created === 10, `created ${created}`);

      const eleventh = await makeClass(t.token, from + 10 * DAY, "One too many");
      check("the eleventh is refused", eleventh.status === 402, `status ${eleventh.status}`);
      check("the refusal names the plan and the allowance",
        /Base/.test(eleventh.body?.error ?? "") && /10 classes/.test(eleventh.body?.error ?? ""),
        JSON.stringify(eleventh.body?.error));
      check("the refusal offers the tier that would take it",
        eleventh.body?.allowance?.upgradeTo === "tier1", JSON.stringify(eleventh.body?.allowance));
      check("the refusal carries a machine-readable date, not a formatted one",
        typeof eleventh.body?.allowance?.freesAt === "string" &&
        !Number.isNaN(Date.parse(eleventh.body.allowance.freesAt)),
        JSON.stringify(eleventh.body?.allowance?.freesAt));

      const far = await makeClass(t.token, from + 45 * DAY, "Next month");
      check("a class clear of the window is still allowed", far.status === 201 || far.status === 200,
        `status ${far.status}`);

      setTier(t.user.id, "tier1", 15);
      const afterUpgrade = await makeClass(t.token, from + 10 * DAY, "Now allowed");
      check("upgrading lets through exactly what was refused",
        afterUpgrade.status === 201 || afterUpgrade.status === 200, `status ${afterUpgrade.status}`);
    }

    console.log("\nWhat does not count against it\n");
    {
      const t = await register("teacher", "Monthly Manisha");
      approve(t.user.id);
      setTier(t.user.id, "base", 10);
      const from = base();

      // Twenty-six days of a monthly recurring class, exactly as the materialiser writes them:
      // an ordinary session row, with a recurring_days row pointing at it.
      const planId = sqlId(`insert into teacher_plans (teacher_id, price, platform_share, status)
        values (${t.user.id}, 6500, 6500, 'active') returning id`);
      const rid = sqlId(`insert into recurring_sessions
        (plan_id, teacher_id, subject, topic, start_minute, duration_minutes, monthly_price, max_students, status)
        values (${planId}, ${t.user.id}, 'Maths', 'Daily maths', 960, 60, 3000, 45, 'active') returning id`);
      for (let i = 0; i < 26; i += 1) {
        const at = new Date(from + i * DAY).toISOString();
        const sid = sqlId(`insert into sessions (teacher_id, teacher_name, subject, topic, date, duration,
          max_students, enrolled_count, price, status)
          values (${t.user.id}, 'Monthly Manisha', 'Maths', 'Daily maths', '${at}', 60, 45, 0, 0, 'upcoming')
          returning id`);
        sql(`insert into recurring_days (recurring_id, session_id, cycle_index, kind, scheduled_for, status)
             values (${rid}, ${sid}, 0, 'regular', '${at}', 'planned')`);
      }

      const after = await makeClass(t.token, from + 5 * DAY, "An ordinary class");
      check("twenty-six days of a monthly class do not use the pay-per-class allowance",
        after.status === 201 || after.status === 200, `status ${after.status} ${JSON.stringify(after.body?.error)}`);

      const summary = await api("/teachers/me/allowance", { token: t.token });
      check("and they are not counted in what the teacher is shown",
        summary.body?.used === 1, `used ${summary.body?.used}`);
    }

    console.log("\nCancelling frees the slot\n");
    {
      const t = await register("teacher", "Cancelling Chandra");
      approve(t.user.id);
      setTier(t.user.id, "base", 10);
      const from = base();

      const ids = [];
      for (let i = 0; i < 10; i += 1) {
        const r = await makeClass(t.token, from + i * DAY, `Class ${i + 1}`);
        ids.push(r.body?.id);
      }
      const blocked = await makeClass(t.token, from + 10 * DAY, "Blocked");
      check("full at ten", blocked.status === 402, `status ${blocked.status}`);

      sql(`update sessions set status = 'cancelled' where id = ${ids[0]}`);
      const allowed = await makeClass(t.token, from + 10 * DAY, "Now there is room");
      check("a cancelled class does not hold a slot against the teacher",
        allowed.status === 201 || allowed.status === 200, `status ${allowed.status}`);
    }

    /*
      This block used to prove a narrower thing: that *buying a tier* no longer set
      `approval_status` to approved, which was the hole that let anyone who could register put
      themselves in front of students.

      Account verification has since closed it from the other side as well. `mayBuyTeacherPlan()`
      now refuses the purchase outright unless the teacher has verified their email *and* been
      approved by an operator, so the old assertion — "subscribing succeeds while pending" — is
      asserting behaviour the product deliberately removed. The checks below follow the stronger
      contract: a teacher cannot reach the tier at all until both human gates are open, and
      passing them is what puts them in Discover.
    */
    console.log("\nA tier cannot be bought before the human gates open\n");
    {
      const t = await register("teacher", "Unapproved Umesh");
      const before = sql(`select approval_status from teacher_profiles where user_id = ${t.user.id}`);
      check("a new teacher starts pending", before === "pending", before);

      const profileId = sql(`select id from teacher_profiles where user_id = ${t.user.id}`);
      const buy = () => api(`/teachers/${profileId}/subscribe`, {
        method: "POST", token: t.token, body: { tier: "tier2" } });

      const unverified = await buy();
      check("an unverified teacher cannot buy a tier",
        unverified.status === 403 && unverified.body?.code === "EMAIL_UNVERIFIED",
        `status ${unverified.status} ${JSON.stringify(unverified.body)}`);

      sql(`update account_security set email_verified_at = now(), updated_at = now() where user_id = ${t.user.id}`);
      const stillPending = await buy();
      check("nor can a verified teacher who is still waiting on an operator",
        stillPending.status === 403 && stillPending.body?.code === "OPERATOR_REVIEW",
        `status ${stillPending.status} ${JSON.stringify(stillPending.body)}`);
      check("and the refusal names the account decision, not the documents",
        /teacher account/i.test(stillPending.body?.error ?? ""), stillPending.body?.error);

      check("neither refusal bought anything",
        sql(`select subscription_tier from teacher_profiles where user_id = ${t.user.id}`) !== "tier2");
      check("and neither moved the allowance",
        Number(sql(`select max_sessions_per_month from teacher_profiles where user_id = ${t.user.id}`)) !== 20);
      check("nor quietly approved the teacher — the original hole, still shut",
        sql(`select approval_status from teacher_profiles where user_id = ${t.user.id}`) === "pending");

      const discover = await api("/teachers?limit=100");
      const listed = (discover.body?.teachers ?? []).some((x) => x.userId === t.user.id || x.id === Number(profileId));
      check("an unapproved teacher is not in Discover", !listed);

      // The only door: an agent's decision. Promote in the database and sign in again — the
      // role travels in the token, so the one issued at registration still says "student".
      const agent = await register("student", "Agent Aayush");
      sql(`update users set role = 'admin' where id = ${agent.user.id}`);
      const signedIn = await api("/auth/login", {
        method: "POST", body: { email: agent.email, password: "password123" } });

      /*
        An account cannot be approved over unreviewed paperwork, so a bare approval is refused
        with 409 until every submitted document has a decision. The document is inserted directly
        rather than uploaded because this suite has no file store; what is under test here is the
        tier gate, not the upload path, which `admin-tests` covers end to end.
      */
      const premature = await api(`/admin/teachers/${t.user.id}/decision`, {
        method: "POST", token: signedIn.body?.token, body: { decision: "approved" } });
      check("an account cannot be approved over unreviewed documents", premature.status === 409,
        `status ${premature.status} ${JSON.stringify(premature.body)}`);

      sql(`insert into teacher_credentials
             (teacher_id, document_type, file_key, original_name, content_type, status, reviewed_at)
           values (${t.user.id}, 'citizenship', 'test-key', 'citizenship.jpg', 'image/jpeg', 'approved', now())`);

      const decided = await api(`/admin/teachers/${t.user.id}/decision`, {
        method: "POST", token: signedIn.body?.token, body: { decision: "approved" } });
      check("an agent can approve once the documents are reviewed", decided.status === 200,
        `status ${decided.status} ${JSON.stringify(decided.body)}`);
      check("and that is what puts them in Discover",
        sql(`select approval_status from teacher_profiles where user_id = ${t.user.id}`) === "approved");

      const nowAllowed = await buy();
      check("only then can the tier actually be bought", nowAllowed.status === 200,
        `status ${nowAllowed.status} ${JSON.stringify(nowAllowed.body)}`);
      check("and the allowance moves with it",
        Number(sql(`select max_sessions_per_month from teacher_profiles where user_id = ${t.user.id}`)) === 20);
    }

    console.log("\nThe allowance a teacher is shown\n");
    {
      const t = await register("teacher", "Reporting Rita");
      approve(t.user.id);
      setTier(t.user.id, "tier3", 25);
      const from = base();
      for (let i = 0; i < 3; i += 1) await makeClass(t.token, from + i * DAY, `Class ${i + 1}`);

      const mine = await api("/teachers/me/allowance", { token: t.token });
      check("reports the real tier", mine.body?.tier === "tier3", JSON.stringify(mine.body));
      check("reports the real limit", mine.body?.limit === 25, JSON.stringify(mine.body));
      check("reports classes actually created, not the dead counter",
        mine.body?.used === 3, JSON.stringify(mine.body));
      check("and what is left", mine.body?.remaining === 22, JSON.stringify(mine.body));

      const student = await register("student", "Nosy Nabin");
      const refused = await api("/teachers/me/allowance", { token: student.token });
      check("a student cannot read a teacher's allowance", refused.status === 403, `status ${refused.status}`);
      const anon = await api("/teachers/me/allowance");
      check("nor can somebody signed out", anon.status === 401, `status ${anon.status}`);
    }

    console.log("\nStale counter\n");
    {
      // The column the dashboard used to read. Nothing writes it, and nothing should now read it.
      const zeroes = sql(`select count(*) from teacher_profiles where sessions_this_month <> 0`);
      check("sessions_this_month is still untouched, and no longer relied on", zeroes === "0", zeroes);
    }
  } finally {
    stop();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
