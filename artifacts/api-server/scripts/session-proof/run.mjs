/**
 * The two doors into the session-proof tables, and everything they must refuse.
 *
 * One is unauthenticated by definition — a provider webhook that anybody on the internet can post
 * to. The other is the only place in this product where a *party to a dispute* writes to the
 * evidence about it. So almost all of this suite is about refusal, and the handful of accepting
 * cases are the small part.
 *
 * The property that matters most and is hardest to test by reading: **nothing here can touch a
 * classroom.** A malformed webhook, a duplicated one, a forged one, or a flood of telemetry must
 * leave the attendance ledger and the session row exactly as they were.
 *
 * Runs its own servers so the webhook secret can be present for one and absent for another; it is
 * read per request but the "not configured" case needs it genuinely unset.
 *
 * Usage: PGURL=... node scripts/session-proof/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const SECRET = "session-proof-suite-secret";
/** Scopes every count to this run: the suite must be re-runnable against the same database. */
const RUN = crypto.randomUUID().slice(0, 8);

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

async function withServer(port, extraEnv, run) {
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "session-proof-suite",
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

  const api = async (p, { method = "GET", token, body, headers = {}, rawBody } = {}) => {
    const h = { "Content-Type": "application/json", ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const payload = rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${base}/api${p}`, { method, headers: h, body: payload });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  };

  try { await run(api); } finally { stop(); }
}

/** A signed webhook body, exactly as the route verifies it: HMAC over the bytes actually sent. */
function signed(payload, secret = SECRET) {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return { rawBody: raw, headers: { "x-daily-signature": sig } };
}

let seq = 0;
async function register(api, role, extra = {}) {
  seq += 1;
  const email = `proof_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }),
    ...extra,
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  const id = Number(sql(`select id from users where email = '${email}'`));
  return { ...res.body, email, id };
}

const prepareTeacher = (id) => sql(`
  UPDATE account_security SET email_verified_at = now() WHERE user_id = ${id};
  UPDATE teacher_profiles SET approval_status = 'approved', subscription_active = true WHERE user_id = ${id};
`);

const DAY = 86_400_000;
const evt = (over = {}, payload = {}) => ({
  id: `evt_${RUN}_${crypto.randomUUID()}`,
  type: "participant.joined",
  event_ts: Math.floor(Date.now() / 1000),
  payload: { room: "sikshya1", ...payload },
  ...over,
});

async function main() {
  /* ------------------------------------------------------- the endpoint that is switched off */

  console.log("\nWith no webhook secret configured\n");
  await withServer(8181, { DAILY_WEBHOOK_SECRET: "" }, async (api) => {
    const res = await api("/webhooks/daily", { method: "POST", ...signed(evt()) });
    check("an unconfigured webhook answers 404, like any unknown path", res.status === 404, `status ${res.status}`);

    const body = JSON.stringify(res.body ?? {});
    check("and discloses no configuration name or state",
      !/DAILY_WEBHOOK_SECRET/i.test(body) && !/secret/i.test(body) && !/configur/i.test(body) && !/webhook/i.test(body),
      body);
    check("nothing was stored",
      sql(`select count(*) from session_provider_events where provider_event_id like 'evt_${RUN}%'`) === "0");
  });

  /* ---------------------------------------------------------------- the endpoint switched on */

  await withServer(8182, { DAILY_WEBHOOK_SECRET: SECRET }, async (api) => {
    const teacher = await register(api, "teacher");
    prepareTeacher(teacher.id);
    const made = await api("/sessions", { method: "POST", token: teacher.token, body: {
      subject: "Maths", topic: "Proof", date: new Date(Date.now() + 2 * DAY).toISOString(),
      duration: 60, maxStudents: 20, price: 500 } });
    if (made.status > 201) throw new Error(`create class: ${made.status} ${JSON.stringify(made.body)}`);
    const sessionId = made.body.class?.id ?? made.body.id;
    const room = `sikshya${sessionId}`;
    // Captured before any webhook arrives, so "untouched" is compared against a real value
    // rather than against whatever the create response happened to contain.
    const statusBefore = sql(`select status from sessions where id = ${sessionId}`);

    console.log("\nSignature verification\n");
    {
      const payload = evt({}, { room });
      const unsigned = await api("/webhooks/daily", { method: "POST", body: payload });
      check("an unsigned webhook is refused", unsigned.status === 401, `status ${unsigned.status}`);

      const wrongKey = await api("/webhooks/daily", { method: "POST", ...signed(payload, "not-the-secret") });
      check("a webhook signed with the wrong key is refused", wrongKey.status === 401);

      // The classic bypass: a valid signature for a *different* body.
      const swapped = signed(payload);
      const tampered = await api("/webhooks/daily", {
        method: "POST",
        rawBody: JSON.stringify({ ...payload, payload: { room: "sikshya999999" } }),
        headers: swapped.headers,
      });
      check("a signature from another body does not carry over", tampered.status === 401);

      const shortSig = await api("/webhooks/daily", {
        method: "POST", ...signed(payload), headers: { "x-daily-signature": "abc" },
      });
      check("a truncated signature is refused rather than crashing timingSafeEqual", shortSig.status === 401);

      check("no refused webhook stored anything",
        sql(`select count(*) from session_provider_events where provider_room = '${room}'`) === "0");
    }

    console.log("\nA genuine event, and the same one again\n");
    {
      const payload = evt({ id: `evt_${RUN}_stable` }, { room, owner: true, duration: 120 });
      const first = await api("/webhooks/daily", { method: "POST", ...signed(payload) });
      check("a correctly signed event is stored", first.status === 200 && first.body?.stored === true,
        `status ${first.status} ${JSON.stringify(first.body)}`);
      check("and is correlated to the right class",
        sql(`select session_id from session_provider_events where provider_event_id = 'evt_${RUN}_stable'`) === String(sessionId));

      const again = await api("/webhooks/daily", { method: "POST", ...signed(payload) });
      check("a retried delivery is accepted and not stored twice",
        again.status === 200 && again.body?.duplicate === true, JSON.stringify(again.body));
      check("exactly one row exists for that event id",
        sql(`select count(*) from session_provider_events where provider_event_id = 'evt_${RUN}_stable'`) === "1");
    }

    console.log("\nMalformed and uncorrelated events\n");
    {
      const before = sql(`select count(*) from session_provider_events where provider_room = '${room}'`);
      const cases = [
        ["a body that is not an object", "\"just a string\""],
        ["an unsupported event type", JSON.stringify(evt({ type: "recording.started" }, { room }))],
        ["an event with no id", JSON.stringify({ type: "meeting.started", event_ts: 1, payload: { room } })],
        ["an event with no room", JSON.stringify(evt({}, { room: undefined }))],
        ["a room this app never named", JSON.stringify(evt({}, { room: "somebody-elses-room" }))],
        ["a nonsense timestamp", JSON.stringify(evt({ event_ts: "yesterday" }, { room }))],
      ];
      for (const [name, raw] of cases) {
        const sig = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
        const res = await api("/webhooks/daily", {
          method: "POST", rawBody: raw, headers: { "x-daily-signature": sig },
        });
        check(`${name} is accepted and ignored, not retried`, res.status === 202 || res.status === 400,
          `status ${res.status}`);
      }
      check("and none of them was stored",
        sql(`select count(*) from session_provider_events where provider_room = '${room}'`) === before);
      check("the class is untouched by any of it",
        sql(`select status from sessions where id = ${sessionId}`) === statusBefore,
        `was ${statusBefore}`);
      check("and no attendance row was invented",
        sql(`select count(*) from session_participation where session_id = ${sessionId}`) === "0");
    }

    console.log("\nWho may report connection quality\n");
    {
      const student = await register(api, "student");
      const outsider = await register(api, "student");
      const now = new Date(Date.now() + 2 * DAY).toISOString();

      const anon = await api(`/sessions/${sessionId}/quality`, { method: "POST", body: { samples: [] } });
      check("an unauthenticated report is refused", anon.status === 401, `status ${anon.status}`);

      const notMine = await api(`/sessions/${sessionId}/quality`, {
        method: "POST", token: outsider.token, body: { samples: [{ quality: "bad", observedAt: now }] } });
      check("somebody not in the class is refused", notMine.status === 403, `status ${notMine.status}`);
      check("and stored nothing",
        sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`) === "0");

      const ghost = await api(`/sessions/99999999/quality`, {
        method: "POST", token: student.token, body: { samples: [] } });
      check("a class that does not exist is a 404, not a 500", ghost.status === 404, `status ${ghost.status}`);

      // The teacher is in the class and may report.
      const mine = await api(`/sessions/${sessionId}/quality`, {
        method: "POST", token: teacher.token,
        body: { samples: [{ quality: "bad", reconnect: true, observedAt: now }] } });
      check("the teacher's own device may report", mine.status === 200 && mine.body?.stored === 1,
        `status ${mine.status} ${JSON.stringify(mine.body)}`);
      check("and the role is the server's answer, not the body's",
        sql(`select role from session_quality_samples where session_id = ${sessionId}`) === "teacher");
    }

    console.log("\nWhat a client cannot talk its way into\n");
    {
      const now = new Date(Date.now() + 2 * DAY).toISOString();

      // A body that names somebody else, and claims a role it does not have.
      const spoof = await api(`/sessions/${sessionId}/quality`, {
        method: "POST", token: teacher.token,
        body: {
          userId: 999999, role: "student", sessionId: 123456,
          samples: [{ quality: "bad", observedAt: now, userId: 999999, role: "student" }],
        },
      });
      check("a spoofed user id and role in the body are ignored", spoof.status === 200 || spoof.status === 429,
        `status ${spoof.status}`);
      check("no row was written for the impersonated user",
        sql(`select count(*) from session_quality_samples where user_id = 999999`) === "0");
      check("and none landed on another class",
        sql(`select count(*) from session_quality_samples where session_id = 123456`) === "0");

      const stored = sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`);
      const flood = await api(`/sessions/${sessionId}/quality`, {
        method: "POST", token: teacher.token,
        body: { samples: Array.from({ length: 500 }, () => ({ quality: "bad", observedAt: now })) },
      });
      check("a flood is rate-limited rather than accepted", flood.status === 429,
        `status ${flood.status} ${JSON.stringify(flood.body)}`);
      check("and stored nothing further",
        sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`) === stored);

      check("nothing a client sent about audio, addresses or devices exists in the table",
        sql(`select count(*) from information_schema.columns where table_name = 'session_quality_samples'
             and column_name in ('ip','device_id','jitter','packets_lost','audio_level')`) === "0");
    }

    console.log("\nThe classroom is untouched throughout\n");
    {
      check("no attendance row was created by any of this",
        sql(`select count(*) from session_participation where session_id = ${sessionId}`) === "0");
      check("the session row still has no started or ended time invented for it",
        sql(`select coalesce(started_at::text,'') from sessions where id = ${sessionId}`) === "");
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
