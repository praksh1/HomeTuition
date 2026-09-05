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
/** Base64, because that is what Daily hands back and what the verifier decodes. */
const SECRET = crypto.randomBytes(32).toString("base64");
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

/**
 * A signed webhook, built the way Daily builds one — longhand, on purpose.
 *
 * Written out rather than imported from the server's own helper: a suite that signs with the same
 * function the route verifies with agrees with the implementation whatever either of them does,
 * which is exactly how a wrong algorithm passed its own tests once already.
 *
 *   key       = base64-decode(secret)
 *   input     = timestamp + "." + JSON.stringify(body)
 *   signature = base64(HMAC-SHA256(key, input))
 */
function signed(payload, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${timestamp}.${raw}`, "utf8")
    .digest("base64");
  return {
    rawBody: raw,
    headers: { "x-webhook-timestamp": String(timestamp), "x-webhook-signature": sig },
  };
}

/** The same, for a body this suite has already serialised (so a tampered one can keep its bytes). */
function signRaw(raw, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const sig = crypto
    .createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${timestamp}.${raw}`, "utf8")
    .digest("base64");
  return { rawBody: raw, headers: { "x-webhook-timestamp": String(timestamp), "x-webhook-signature": sig } };
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

/**
 * When the events in this suite claim to have happened.
 *
 * Set to the class's own scheduled instant once there is a class, because that is when a real
 * Daily event for it would occur — and because the route refuses to attach an event that falls
 * outside its class's window, which is the guard that stops a room name collision stretching one
 * lesson's recorded span across another day.
 */
let CLASS_TS = Math.floor(Date.now() / 1000);

const evt = (over = {}, payload = {}) => ({
  id: `evt_${RUN}_${crypto.randomUUID()}`,
  type: "participant.joined",
  event_ts: CLASS_TS,
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

    /*
      The deadlock this breaks.

      Creating a Daily webhook is what *returns* the signing secret, and Daily fires its
      `{"test":"test"}` probe during that same call. So the probe necessarily arrives at a
      deployment where the secret is not yet set. If this answered 404 the endpoint could never be
      activated at all, and the whole feature would be unreachable.
    */
    const probe = await api("/webhooks/daily", { method: "POST", body: { test: "test" } });
    check("Daily's activation probe is answered 200 even with no secret set",
      probe.status === 200, `status ${probe.status} ${JSON.stringify(probe.body)}`);
    check("and the probe stored nothing",
      sql(`select count(*) from session_provider_events where event_type = 'test'`) === "0");
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
    CLASS_TS = Math.floor(new Date(sql(`select date from sessions where id = ${sessionId}`)).getTime() / 1000);
    // Captured before any webhook arrives, so "untouched" is compared against a real value
    // rather than against whatever the create response happened to contain.
    const statusBefore = sql(`select status from sessions where id = ${sessionId}`);

    console.log("\nSignature verification\n");
    {
      const payload = evt({}, { room });
      const unsigned = await api("/webhooks/daily", { method: "POST", body: payload });
      check("an unsigned webhook is refused", unsigned.status === 401, `status ${unsigned.status}`);

      const wrongKey = await api("/webhooks/daily", {
        method: "POST", ...signed(payload, { secret: crypto.randomBytes(32).toString("base64") }) });
      check("a webhook signed with the wrong key is refused", wrongKey.status === 401);

      /*
        The four ways to get Daily's scheme wrong, each proven to be refused.

        Every one of these produces a perfectly good HMAC. They differ from Daily's only in which
        bytes are hashed and how the result is encoded, and a verifier that accepted any of them
        would be accepting signatures nobody but this suite can produce.
      */
      const ts = String(Math.floor(Date.now() / 1000));
      const raw = JSON.stringify(payload);
      const wrongShapes = [
        ["a digest in hex rather than base64",
          crypto.createHmac("sha256", Buffer.from(SECRET, "base64")).update(`${ts}.${raw}`).digest("hex")],
        ["a key taken as characters rather than decoded base64",
          crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("base64")],
        ["an input with no timestamp prefix",
          crypto.createHmac("sha256", Buffer.from(SECRET, "base64")).update(raw).digest("base64")],
        ["an input joined without the dot",
          crypto.createHmac("sha256", Buffer.from(SECRET, "base64")).update(`${ts}${raw}`).digest("base64")],
      ];
      for (const [name, sig] of wrongShapes) {
        const res = await api("/webhooks/daily", {
          method: "POST", rawBody: raw,
          headers: { "x-webhook-timestamp": ts, "x-webhook-signature": sig },
        });
        check(`${name} is refused`, res.status === 401, `status ${res.status}`);
      }

      const noTimestamp = await api("/webhooks/daily", {
        method: "POST", rawBody: raw,
        headers: { "x-webhook-signature": signed(payload).headers["x-webhook-signature"] },
      });
      check("a delivery with no timestamp header is refused", noTimestamp.status === 401);

      /*
        A correctly signed body from an hour ago.

        The timestamp is *inside* the signed input, so a captured delivery replayed later carries a
        genuinely valid signature. Only the freshness check catches it, and without one anybody who
        ever sees one delivery can post it back forever.
      */
      const old = Math.floor(Date.now() / 1000) - 3600;
      const stale = await api("/webhooks/daily", { method: "POST", ...signed(payload, { timestamp: old }) });
      check("a correctly signed but stale delivery is refused", stale.status === 401, `status ${stale.status}`);

      // The classic bypass: a valid signature for a *different* body.
      const swapped = signed(payload);
      const tampered = await api("/webhooks/daily", {
        method: "POST",
        rawBody: JSON.stringify({ ...payload, payload: { room: "sikshya999999" } }),
        headers: swapped.headers,
      });
      check("a signature from another body does not carry over", tampered.status === 401);

      const shortSig = await api("/webhooks/daily", {
        method: "POST", ...signed(payload),
        headers: { "x-webhook-timestamp": ts, "x-webhook-signature": "abc" },
      });
      check("a truncated signature is refused rather than crashing timingSafeEqual", shortSig.status === 401);

      check("no refused webhook stored anything",
        sql(`select count(*) from session_provider_events where provider_room = '${room}'`) === "0");

      const probe = await api("/webhooks/daily", { method: "POST", body: { test: "test" } });
      check("the activation probe is still answered 200 once a secret is set", probe.status === 200);
      check("and a body that merely resembles the probe is not exempt from signing",
        (await api("/webhooks/daily", { method: "POST", body: { test: "test", type: "meeting.started" } })).status === 401);
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

    console.log("\nWhich clock timed the row\n");
    {
      const scheduledS = CLASS_TS;
      const occurred = evt(
        { id: `evt_${RUN}_occurred`, type: "meeting.started", event_ts: scheduledS + 7200 },
        { room, start_ts: scheduledS },
      );
      const res = await api("/webhooks/daily", { method: "POST", ...signed(occurred) });
      check("a meeting is timed by its own start, not by when the callback was generated",
        res.status === 200 && res.body?.stored === true, JSON.stringify(res.body));
      check("and the row records which clock it used",
        sql(`select event_at_source from session_provider_events where provider_event_id = 'evt_${RUN}_occurred'`) === "occurred");
      check("the stored instant is the provider's own, not the delivery time",
        sql(`select extract(epoch from event_at)::bigint from session_provider_events
             where provider_event_id = 'evt_${RUN}_occurred'`) === String(scheduledS));

      const delivered = evt({ id: `evt_${RUN}_delivered`, type: "meeting.started" }, { room });
      await api("/webhooks/daily", { method: "POST", ...signed(delivered) });
      check("an event with no occurrence timestamp is labelled as delivery-timed",
        sql(`select event_at_source from session_provider_events where provider_event_id = 'evt_${RUN}_delivered'`) === "delivery");
    }

    console.log("\nA room whose class does not exist\n");
    {
      /*
        `sikshya999999` parses cleanly and correlates to session 999999, which is not a class this
        deployment has. Before this was checked, the insert failed a foreign key, the route answered
        500, and Daily retried it on a schedule forever for a row that could never be written.
      */
      const ghost = evt({ id: `evt_${RUN}_ghost` }, { room: "sikshya999999" });
      const res = await api("/webhooks/daily", { method: "POST", ...signed(ghost) });
      check("an event for a class that does not exist is answered 200, never 500",
        res.status === 200, `status ${res.status} ${JSON.stringify(res.body)}`);
      check("and reports that nothing was stored", res.body?.stored === false, JSON.stringify(res.body));
      check("and nothing was stored",
        sql(`select count(*) from session_provider_events where provider_event_id = 'evt_${RUN}_ghost'`) === "0");
      check("and it did not attach itself to some other class",
        sql(`select count(*) from session_provider_events where provider_room = 'sikshya999999'`) === "0");

      // Retried the way a provider would retry a failure, to prove the answer is stable.
      const retry = await api("/webhooks/daily", { method: "POST", ...signed(ghost) });
      check("a retry of it gets the same answer rather than a growing error", retry.status === 200);

      /*
        A real class, but an event from days away from it.

        A Daily room named `sikshya42` maps to session 42 by name alone, so a room that outlives
        its class — or one somebody opens by hand — would otherwise attach events to a lesson they
        have nothing to do with and stretch its recorded span across the gap. Stored unattached
        rather than dropped, keeping the room name, so an operator can see events arriving and
        failing to correlate: nothing arriving and nothing correlating look identical otherwise.
      */
      const strayed = evt({ id: `evt_${RUN}_strayed`, event_ts: CLASS_TS - 5 * 86_400 }, { room });
      const res2 = await api("/webhooks/daily", { method: "POST", ...signed(strayed) });
      check("an event from days outside its class is still accepted", res2.status === 200);
      check("but is not attached to that class",
        sql(`select coalesce(session_id::text, 'null') from session_provider_events
             where provider_event_id = 'evt_${RUN}_strayed'`) === "null");
      check("and keeps the room name so the failure to correlate is visible",
        sql(`select provider_room from session_provider_events where provider_event_id = 'evt_${RUN}_strayed'`) === room);
    }

    console.log("\nWhether the provider may name a participant\n");
    {
      const student = await register(api, "student");
      const stranger = await register(api, "student");

      const named = evt({ id: `evt_${RUN}_named` }, { room, user_id: teacher.id, owner: true });
      await api("/webhooks/daily", { method: "POST", ...signed(named) });
      check("a user id belonging to this class's teacher is kept",
        sql(`select participant_user_id from session_provider_events where provider_event_id = 'evt_${RUN}_named'`) === String(teacher.id));
      check("and is recorded as an accepted identification",
        sql(`select identity_rejected from session_provider_events where provider_event_id = 'evt_${RUN}_named'`) === "f");

      const impostor = evt({ id: `evt_${RUN}_impostor` }, { room, user_id: stranger.id, owner: true });
      const res = await api("/webhooks/daily", { method: "POST", ...signed(impostor) });
      check("an event naming somebody who is not in the class is still accepted", res.status === 200);
      check("but the identity is discarded rather than believed",
        sql(`select coalesce(participant_user_id::text, 'null') from session_provider_events
             where provider_event_id = 'evt_${RUN}_impostor'`) === "null");
      check("and the disagreement is recorded, not silently blanked",
        sql(`select identity_rejected from session_provider_events where provider_event_id = 'evt_${RUN}_impostor'`) === "t");
      check("a provider claiming somebody is an owner grants them nothing",
        sql(`select count(*) from session_enrollments where session_id = ${sessionId} and student_id = ${stranger.id}`) === "0");

      const madeUp = evt({ id: `evt_${RUN}_madeup` }, { room, user_id: 99999999 });
      const invented = await api("/webhooks/daily", { method: "POST", ...signed(madeUp) });
      check("a user id that belongs to nobody does not fail the insert", invented.status === 200,
        `status ${invented.status}`);
      check("and is discarded too",
        sql(`select coalesce(participant_user_id::text, 'null') from session_provider_events
             where provider_event_id = 'evt_${RUN}_madeup'`) === "null");

      // Kept for the ticket-wiring block below.
      globalThis.__proofStudent = student;
    }

    console.log("\nMalformed and uncorrelated events\n");
    {
      const before = sql(`select count(*) from session_provider_events where provider_room = '${room}'`);

      /*
        A JSON string body never reaches the route: `express.json()` runs in strict mode and
        refuses anything that is not an object or an array with a 400 of its own. Asserted here so
        the 400 is a known, deliberate answer rather than a surprise the next time somebody reads
        the status codes — and it is not a risk to ingestion, because Daily only ever sends objects.
      */
      const notJsonObject = await api("/webhooks/daily", { method: "POST", ...signRaw("\"just a string\"") });
      check("a JSON string is refused by the body parser before the route sees it",
        notJsonObject.status === 400, `status ${notJsonObject.status}`);

      const cases = [
        ["an array rather than an object", "[1,2,3]"],
        ["an unsupported event type", JSON.stringify(evt({ type: "recording.started" }, { room }))],
        ["an event with no id", JSON.stringify({ type: "meeting.started", event_ts: 1, payload: { room } })],
        ["an event with no room", JSON.stringify(evt({}, { room: undefined }))],
        ["a room this app never named", JSON.stringify(evt({}, { room: "somebody-elses-room" }))],
        ["a nonsense timestamp", JSON.stringify(evt({ event_ts: "yesterday" }, { room }))],
      ];
      for (const [name, raw] of cases) {
        const res = await api("/webhooks/daily", { method: "POST", ...signRaw(raw) });
        /*
          200, not 202 and certainly not 4xx.

          Daily deactivates a webhook whose endpoint keeps failing, so a body this product chooses
          to ignore must not look like a fault. Losing ingestion because of a stream of event types
          we deliberately do not store would be a silent, permanent outage of the corroboration.
        */
        check(`${name} is accepted and ignored with a plain 200`, res.status === 200, `status ${res.status}`);
        check(`${name} reports that nothing was stored`, res.body?.stored === false, JSON.stringify(res.body));
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
      const student = globalThis.__proofStudent;
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

      /*
        The teacher is in the class and may report — and the body deliberately carries a role and a
        user id it is not entitled to.

        An earlier version of this suite posted a clean body here and put the spoof in a later
        block, where the rate limit refused it before anything was written. The guard was therefore
        never exercised: deliberately sourcing the role from the body left the suite green. The
        spoof belongs on the request that actually stores a row.
      */
      const mine = await api(`/sessions/${sessionId}/quality`, {
        method: "POST", token: teacher.token,
        body: {
          role: "student", userId: 999999,
          samples: [{ quality: "bad", reconnect: true, observedAt: now, role: "student", userId: 999999 }],
        } });
      check("the teacher's own device may report", mine.status === 200 && mine.body?.stored === 1,
        `status ${mine.status} ${JSON.stringify(mine.body)}`);
      check("and the role is the server's answer, not the body's",
        sql(`select role from session_quality_samples where session_id = ${sessionId}`) === "teacher");
      check("and the row belongs to the authenticated caller, not the body's user id",
        sql(`select user_id from session_quality_samples where session_id = ${sessionId}`) === String(teacher.id));
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

    console.log("\nTen devices posting at once\n");
    {
      /*
        The rate limit used to be a read-then-write, and a read-then-write races itself.

        Ten parallel posts all read the same count, all see room under the cap, and all insert — so
        the per-class cap becomes a suggestion and the ten-second limit never fires. That is exactly
        the shape a party to a dispute would use to bury a class in self-reported evidence. The
        route now takes an advisory lock on (session, user) inside the transaction.
      */
      const student = globalThis.__proofStudent;
      const booked = await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token });
      check("a student can book the class so their device may report",
        booked.status === 200 || booked.status === 201, `status ${booked.status} ${JSON.stringify(booked.body)}`);

      const at = new Date(Date.now() + 2 * DAY).toISOString();
      const one = () => api(`/sessions/${sessionId}/quality`, {
        method: "POST", token: student.token,
        body: { samples: [{ quality: "bad", observedAt: at }] },
      });
      const results = await Promise.all(Array.from({ length: 10 }, one));
      const accepted = results.filter((r) => r.status === 200 && (r.body?.stored ?? 0) > 0).length;
      const limited = results.filter((r) => r.status === 429).length;
      check("only one of ten simultaneous posts is accepted", accepted === 1,
        `accepted ${accepted}, limited ${limited}`);
      check("and exactly one row exists for that device",
        sql(`select count(*) from session_quality_samples
             where session_id = ${sessionId} and user_id = ${student.id}`) === "1");
    }

    console.log("\nA class that finished long ago\n");
    {
      /*
        The window used to end at `max(bookedEnd, now)`, which for any finished class is `now`.

        So a student disputing a lesson from three months ago could file a wall of bad-connection
        reports dated this morning and have every one land on that lesson's timeline, against a
        teacher with no way to contradict them.
      */
      const student = globalThis.__proofStudent;
      const old = await api("/sessions", { method: "POST", token: teacher.token, body: {
        subject: "Maths", topic: "Old", date: new Date(Date.now() + 3 * DAY).toISOString(),
        duration: 60, maxStudents: 20, price: 500 } });
      const oldId = old.body?.class?.id ?? old.body?.id;
      if (!Number.isInteger(oldId)) {
        throw new Error(`could not create the second class: ${old.status} ${JSON.stringify(old.body)}`);
      }
      await api(`/sessions/${oldId}/book`, { method: "POST", token: student.token });
      // Backdated after booking, so the booking itself is not the thing being tested.
      sql(`update sessions set date = now() - interval '90 days', status = 'completed' where id = ${oldId}`);

      const today = await api(`/sessions/${oldId}/quality`, {
        method: "POST", token: student.token,
        body: { samples: [{ quality: "bad", reconnect: true, observedAt: new Date().toISOString() }] },
      });
      check("a report dated today is refused for a class held three months ago",
        today.status === 200 && today.body?.stored === 0, `${today.status} ${JSON.stringify(today.body)}`);
      check("and it is refused for being outside the class, not for some other reason",
        (today.body?.rejected?.outside_window ?? 0) === 1, JSON.stringify(today.body));
      check("nothing landed on that class",
        sql(`select count(*) from session_quality_samples where session_id = ${oldId}`) === "0");

      const then = await api(`/sessions/${oldId}/quality`, {
        method: "POST", token: student.token,
        body: { samples: [{ quality: "bad", observedAt: new Date(Date.now() - 90 * DAY + 30 * 60_000).toISOString() }] },
      });
      check("a report from inside that class is still accepted", then.body?.stored === 1,
        JSON.stringify(then.body));
    }

    console.log("\nWhat the operator's evidence page is given\n");
    {
      /*
        Production wiring, not a fixture.

        The pure aggregate has always been able to list a teacher who never appeared. The route
        that feeds it seeded only paid students, so on the real page the teacher simply vanished —
        in exactly the case a dispute is about.
      */
      const student = globalThis.__proofStudent;
      const agentAccount = await register(api, "student");
      sql(`update users set role = 'admin' where id = ${agentAccount.id}`);
      const agentLogin = await api("/auth/login", { method: "POST", body: {
        email: agentAccount.email, password: "password123" } });
      const agentToken = agentLogin.body?.token ?? agentAccount.token;

      const filed = await api("/disputes", { method: "POST", token: student.token, body: {
        reason: "Other", description: `Proof wiring ${RUN}` } });
      const ticketId = filed.body?.id;
      check("a ticket could be filed to read the evidence from", Number.isInteger(ticketId),
        `${filed.status} ${JSON.stringify(filed.body)}`);
      sql(`update disputes set session_id = ${sessionId} where id = ${ticketId}`);

      const ticket = await api(`/admin/tickets/${ticketId}`, { token: agentToken });
      check("the desk can open it", ticket.status === 200, `status ${ticket.status}`);
      const proof = ticket.body?.proof;
      check("the evidence page carries the proof summary", proof !== null && proof !== undefined);

      const people = proof?.people ?? [];
      const teacherRow = people.find((p) => p.userId === teacher.id);
      check("the class's own teacher is listed even though no source recorded them joining",
        teacherRow !== undefined,
        `people: ${JSON.stringify(people.map((p) => [p.userId, p.role]))}`);
      check("and is listed as the teacher", teacherRow?.role === "teacher");
      check("with time present reported as unknown rather than zero",
        teacherRow?.presentMs?.available === false, JSON.stringify(teacherRow?.presentMs));
      check("the paying student is listed too",
        people.some((p) => p.userId === student.id && p.role === "student"));
      check("the teacher is first, because a dispute is mostly about the teacher",
        people[0]?.role === "teacher");
      check("no verdict, recommendation or fault appears anywhere in it",
        !/\b(refund|recommend|verdict|at fault|entitled)\b/i.test(JSON.stringify(proof ?? {})));
    }

    console.log("\nTwo meetings in one room\n");
    {
      const made2 = await api("/sessions", { method: "POST", token: teacher.token, body: {
        subject: "Maths", topic: "Dropped", date: new Date(Date.now() + 4 * DAY).toISOString(),
        duration: 60, maxStudents: 20, price: 500 } });
      const id2 = made2.body?.class?.id ?? made2.body?.id;
      if (!Number.isInteger(id2)) {
        throw new Error(`could not create the third class: ${made2.status} ${JSON.stringify(made2.body)}`);
      }
      const room2 = `sikshya${id2}`;
      const startS = Math.floor(new Date(sql(`select date from sessions where id = ${id2}`)).getTime() / 1000);

      const shots = [
        ["a1", "meeting.started", { start_ts: startS }, "mtg-a"],
        ["a2", "meeting.ended", { end_ts: startS + 1200 }, "mtg-a"],
        ["b1", "meeting.started", { start_ts: startS + 2400 }, "mtg-b"],
        ["b2", "meeting.ended", { end_ts: startS + 3000 }, "mtg-b"],
      ];
      for (const [tag, type, extra, meeting] of shots) {
        const body = evt({ id: `evt_${RUN}_${tag}`, type }, { room: room2, meeting_id: meeting, ...extra });
        const res = await api("/webhooks/daily", { method: "POST", ...signed(body) });
        check(`${type} for ${meeting} is stored`, res.status === 200 && res.body?.stored === true,
          `${res.status} ${JSON.stringify(res.body)}`);
      }
      check("both meeting ids survive to the row",
        sql(`select count(distinct provider_meeting_id) from session_provider_events where session_id = ${id2}`) === "2");
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
