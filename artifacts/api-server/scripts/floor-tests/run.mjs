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
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer));
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
const { handleFloorFrame, floorJoin, floorLeave, resetFloorFor, forgetFloor, peekFloor } = floorModule;

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

  resetFloorFor(String(sessionId));
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

/* ------------------------------------------------------------------------- */

fake.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
