/**
 * The classroom floor, end to end — the socket layer, the database and the provider.
 *
 * `speakingFloor.test.ts` proves the rules. `floorProtocol.test.ts` proves they cannot be reached
 * around. Neither of those touches a database, a provider or a room, and every one of the failures
 * this suite is looking for lives in exactly those seams:
 *
 * - a permission the class was told about that never reached the SFU;
 * - a mute that revoked a right and left the microphone open;
 * - a student who reconnected and came back silent because LiveKit sees a reconnection as a new
 *   participant minted from a token that permits nothing;
 * - a Monthly entitlement read from the wrong row;
 * - a student's payload carrying another student's name.
 *
 * ## Against a recording LiveKit rather than a real one
 *
 * `sikshya/scripts/livekit-live` already runs a real `livekit-server` and proves media flows. What
 * that suite cannot do is assert *what the server asked for* — it can see a microphone go quiet
 * and not whether the request that did it named the right participant, the right room, and the
 * right sources. So this one stands a stub on the Twirp endpoints the SDK actually posts to and
 * keeps every request. The two are complementary: one proves it works, this one proves it asked
 * for the right thing.
 *
 * Usage: PGURL=... node scripts/floor-tests/run.mjs
 */
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};
const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

/* ------------------------------------------------------------------------- */
/* A LiveKit that writes down what it was asked                               */
/* ------------------------------------------------------------------------- */

/** Every Twirp call the server made, in order. The assertions read this. */
const calls = [];
/**
 * Identities this fake believes are in a room, so `ListParticipants` can answer.
 *
 * Populated from whoever the server has granted something to, which is realistic — you cannot be
 * granted the floor without being in the room — and saves every test from bookkeeping. Without it
 * `silence()` looked the participant up, did not find them, and returned false; the mute path
 * would have passed by never running, which is the worst way for a test to pass.
 */
const present = new Set();

/**
 * How the fake should answer, per identity.
 *
 * `ok` applies. `absent` answers exactly as a real livekit-server does for a participant who is
 * not in the room — measured: `code: "not_found"`, status 404, "participant does not exist".
 * `fail` is an outage. `slow` applies, late. Set through `behaviour.set(identity, mode)`.
 */
const behaviour = new Map();
const modeFor = (identity) => behaviour.get(String(identity)) ?? "ok";
/** Every retry the server made, so a test can prove it retried rather than gave up silently. */
const attempts = [];

/**
 * Requests parked mid-flight, so a test can decide when the provider answers.
 *
 * `slow` proves the server does not claim success early; it cannot prove anything about *ordering*,
 * because a timeout is still the harness guessing. Codex's sixth finding is entirely about
 * ordering — an older answer arriving after a newer instruction — so the tests for it have to hold
 * a request open, take a second action while it is open, and then release the first by hand.
 *
 * Set `behaviour.set(identity, "hold")` and the fake stops replying; `heldRequests(identity, n)`
 * waits until `n` are parked and `release(entry)` answers one.
 */
const holding = new Map();
const parked = (identity) => holding.get(String(identity)) ?? [];
/**
 * Wait until this identity has `n` requests parked, or give up rather than hang the suite.
 *
 * Named for the requests rather than `held`, because two sections below already use `held` for a
 * row of the activity log and one word meaning two things in one file is how a later edit picks
 * the wrong one.
 */
async function heldRequests(identity, n, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (parked(identity).length >= n) return parked(identity);
    await new Promise((r) => setTimeout(r, 10));
  }
  return parked(identity);
}
/** Answer one parked request, and let the server's loop carry on. */
async function release(entry, { status = 200, body = {} } = {}) {
  if (!entry) return;
  entry.res.writeHead(status, { "content-type": "application/json" });
  entry.res.end(JSON.stringify(body));
  entry.done = true;
  await settle();
}

/**
 * The three endpoints `livekit-server-sdk`'s `RoomServiceClient` posts to.
 *
 * Deliberately answers rather than refuses: a stub that 500s would prove only that the code
 * handles a failure, and what is being tested is the request. `ListParticipants` returns one
 * participant holding two unmuted tracks so that `silence()` has something to mute — otherwise
 * the mute path would pass by never running.
 */
function startFakeLiveKit() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const method = req.url.split("/").pop();
        let parsed = {};
        try { parsed = JSON.parse(body || "{}"); } catch { /* recorded as {} */ }
        calls.push({ method, body: parsed, auth: req.headers.authorization ?? "" });

        if (method === "UpdateParticipant" && typeof parsed.identity === "string") present.add(parsed.identity);

        const who = parsed.identity ?? "";
        const mode = modeFor(who);
        if (method === "UpdateParticipant" || method === "MutePublishedTrack") attempts.push({ method, who, mode });

        if (mode === "hold" && method !== "ListParticipants") {
          const list = holding.get(who) ?? [];
          list.push({ method, body: parsed, res, done: false });
          holding.set(who, list);
          return;
        }

        if (mode === "absent" && (method === "UpdateParticipant" || method === "MutePublishedTrack")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: "not_found", msg: "participant does not exist" }));
          return;
        }
        if (mode === "fail" && method !== "ListParticipants") {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: "unavailable", msg: "no response from servers" }));
          return;
        }

        let answer = {};
        if (method === "ListParticipants") {
          answer = {
            participants: [...present].map((identity) => ({
              identity,
              // Two unmuted tracks each, so a mute has something real to stop and the call the
              // server makes can be read back rather than inferred.
              tracks: [
                { sid: `TR_mic_${identity}`, muted: false, source: "MICROPHONE" },
                { sid: `TR_cam_${identity}`, muted: false, source: "CAMERA" },
              ],
            })),
          };
        }
        const reply = () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(answer));
        };
        if (mode === "slow" && method !== "ListParticipants") setTimeout(reply, 700);
        else reply();
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const { server: fake, port } = await startFakeLiveKit();

/*
  The environment the bundle will read.

  Set before the import, because `videoProvider()` reads `VIDEO_PROVIDER` at call time but the
  database module reads its URL at load. LiveKit is named explicitly: the whole point of this suite
  is the provider that can enforce a permission, and the default is Daily, which cannot.
*/
process.env.DATABASE_URL = PGURL;
/*
  Production logging, so the bundle does not pull in pino's pretty transport.

  `lib/logger.ts` attaches `pino-pretty` outside production, and that transport spawns a worker by
  `__dirname` — which does not exist in an ES module, so bundling it fails at import with a
  `ReferenceError` that has nothing whatever to do with the classroom. Nothing else in this suite
  reads NODE_ENV; the plain JSON logger is what a deployment uses anyway.
*/
process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.VIDEO_PROVIDER = "livekit";
process.env.LIVEKIT_URL = `ws://127.0.0.1:${port}`;
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "floor-suite-secret-not-a-real-one";

/*
  Bundled for the same reason `entitlement-tests` bundles: `@workspace/db` uses directory imports
  Node's ESM loader will not resolve, and this module reaches it through four others. The
  `pg-native`/`createRequire` handling is copied from `build.mjs` rather than invented, so the two
  cannot drift into disagreeing about how `pg` loads.
*/
const esbuild = await import(createRequire(path.join(serverRoot, "package.json")).resolve("esbuild"));
const bundlePath = path.join(mkdtempSync(path.join(tmpdir(), "floor-")), "floor.mjs");
await (esbuild.build ?? esbuild.default.build)({
  entryPoints: [path.join(serverRoot, "src", "ws", "classroomFloor.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);",
  },
  logLevel: "error",
  absWorkingDir: serverRoot,
});
const floorModule = await import(bundlePath);
const { handleFloorFrame, floorJoin, floorLeave, restartFloorFor, endFloorFor, forgetFloor, peekFloor } = floorModule;

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

const stamp = Date.now();
let seq = 0;

/** A Monthly class-day starting shortly, so the discussion window is a real thing to test. */
function makeMonthlyClass({ minutesFromNow = 5, duration = 60 } = {}) {
  seq += 1;
  const when = `now() + interval '${minutesFromNow} minutes'`;
  const row = sql(`
    WITH u AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Floor Teacher', 'floor_t_${stamp}_${seq}@example.com', 'teacher', 'x') RETURNING id
    ), prof AS (
      INSERT INTO teacher_profiles (user_id, subject, bio, approval_status)
      SELECT id, 'Maths', 'x', 'approved' FROM u
    ), plan AS (
      INSERT INTO teacher_plans (teacher_id, price, cycle_anchor, status)
      SELECT id, 6500, now() - interval '3 days', 'active' FROM u RETURNING id, teacher_id
    ), rec AS (
      INSERT INTO recurring_sessions (plan_id, teacher_id, subject, topic, start_minute, duration_minutes, monthly_price)
      SELECT id, teacher_id, 'Maths', 'Algebra', 1020, ${duration}, 2000 FROM plan RETURNING id
    ), sess AS (
      INSERT INTO sessions (teacher_id, teacher_name, subject, topic, date, duration, price, status)
      SELECT teacher_id, 'Floor Teacher', 'Maths', 'Algebra', ${when}, ${duration}, 0, 'live' FROM plan
      RETURNING id, teacher_id
    ), day AS (
      INSERT INTO recurring_days (recurring_id, session_id, cycle_index, kind, scheduled_for, status)
      SELECT rec.id, sess.id, 0, 'regular', ${when}, 'planned' FROM rec, sess RETURNING id
    ), s1 AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Sita Sharma', 'floor_s1_${stamp}_${seq}@example.com', 'student', 'x') RETURNING id
    ), s2 AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Ram Bahadur', 'floor_s2_${stamp}_${seq}@example.com', 'student', 'x') RETURNING id
    )
    SELECT sess.id || ',' || sess.teacher_id || ',' || s1.id || ',' || s2.id
      FROM sess, s1, s2, day`);
  const [sessionId, teacherId, oneId, twoId] = row.split(",").map(Number);
  if (!Number.isInteger(sessionId)) throw new Error(`fixture produced "${row}"`);
  return { sessionId, teacherId, oneId, twoId };
}

/** A pay-as-you-go class: a real session with no recurring day pointing at it. */
function makePaygClass({ minutesFromNow = 5, duration = 60 } = {}) {
  seq += 1;
  const row = sql(`
    WITH u AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Payg Teacher', 'floor_pt_${stamp}_${seq}@example.com', 'teacher', 'x') RETURNING id
    ), prof AS (
      INSERT INTO teacher_profiles (user_id, subject, bio, approval_status)
      SELECT id, 'Maths', 'x', 'approved' FROM u
    ), sess AS (
      INSERT INTO sessions (teacher_id, teacher_name, subject, topic, date, duration, price, status)
      SELECT id, 'Payg Teacher', 'Maths', 'One-off', now() + interval '${minutesFromNow} minutes', ${duration}, 500, 'live'
      FROM u RETURNING id, teacher_id
    ), s1 AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Gita Rai', 'floor_ps_${stamp}_${seq}@example.com', 'student', 'x') RETURNING id
    )
    SELECT sess.id || ',' || sess.teacher_id || ',' || s1.id FROM sess, s1`);
  const [sessionId, teacherId, oneId] = row.split(",").map(Number);
  if (!Number.isInteger(sessionId)) throw new Error(`payg fixture produced "${row}"`);
  return { sessionId, teacherId, oneId };
}

/* ------------------------------------------------------------------------- */
/* A room, without a socket in it                                             */
/* ------------------------------------------------------------------------- */

/** One connected person, keeping everything the server sent them. */
function person(userId, isSessionTeacher, name) {
  const inbox = [];
  return {
    userId,
    isSessionTeacher,
    name,
    inbox,
    send: (msg) => inbox.push(msg),
    /** The most recent floor state they were sent, or null if they have had none. */
    floor: () => [...inbox].reverse().find((m) => m.type === "floor_state")?.floor ?? null,
    /** The most recent refusal, cleared as it is read so the next assertion is about the next one. */
    refusal: () => {
      const i = inbox.map((m) => m.type).lastIndexOf("floor_refused");
      return i === -1 ? null : inbox[i];
    },
  };
}

function makeRoom(people) {
  return { clients: () => people.filter((p) => p.here !== false) };
}

/** Wait for the fire-and-forget provider pushes to actually land on the stub. */
const settle = () => new Promise((r) => setTimeout(r, 60));

async function act(sessionId, room, who, msg) {
  await handleFloorFrame(String(sessionId), room, who, msg);
  await settle();
}

/** Twirp calls since a marker, so each test reads only its own. */
const mark = () => calls.length;
const since = (m) => calls.slice(m);

console.log("\nThe classroom floor, against a database and a recording LiveKit\n");

/* --- 1. joining ---------------------------------------------------------- */

{
  const { sessionId, teacherId, oneId, twoId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);

  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");

  check("a teacher joining is sent the whole roster", teacher.floor()?.scope === "teacher");
  check("a student joining is sent their own row and nothing else", one.floor()?.scope === "student");
  check("a monthly class knows it carries the discussion benefit",
    one.floor()?.discussionEligible === true, JSON.stringify(one.floor()));
  check("and nobody is granted anything by arriving",
    one.floor()?.you.state === "audience" && one.floor()?.you.allowedMic === false);

  forgetFloor(String(sessionId));
}

/* --- 2. a raised hand, a grant, and what LiveKit was actually told -------- */

const grantCase = makeMonthlyClass();
{
  const { sessionId, teacherId, oneId, twoId } = grantCase;
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");

  let m = mark();
  await act(sessionId, room, one, { type: "floor_ask" });
  check("a raised hand reaches the teacher's queue",
    teacher.floor()?.queue.length === 1 && teacher.floor()?.queue[0] === oneId,
    JSON.stringify(teacher.floor()?.queue));
  check("and asks the provider for nothing at all", since(m).length === 0,
    since(m).map((c) => c.method).join(","));
  check("the student is told where they are in the line", one.floor()?.queuePosition === 1);
  check("a raised hand is not broadcast to the other students",
    two.inbox.filter((msg) => msg.type === "floor_state").length === 1,
    "a student should hear only about their own row");

  m = mark();
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  const update = since(m).find((c) => c.method === "UpdateParticipant");
  check("granting the floor reaches LiveKit", Boolean(update), since(m).map((c) => c.method).join(","));
  check("naming the right room", update?.body?.room === `sikshya${sessionId}`, JSON.stringify(update?.body));
  check("naming the student by their account id, not their name",
    update?.body?.identity === String(oneId), JSON.stringify(update?.body));
  /*
    Read in the SDK's own spelling, and read for what is *absent* as much as what is present.

    Two things a first version of these assertions got wrong, both of which made them pass while
    checking nothing. The wire is camelCase, not the protobuf snake_case — `can_publish_sources`
    is always undefined, so `?? []` made every assertion about it vacuously true. And Twirp's JSON
    omits false and empty values entirely, so `canPublishData === false` never holds: the field is
    simply not there, and protobuf's decoder reads its absence as false.
  */
  const perm = update?.body?.permission ?? {};
  check("permitting the microphone and only the microphone",
    perm.canPublish === true &&
      JSON.stringify(perm.canPublishSources ?? []) === JSON.stringify(["MICROPHONE"]),
    JSON.stringify(perm));
  check("and never the data channel", perm.canPublishData !== true, JSON.stringify(perm));
  check("the request is signed", (update?.auth ?? "").startsWith("Bearer "));
  check("and the signing secret is not in it", !JSON.stringify(update ?? {}).includes(process.env.LIVEKIT_API_SECRET));

  check("the student is told they may speak but nothing is switched on",
    one.floor()?.you.state === "allowed-not-accepted", JSON.stringify(one.floor()?.you));

  m = mark();
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });
  check("accepting opens nothing at the provider — the device is the student's",
    since(m).length === 0, since(m).map((c) => c.method).join(","));
  check("and the class now reads them as speaking", one.floor()?.you.state === "speaking");
}

/* --- 3. a mute both revokes and cuts off --------------------------------- */

{
  const { sessionId, teacherId, oneId } = grantCase;
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);

  const m = mark();
  await act(sessionId, room, teacher, { type: "floor_mute", userId: oneId });
  const methods = since(m).map((c) => c.method);
  check("muting revokes the right to speak again", methods.includes("UpdateParticipant"), methods.join(","));
  check("and stops the microphone that is open right now", methods.includes("MutePublishedTrack"), methods.join(","));

  /*
    The assertion this suite exists for.

    LiveKit's `GetCanPublishSource` returns *true* for an empty source list when `canPublish` is
    true — "unrestricted", not "nothing" — so a mute that sent `canPublish: true` with no sources
    would hand the muted student a camera and a screen share. `canPublish` must therefore be
    absent (Twirp's spelling of false) rather than true-with-nothing.
  */
  const revoked = since(m).find((c) => c.method === "UpdateParticipant");
  const revokedPerm = revoked?.body?.permission ?? {};
  check("a mute leaves them unable to publish at all, not unrestricted",
    revokedPerm.canPublish !== true &&
      (revokedPerm.canPublishSources === undefined || revokedPerm.canPublishSources.length === 0),
    JSON.stringify(revokedPerm));
  const muted = since(m).find((c) => c.method === "MutePublishedTrack");
  check("the mute names a real track sid",
    typeof muted?.body?.trackSid === "string" && muted.body.trackSid.length > 0,
    JSON.stringify(muted?.body));
  check("the student is told who silenced them", one.floor()?.you.state === "muted-by-teacher",
    JSON.stringify(one.floor()?.you));
}

/* --- 4. a student who never accepted is not chased with a mute ----------- */

{
  const { sessionId, teacherId, twoId } = grantCase;
  const teacher = person(teacherId, true, "Floor Teacher");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, two]);

  await act(sessionId, room, teacher, { type: "floor_allow", userId: twoId, scope: "mic" });
  const m = mark();
  await act(sessionId, room, teacher, { type: "floor_return_audience", userId: twoId });
  const methods = since(m).map((c) => c.method);
  check("withdrawing a permission nobody acted on revokes it", methods.includes("UpdateParticipant"), methods.join(","));
  check("and does not spend a round trip stopping a track that was never open",
    !methods.includes("ListParticipants") && !methods.includes("MutePublishedTrack"), methods.join(","));
}

/* --- 5. reconnecting ----------------------------------------------------- */

{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic+camera" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic+camera" });

  floorLeave(String(sessionId), room, oneId, false);
  check("a student who drops is shown to the teacher as disconnected",
    teacher.floor()?.students.find((r) => r.userId === oneId)?.state === "disconnected",
    JSON.stringify(teacher.floor()?.students));

  const back = person(oneId, false, "Sita Sharma");
  const room2 = makeRoom([teacher, back]);
  const m = mark();
  await floorJoin(String(sessionId), room2, back, "Sita Sharma");
  await settle();
  const restored = since(m).find((c) => c.method === "UpdateParticipant");
  check("coming back re-pushes their standing grant, which LiveKit has forgotten",
    Boolean(restored) && restored.body.identity === String(oneId), since(m).map((c) => c.method).join(","));
  check("the permission survives the reconnect", back.floor()?.you.allowedMic === true,
    JSON.stringify(back.floor()?.you));
  check("but nothing is switched back on without them saying so",
    back.floor()?.you.acceptedMic === false, JSON.stringify(back.floor()?.you));
}

/* --- 6. a revoked permission stays revoked across a reconnect ------------ */

{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });
  await act(sessionId, room, teacher, { type: "floor_return_audience", userId: oneId });

  floorLeave(String(sessionId), room, oneId, false);
  const back = person(oneId, false, "Sita Sharma");
  const room2 = makeRoom([teacher, back]);
  await floorJoin(String(sessionId), room2, back, "Sita Sharma");

  check("a student sent back to the audience returns to it", back.floor()?.you.state === "audience");
  const stolen = await handleFloorFrame(String(sessionId), room2, back, { type: "floor_accept", scope: "mic" });
  void stolen;
  check("and a stale client cannot accept its way back in",
    back.refusal()?.code === "not-allowed", JSON.stringify(back.refusal()));
}

/* --- 7. discussion mode, on the plan and off it -------------------------- */

{
  const payg = makePaygClass();
  const teacher = person(payg.teacherId, true, "Payg Teacher");
  const one = person(payg.oneId, false, "Gita Rai");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(payg.sessionId), room, teacher, "Payg Teacher");
  await floorJoin(String(payg.sessionId), room, one, "Gita Rai");

  check("a pay-as-you-go class is told it has no discussion", one.floor()?.discussionEligible === false);
  await act(payg.sessionId, room, teacher, { type: "floor_start_discussion" });
  check("and its teacher is told it is not on the plan, never that it is too early",
    teacher.refusal()?.code === "not-monthly", JSON.stringify(teacher.refusal()));
  check("individual ask-to-speak still works on a pay-as-you-go class", (() => {
    return one.floor()?.discussionEligible === false;
  })());
  await act(payg.sessionId, room, one, { type: "floor_ask" });
  check("a pay-as-you-go student may still raise their hand",
    teacher.floor()?.queue.includes(payg.oneId), JSON.stringify(teacher.floor()?.queue));
}

{
  // A class that started 45 minutes into its own hour: inside the last twenty minutes.
  const late = makeMonthlyClass({ minutesFromNow: -45, duration: 60 });
  const teacher = person(late.teacherId, true, "Floor Teacher");
  const one = person(late.oneId, false, "Sita Sharma");
  const two = person(late.twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(late.sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(late.sessionId), room, one, "Sita Sharma");
  await floorJoin(String(late.sessionId), room, two, "Ram Bahadur");

  await act(late.sessionId, room, teacher, { type: "floor_start_discussion" });
  check("inside the last twenty minutes a monthly teacher may open the discussion",
    one.floor()?.mode === "discussion", JSON.stringify(teacher.refusal() ?? one.floor()));

  let m = mark();
  await act(late.sessionId, room, one, { type: "floor_join_discussion", scope: "mic+camera" });
  await act(late.sessionId, room, two, { type: "floor_join_discussion", scope: "mic+camera" });
  const grants = since(m).filter((c) => c.method === "UpdateParticipant");
  check("more than one camera is allowed in a discussion", grants.length === 2, String(grants.length));
  check("and each grant names its own student",
    grants.map((c) => c.body.identity).sort().join(",") === [late.oneId, late.twoId].map(String).sort().join(","),
    grants.map((c) => c.body.identity).join(","));

  await act(late.sessionId, room, one, { type: "floor_accept", scope: "mic+camera" });
  m = mark();
  await act(late.sessionId, room, teacher, { type: "floor_end_discussion" });
  const after = since(m);
  check("closing it revokes both students", after.filter((c) => c.method === "UpdateParticipant").length === 2,
    after.map((c) => c.method).join(","));
  check("and cuts off only the one who had switched anything on",
    after.filter((c) => c.method === "MutePublishedTrack").length === 2, // one mic + one camera track
    after.map((c) => c.method).join(","));
  check("everybody is back in the ordinary classroom", one.floor()?.mode === "classroom" && two.floor()?.mode === "classroom");
}

/* --- 8. a monthly class too early for its own discussion ----------------- */

{
  const early = makeMonthlyClass({ minutesFromNow: 0, duration: 90 });
  const teacher = person(early.teacherId, true, "Floor Teacher");
  const room = makeRoom([teacher]);
  await floorJoin(String(early.sessionId), room, teacher, "Floor Teacher");
  await act(early.sessionId, room, teacher, { type: "floor_start_discussion" });
  check("a monthly class outside the window is told to wait, which is true",
    teacher.refusal()?.code === "too-early", JSON.stringify(teacher.refusal()));
}

/* --- 9. the class being over --------------------------------------------- */

{
  // Booked to finish ninety minutes ago; the cutoff is ten minutes after that.
  const done = makeMonthlyClass({ minutesFromNow: -150, duration: 60 });
  const teacher = person(done.teacherId, true, "Floor Teacher");
  const one = person(done.oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(done.sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(done.sessionId), room, one, "Sita Sharma");

  const m = mark();
  await act(done.sessionId, room, one, { type: "floor_ask" });
  check("a student cannot raise their hand in a class that is over",
    one.refusal()?.code === "class-over", JSON.stringify(one.refusal()));
  await act(done.sessionId, room, teacher, { type: "floor_allow", userId: done.oneId, scope: "mic" });
  check("and the teacher cannot grant a microphone in one",
    teacher.refusal()?.code === "class-over", JSON.stringify(teacher.refusal()));
  check("nothing reached the provider", since(m).length === 0, since(m).map((c) => c.method).join(","));
}

/* --- 10. what a student is allowed to see -------------------------------- */

{
  const { sessionId, teacherId, oneId, twoId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");

  await act(sessionId, room, two, { type: "floor_ask" });
  await act(sessionId, room, teacher, { type: "floor_allow", userId: twoId, scope: "mic+camera" });
  await act(sessionId, room, teacher, { type: "floor_mute", userId: twoId });

  const everythingSita = JSON.stringify(one.inbox);
  check("a student is never sent another student's name", !everythingSita.includes("Ram Bahadur"), everythingSita.slice(0, 300));
  check("nor another student's account id", !everythingSita.includes(`"userId":${twoId}`), everythingSita.slice(0, 300));
  check("the teacher does see both, because it is their moderation list",
    (teacher.floor()?.students.length ?? 0) === 2, JSON.stringify(teacher.floor()?.students?.length));
  check("with the names the database holds, not names a client sent",
    teacher.floor()?.students.some((r) => r.name === "Ram Bahadur"), JSON.stringify(teacher.floor()?.students));
}

/* --- 11. authority, over a real socket's identity ------------------------ */

{
  const { sessionId, teacherId, oneId, twoId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");

  const m = mark();
  await act(sessionId, room, one, { type: "floor_allow", userId: oneId, scope: "mic+camera" });
  check("a student cannot grant themselves the floor", one.refusal()?.code === "not-yours",
    JSON.stringify(one.refusal()));
  await act(sessionId, room, one, { type: "floor_mute", userId: twoId });
  check("nor mute a classmate", one.refusal()?.code === "not-yours", JSON.stringify(one.refusal()));
  await act(sessionId, room, teacher, { type: "floor_mute", userId: 987654321 });
  check("a teacher cannot moderate somebody who is not in the class",
    teacher.refusal()?.code === "not-a-student", JSON.stringify(teacher.refusal()));
  check("and none of that reached the provider", since(m).length === 0, since(m).map((c) => c.method).join(","));
  check("nor invented a participant", (teacher.floor()?.students.length ?? 0) === 2,
    JSON.stringify(teacher.floor()?.students?.length));
}

/* --- 12. the class ending clears the floor ------------------------------- */

{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });

  endFloorFor(String(sessionId));
  check("ending the class takes every permission with it",
    (peekFloor(String(sessionId))?.students.size ?? -1) === 0,
    String(peekFloor(String(sessionId))?.students.size));

  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });
  check("and a client still holding the old state cannot act on it",
    one.refusal()?.code === "not-allowed", JSON.stringify(one.refusal()));
}

/* --- 13. what the record says -------------------------------------------- */

{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  await act(sessionId, room, one, { type: "floor_ask" });
  await act(sessionId, room, one, { type: "floor_ask" });   // an impatient second tap
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, teacher, { type: "floor_spotlight", userId: oneId });
  // The log is written fire-and-forget; give it a moment to land.
  await new Promise((r) => setTimeout(r, 250));

  const asks = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.ask'`));
  check("a raised hand is written down, so 'I asked and was ignored' has an answer", asks === 1, String(asks));
  check("but not once per impatient tap", asks === 1, String(asks));

  const allows = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.allow'`));
  check("and so is the teacher's decision", allows === 1, String(allows));

  const spotlights = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.spotlight'`));
  check("a layout change is not an event anybody argues about later", spotlights === 0, String(spotlights));

  const who = sql(`select user_id from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.allow' limit 1`);
  check("the record names who decided", Number(who) === teacherId, who);
}

/* --- 14. a provider that cannot enforce it ------------------------------- */

{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  const was = process.env.VIDEO_PROVIDER;
  process.env.VIDEO_PROVIDER = "daily";
  const m = mark();
  await act(sessionId, room, one, { type: "floor_ask" });
  check("on a provider that cannot decide who publishes, the floor says so plainly",
    one.refusal()?.code === "not-supported", JSON.stringify(one.refusal()));
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  check("for the teacher too", teacher.refusal()?.code === "not-supported", JSON.stringify(teacher.refusal()));
  check("and nothing is attempted against it", since(m).length === 0, since(m).map((c) => c.method).join(","));
  process.env.VIDEO_PROVIDER = was;
}

/* --- 15. rubbish on the wire --------------------------------------------- */

{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  const m = mark();
  await act(sessionId, room, teacher, { type: "floor_mute" });
  check("a teacher action naming nobody is refused", teacher.refusal()?.code === "bad-user");
  await act(sessionId, room, teacher, { type: "floor_mute", userId: "11" });
  check("a user id sent as a string is not a user id", teacher.refusal()?.code === "bad-user");
  await act(sessionId, room, one, { type: "floor_accept", scope: "everything" });
  check("a scope the classroom does not have is refused", one.refusal()?.code === "bad-scope");
  await act(sessionId, room, one, { type: "floor_teleport" });
  check("an action this build does not know is refused rather than ignored",
    one.refusal()?.code === "unknown-action");
  check("and none of it touched the provider", since(m).length === 0, since(m).map((c) => c.method).join(","));

  // A board message must still reach the board, untouched.
  const before = one.inbox.length;
  await act(sessionId, room, one, { type: "chat", text: "hello" });
  check("a message outside the floor namespace is left alone", one.inbox.length === before);
}

/* --- 16. starting a class keeps the lobby, named ------------------------- */

/*
  Codex's first finding.

  Doors open ten minutes before the booked start, so a teacher presses start into a room that
  already has people in it. Clearing the floor and telling everybody — without rebuilding it — left
  the teacher with an empty participant list at the exact moment their class began.
*/
{
  const { sessionId, teacherId, oneId, twoId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");

  // Nobody has raised a hand or done anything at all. This is a lobby.
  restartFloorFor(String(sessionId), room);
  floorModule.tellEveryone(String(sessionId), room);
  await settle();

  const roster = teacher.floor()?.students ?? [];
  check("both lobby students survive the class starting", roster.length === 2, JSON.stringify(roster.length));
  check("and keep the names the database gave them",
    roster.map((r) => r.name).sort().join(",") === "Ram Bahadur,Sita Sharma",
    roster.map((r) => r.name).join(","));
  check("nobody is granted anything by the class starting",
    roster.every((r) => !r.allowedMic && !r.allowedCamera && r.state === "audience"),
    JSON.stringify(roster));
  check("and everybody is shown as connected", roster.every((r) => r.connected));

  // The two whole-class controls, with no student having acted first.
  let m = mark();
  await act(sessionId, room, teacher, { type: "floor_invite_all" });
  const invited = since(m).filter((c) => c.method === "UpdateParticipant");
  check("Invite all reaches every student in the lobby", invited.length === 2,
    invited.map((c) => c.body.identity).join(","));
  check("and names them individually", invited.map((c) => c.body.identity).sort().join(",") ===
    [oneId, twoId].map(String).sort().join(","), invited.map((c) => c.body.identity).join(","));

  m = mark();
  await act(sessionId, room, teacher, { type: "floor_mute_all" });
  const muted = since(m).filter((c) => c.method === "UpdateParticipant");
  check("Mute all reaches every student it just invited", muted.length === 2,
    muted.map((c) => c.body.identity).join(","));

  check("a student's own screen survives it too", one.floor()?.scope === "student");
  forgetFloor(String(sessionId));
}

{
  // The other half of the same rule: a class *ending* clears and rebuilds nothing.
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  endFloorFor(String(sessionId));
  check("a class that ends leaves no roster behind",
    (peekFloor(String(sessionId))?.students.size ?? -1) === 0,
    String(peekFloor(String(sessionId))?.students.size));
  forgetFloor(String(sessionId));
}

/* --- 17. the provider is not believed until it answers ------------------- */

/*
  Codex's second finding. `pushRights`/`silenceThem` threw their promises away, so a permission
  LiveKit had refused was drawn as granted and a mute it never received was drawn as done.
*/
{
  const { sessionId, teacherId, oneId, twoId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");

  const rowFor = (id) => teacher.floor()?.students.find((r) => r.userId === id);

  // A provider that is simply down.
  behaviour.set(String(oneId), "fail");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  check("a grant the provider refused is not reported as applied",
    rowFor(oneId)?.provider !== "ok", JSON.stringify(rowFor(oneId)));
  check("the student is told the same thing, not that they may speak",
    one.floor()?.you.provider !== "ok", JSON.stringify(one.floor()?.you));

  // And it retries rather than giving up on the first answer.
  const before = attempts.filter((a) => a.who === String(oneId)).length;
  await new Promise((r) => setTimeout(r, 1400));
  const after = attempts.filter((a) => a.who === String(oneId)).length;
  check("and it is retried rather than abandoned after one attempt", after > before, `${before} -> ${after}`);

  // When the provider comes back, the retry lands and the class is told without anybody acting.
  behaviour.set(String(oneId), "ok");
  await new Promise((r) => setTimeout(r, 2600));
  check("once the provider recovers, the row clears itself",
    rowFor(oneId)?.provider === "ok", JSON.stringify(rowFor(oneId)));
  check("and the student is told, without having pressed anything",
    one.floor()?.you.provider === "ok", JSON.stringify(one.floor()?.you));

  // Partial failure: one student lands, the other does not.
  behaviour.set(String(twoId), "fail");
  await act(sessionId, room, teacher, { type: "floor_invite_all" });
  await settle();
  check("a partial failure marks only the student it failed for",
    rowFor(twoId)?.provider !== "ok" && rowFor(oneId)?.provider === "ok",
    JSON.stringify([rowFor(oneId)?.provider, rowFor(twoId)?.provider]));
  behaviour.delete(String(twoId));
  forgetFloor(String(sessionId));
}

{
  /*
    Absent, and which way the instruction points decides what it means.

    An earlier version of this suite asserted that an absent participant was accepted for *any*
    instruction, which is Codex's fifth finding written down as a passing test. A revocation of
    somebody who is not in the room is genuinely complete — nobody by that identity can publish
    anything, and if they arrive they arrive on a token that permits nothing. A grant is the
    opposite: the student's token still permits nothing, and unless something pushes it again they
    sit there unable to speak while their screen says they may.
  */
  const { sessionId, teacherId, oneId, twoId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const two = person(twoId, false, "Ram Bahadur");
  const room = makeRoom([teacher, one, two]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await floorJoin(String(sessionId), room, two, "Ram Bahadur");
  const rowFor = (id) => teacher.floor()?.students.find((r) => r.userId === id);

  behaviour.set(String(oneId), "absent");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  check("a grant to somebody the SFU has never seen is not reported as applied",
    rowFor(oneId)?.provider !== "ok", JSON.stringify(rowFor(oneId)));
  check("and the student is not told they may speak either",
    one.floor()?.you.provider !== "ok", JSON.stringify(one.floor()?.you));
  check("the floor keeps the decision, so it is theirs the moment their video arrives",
    rowFor(oneId)?.allowedMic === true, JSON.stringify(rowFor(oneId)));

  // The other direction, on a student who is in the room and then is not.
  await act(sessionId, room, teacher, { type: "floor_allow", userId: twoId, scope: "mic" });
  behaviour.set(String(twoId), "absent");
  await act(sessionId, room, teacher, { type: "floor_return_audience", userId: twoId });
  check("taking a turn back from somebody who has left is finished, not left hanging",
    rowFor(twoId)?.provider === "ok", JSON.stringify(rowFor(twoId)));

  behaviour.delete(String(oneId));
  behaviour.delete(String(twoId));
  forgetFloor(String(sessionId));
}

{
  // A slow provider is pending, then fine. Nothing claims success in between.
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  behaviour.set(String(oneId), "slow");
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await new Promise((r) => setTimeout(r, 120));
  check("a slow acknowledgement reads as pending, never as done",
    one.floor()?.you.provider !== "ok", JSON.stringify(one.floor()?.you));
  await new Promise((r) => setTimeout(r, 1200));
  check("and settles once the provider answers", one.floor()?.you.provider === "ok",
    JSON.stringify(one.floor()?.you));
  behaviour.delete(String(oneId));
  forgetFloor(String(sessionId));
}

{
  // Revocation fails closed: a mute the provider refused leaves the row visibly unresolved.
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });

  behaviour.set(String(oneId), "fail");
  await act(sessionId, room, teacher, { type: "floor_mute", userId: oneId });
  const row = teacher.floor()?.students.find((r) => r.userId === oneId);
  check("a mute the provider refused is not shown to the teacher as finished",
    row?.provider !== "ok", JSON.stringify(row));
  check("the floor still records the decision, so nothing new can be granted on top of it",
    row?.state === "muted-by-teacher", JSON.stringify(row));
  behaviour.delete(String(oneId));
  forgetFloor(String(sessionId));
}

/* --- 18. floor time is not speaking time -------------------------------- */

/*
  Codex's third finding. The stopwatch is permission plus consent — it observes no audio at all —
  so it must not be named or summarised as speech, and it must not run at all on a grant the SFU
  never accepted.
*/
{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });
  await new Promise((r) => setTimeout(r, 1200));
  await act(sessionId, room, one, { type: "floor_listen_only" });
  await new Promise((r) => setTimeout(r, 300));

  const spoke = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.spoke'`));
  check("nothing claims the student spoke", spoke === 0, String(spoke));

  const held = sql(`select detail::text from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.held' limit 1`);
  check("what is recorded is floor time", held.length > 0, held);
  check("and it says on its face that no speech was confirmed",
    held.includes('"speechConfirmed": false') || held.includes('"speechConfirmed":false'), held);
  check("and where the number came from", held.includes("permission_and_consent"), held);
  forgetFloor(String(sessionId));
}

{
  // The stopwatch must not run on a grant the provider never accepted.
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  behaviour.set(String(oneId), "fail");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });
  await new Promise((r) => setTimeout(r, 1500));
  await act(sessionId, room, one, { type: "floor_listen_only" });
  await new Promise((r) => setTimeout(r, 300));

  const held = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.held'`));
  check("no floor time is recorded for a microphone the provider never opened", held === 0, String(held));
  behaviour.delete(String(oneId));
  forgetFloor(String(sessionId));
}

/* --- 19. a grant waits for the media connection, and finishes when it comes -- */

/*
  Codex's fifth finding, in the ordering it actually happens in.

  The classroom WebSocket and the LiveKit media connection are separate connections and the first
  comes up before the second. A teacher who grants the floor in that gap is granting it to somebody
  the SFU has never heard of — and the student's token permits publishing nothing, so unless the
  server pushes again when their video arrives, they sit there unable to speak while their screen
  says they may.

  The required ordering, and every step is real rather than simulated: classroom socket connected,
  teacher grants, provider answers absent, media participant appears, permission becomes applied —
  with no second raised hand, no classroom reconnect and no further action by the teacher.
*/
{
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  const rowFor = (id) => teacher.floor()?.students.find((r) => r.userId === id);

  // Their media is not there yet. This is the ordinary case, not a fault.
  behaviour.set(String(oneId), "absent");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  check("the grant is outstanding while the student's video is missing",
    rowFor(oneId)?.provider === "pending", JSON.stringify(rowFor(oneId)));
  check("and their own screen says so rather than offering an unmute",
    one.floor()?.you.provider === "pending", JSON.stringify(one.floor()?.you));

  // Their video connects. The client says so; it says nothing else, and asks for nothing.
  const beforeReady = attempts.filter((a) => a.who === String(oneId)).length;
  behaviour.delete(String(oneId));
  await act(sessionId, room, one, { type: "floor_media_ready" });
  await settle();

  check("the media-ready signal makes the server try again",
    attempts.filter((a) => a.who === String(oneId)).length > beforeReady,
    `${beforeReady} -> ${attempts.filter((a) => a.who === String(oneId)).length}`);
  check("and the grant lands, with nobody having asked for anything twice",
    rowFor(oneId)?.provider === "ok", JSON.stringify(rowFor(oneId)));
  check("the student is told, without raising their hand again",
    one.floor()?.you.provider === "ok" && one.floor()?.you.allowedMic === true,
    JSON.stringify(one.floor()?.you));

  // What actually reached the provider is the grant the teacher made, not something the client said.
  const lastPush = [...calls].reverse().find(
    (c) => c.method === "UpdateParticipant" && c.body.identity === String(oneId),
  );
  check("what was pushed is the floor's own decision",
    lastPush?.body.permission?.canPublish === true &&
      (lastPush?.body.permission?.canPublishSources ?? []).includes("MICROPHONE"),
    JSON.stringify(lastPush?.body.permission));
  forgetFloor(String(sessionId));
}

{
  /*
    The same frame, from somebody with nothing outstanding, and from somebody sending it in a loop.

    It carries no identity and no rights, so the worst it can be is work. Bounded: a minimum gap
    between accepted nudges means a client that sends a hundred causes at most one provider call.
  */
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  const quiet = mark();
  for (let i = 0; i < 20; i += 1) {
    await handleFloorFrame(String(sessionId), room, one, { type: "floor_media_ready" });
  }
  await settle();
  check("a student with nothing outstanding causes no provider traffic at all",
    since(quiet).length === 0, JSON.stringify(since(quiet).map((c) => c.method)));
  check("and is never refused for it — it is not a request",
    one.refusal() === null, JSON.stringify(one.refusal()));

  behaviour.set(String(oneId), "absent");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await new Promise((r) => setTimeout(r, 1200));
  const spammed = attempts.filter((a) => a.who === String(oneId)).length;
  for (let i = 0; i < 50; i += 1) {
    await handleFloorFrame(String(sessionId), room, one, { type: "floor_media_ready" });
  }
  await settle();
  const after = attempts.filter((a) => a.who === String(oneId)).length;
  check("fifty in a row buy at most one extra attempt", after - spammed <= 1, `${spammed} -> ${after}`);

  behaviour.delete(String(oneId));
  forgetFloor(String(sessionId));
}

{
  // The teacher's own client sending it changes nothing: they have no floor row to reconcile.
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");

  behaviour.set(String(oneId), "absent");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  const quiet = mark();
  behaviour.delete(String(oneId));
  await act(sessionId, room, teacher, { type: "floor_media_ready" });
  check("a teacher's media-ready does not finish a student's grant for them",
    since(quiet).length === 0, JSON.stringify(since(quiet).map((c) => c.method)));
  const row = teacher.floor()?.students.find((r) => r.userId === oneId);
  check("and the student's grant is still honestly outstanding",
    row?.provider === "pending", JSON.stringify(row));
  forgetFloor(String(sessionId));
}

/* --- 20. two decisions in flight, and only one write at a time ------------ */

/*
  Codex's sixth finding, and the reason it is not fixed with a request id.

  Discarding a stale *answer* does nothing about a stale *write*: by the time the answer comes back
  to be discarded, the instruction has already reached the SFU. So there is never more than one
  write per participant in flight. Every floor change moves that participant's revision; one loop
  reads it, asks the provider for exactly that, and on returning checks whether the floor moved —
  in which case it throws its own answer away and reconciles the newest state instead.

  These tests hold the provider's reply open by hand, so the ordering is decided here rather than by
  a timeout that happens to be long enough on this machine.
*/
{
  // Grant, then revoke while the grant's call is still open.
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  const rowFor = () => teacher.floor()?.students.find((r) => r.userId === oneId);
  const pushes = () => calls.filter(
    (c) => c.method === "UpdateParticipant" && c.body.identity === String(oneId),
  );

  behaviour.set(String(oneId), "hold");
  const start = pushes().length;
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  const first = (await heldRequests(oneId, 1))[0];
  check("the grant reaches the provider", first?.method === "UpdateParticipant", first?.method ?? "none");

  // The teacher changes their mind before the provider has answered.
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_return_audience", userId: oneId });
  await settle();
  check("the second decision does not start a second write while the first is open",
    pushes().length === start + 1, `${pushes().length - start} writes`);
  check("and nothing reads as in step while a decision is unconfirmed",
    rowFor()?.provider !== "ok", JSON.stringify(rowFor()));

  // The stale answer arrives. It must not be able to mark the newer decision as done.
  await release(first);
  check("the older answer does not confirm the newer decision",
    rowFor()?.provider !== "ok", JSON.stringify(rowFor()));

  // What the server writes next is the revocation, derived from the floor as it now stands —
  // never a replay of the grant it was in the middle of.
  const second = (await heldRequests(oneId, 2))[1];
  check("the next write is the newest decision", second?.method === "UpdateParticipant", second?.method ?? "none");
  check("and it revokes rather than grants",
    second?.body?.permission?.canPublish !== true, JSON.stringify(second?.body?.permission));

  behaviour.delete(String(oneId));
  await release(second);
  check("once the newest decision is confirmed, and only then, the row reads as in step",
    rowFor()?.provider === "ok", JSON.stringify(rowFor()));
  check("the provider's final recorded rights match the latest floor state",
    pushes().at(-1)?.body?.permission?.canPublish !== true,
    JSON.stringify(pushes().at(-1)?.body?.permission));
  check("two decisions produced exactly two writes, in order",
    pushes().length === start + 2, `${pushes().length - start} writes`);
  forgetFloor(String(sessionId));
}

{
  /*
    The other order, and the cross-kind case: a mute whose stop is still open, then a fresh grant.

    An old `silence` must not be able to defeat a newer grant — silencing somebody the teacher has
    just allowed to speak would undo the grant a moment after making it.
  */
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await act(sessionId, room, one, { type: "floor_accept", scope: "mic" });
  const rowFor = () => teacher.floor()?.students.find((r) => r.userId === oneId);

  behaviour.set(String(oneId), "hold");
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_mute", userId: oneId });
  const revoke = (await heldRequests(oneId, 1))[0];
  check("a mute revokes the permission first", revoke?.method === "UpdateParticipant", revoke?.method ?? "none");
  check("and the revocation is what was sent, not a grant",
    revoke?.body?.permission?.canPublish !== true, JSON.stringify(revoke?.body?.permission));

  // The teacher lets them speak again before the mute has finished landing.
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  await settle();
  const mark20 = calls.length;
  await release(revoke);

  const next = (await heldRequests(oneId, 2))[1];
  check("the write that follows is the newer grant", next?.method === "UpdateParticipant", next?.method ?? "none");
  check("and it grants the microphone", next?.body?.permission?.canPublish === true,
    JSON.stringify(next?.body?.permission));

  behaviour.delete(String(oneId));
  await release(next);
  await settle();
  const afterGrant = calls.slice(mark20).filter(
    (c) => c.method === "MutePublishedTrack" && c.body.identity === String(oneId),
  );
  check("the outstanding stop does not follow the grant and silence them again",
    afterGrant.length === 0, JSON.stringify(afterGrant.map((c) => c.body.track_sid ?? c.body.trackSid)));
  check("and the row reads as in step on the newest decision",
    rowFor()?.provider === "ok" && rowFor()?.allowedMic === true, JSON.stringify(rowFor()));
  forgetFloor(String(sessionId));
}

{
  /*
    An old retry firing after a newer decision.

    The failure is real — the provider is down — so the loop backs off and is due to try again. The
    teacher acts during the backoff. What must never happen is the retry re-applying the authority
    the teacher has just taken back.
  */
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  const rowFor = () => teacher.floor()?.students.find((r) => r.userId === oneId);
  const pushes = () => calls.filter(
    (c) => c.method === "UpdateParticipant" && c.body.identity === String(oneId),
  );

  behaviour.set(String(oneId), "fail");
  await act(sessionId, room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  check("the failed grant is not reported as applied", rowFor()?.provider !== "ok", JSON.stringify(rowFor()));

  // Mid-backoff, the teacher takes the turn back. The provider recovers at the same moment.
  behaviour.delete(String(oneId));
  const before = pushes().length;
  await act(sessionId, room, teacher, { type: "floor_return_audience", userId: oneId });
  await new Promise((r) => setTimeout(r, 1600));

  const written = pushes().slice(before);
  check("every write after the newer decision revokes",
    written.length > 0 && written.every((c) => c.body?.permission?.canPublish !== true),
    JSON.stringify(written.map((c) => c.body?.permission?.canPublish)));
  check("no stale retry restores the permission the teacher took back",
    rowFor()?.allowedMic === false && rowFor()?.provider === "ok", JSON.stringify(rowFor()));
  check("and the student is not left believing they may speak",
    one.floor()?.you.allowedMic === false, JSON.stringify(one.floor()?.you));
  forgetFloor(String(sessionId));
}

{
  /*
    Coalescing. Four decisions inside one open call produce one further write, of the last of them.

    Not an optimisation for its own sake: every intermediate write is a moment where the SFU holds
    something nobody decided, and skipping them is what makes "the provider's final state matches
    the latest floor state" true by construction rather than by luck.
  */
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  const pushes = () => calls.filter(
    (c) => c.method === "UpdateParticipant" && c.body.identity === String(oneId),
  );

  behaviour.set(String(oneId), "hold");
  const start = pushes().length;
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  const first = (await heldRequests(oneId, 1))[0];

  for (const frame of [
    { type: "floor_return_audience", userId: oneId },
    { type: "floor_allow", userId: oneId, scope: "mic+camera" },
    { type: "floor_return_audience", userId: oneId },
    { type: "floor_allow", userId: oneId, scope: "mic" },
  ]) {
    await handleFloorFrame(String(sessionId), room, teacher, frame);
  }
  await settle();
  check("four more decisions start no further writes while one is open",
    pushes().length === start + 1, `${pushes().length - start}`);

  behaviour.delete(String(oneId));
  await release(first);
  await settle();
  check("releasing it produces exactly one more write, not four",
    pushes().length === start + 2, `${pushes().length - start}`);
  const last = pushes().at(-1)?.body?.permission;
  check("and that write is the last decision, microphone only",
    last?.canPublish === true &&
      (last?.canPublishSources ?? []).includes("MICROPHONE") &&
      !(last?.canPublishSources ?? []).includes("CAMERA"),
    JSON.stringify(last));
  const row = teacher.floor()?.students.find((r) => r.userId === oneId);
  check("the row reads as in step only once that write is confirmed",
    row?.provider === "ok", JSON.stringify(row));
  forgetFloor(String(sessionId));
}

{
  /*
    The lesson ends while a write is still open.

    `restartFloorFor` and `endFloorFor` keep the same room object and clear its records, so a loop
    in flight cannot notice by looking for its room. It notices by finding that the record it holds
    is no longer the one the room has — and stops, rather than reconciling a floor that has been
    wiped or writing its answer into an object nothing reads any more.
  */
  const { sessionId, teacherId, oneId } = makeMonthlyClass();
  const teacher = person(teacherId, true, "Floor Teacher");
  const one = person(oneId, false, "Sita Sharma");
  const room = makeRoom([teacher, one]);
  await floorJoin(String(sessionId), room, teacher, "Floor Teacher");
  await floorJoin(String(sessionId), room, one, "Sita Sharma");
  const pushes = () => calls.filter(
    (c) => c.method === "UpdateParticipant" && c.body.identity === String(oneId),
  );

  behaviour.set(String(oneId), "hold");
  await handleFloorFrame(String(sessionId), room, teacher, { type: "floor_allow", userId: oneId, scope: "mic" });
  const open = (await heldRequests(oneId, 1))[0];
  const before = pushes().length;

  endFloorFor(String(sessionId));
  behaviour.delete(String(oneId));
  await release(open);
  await new Promise((r) => setTimeout(r, 1400));

  check("a class that ended stops its own reconciliation rather than carrying on",
    pushes().length === before, `${pushes().length - before} further writes`);
  /*
    Read from the server's own state rather than from the teacher's inbox.

    `endFloorFor` clears the floor and does not broadcast — the hub tells the room the class is over
    by its own route — so the last `floor_state` the teacher holds predates the wipe. Asserting on
    that would have been asserting about a message, not about the floor.
  */
  check("and the floor itself is left with nothing half-finished on it",
    (peekFloor(String(sessionId))?.students.size ?? -1) === 0,
    String(peekFloor(String(sessionId))?.students.size));
  forgetFloor(String(sessionId));
}

/* ------------------------------------------------------------------------- */

fake.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
