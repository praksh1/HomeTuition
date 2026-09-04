/**
 * Swapping the video provider, against the real server.
 *
 * Daily.co is very unlikely to survive the monthly tier — forty-five people in a daily
 * ninety-minute call is around a hundred thousand participant-minutes a month per teacher,
 * against a NPR 6,500 subscription — so replacing it is decided future work and the seam went
 * in before anything was built on top of it.
 *
 * This proves the seam rather than asserting it: the same server is started twice, once on
 * Daily and once on a provider that has never heard of Daily, and every rule around the room —
 * who may have one, when the door opens, who gets moderator rights — has to behave identically.
 *
 * Usage: node scripts/video-tests/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

function startServer(port, provider) {
  const proc = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "video-test-secret",
      VIDEO_PROVIDER: provider,
    },
    stdio: "ignore",
  });
  return proc;
}

async function waitFor(port) {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function makeApi(port) {
  return async function api(p, { method = "GET", token, body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}/api${p}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  };
}

let seq = 0;
async function register(api, role, name) {
  seq += 1;
  const email = `vid_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return { ...res.body, email };
}

async function run() {
  const PORT = Number(process.env.VIDEO_TEST_PORT ?? 8097);
  const server = startServer(PORT, "echo");
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch { /* gone */ } });

  if (!(await waitFor(PORT))) throw new Error("the server never came up");
  const api = makeApi(PORT);

  console.log("\nA class runs on a provider that has never heard of Daily\n");

  const teacher = await register(api, "teacher", "Ram Prasad");
  const student = await register(api, "student", "Sita Sharma");
  const outsider = await register(api, "student", "Nobody Special");

  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Provider swap", subject: "Maths", description: "d",
    date: new Date(Date.now() + 60_000).toISOString(),
    duration: 60, price: 500, maxStudents: 10 } });
  check("a class can be created", created.status <= 201, `status=${created.status}`);
  const sessionId = created.body.id;

  await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  const forTeacher = await api(`/sessions/${sessionId}/room`, { token: teacher.token });
  check("the teacher gets a room", forTeacher.status === 200, `status=${forTeacher.status} ${JSON.stringify(forTeacher.body)}`);
  check("named for the provider actually carrying it", forTeacher.body?.provider === "echo",
    JSON.stringify(forTeacher.body?.provider));
  check("with somewhere to join", typeof forTeacher.body?.roomUrl === "string" && forTeacher.body.roomUrl.length > 0,
    JSON.stringify(forTeacher.body?.roomUrl));
  check("and a token", typeof forTeacher.body?.token === "string" && forTeacher.body.token.length > 0);

  /**
   * The rule that matters most: moderator rights come from the server's own membership check,
   * never from the client and never from the provider. A swap must not quietly hand every
   * student the teacher's powers.
   */
  check("the teacher is the owner", forTeacher.body?.isOwner === true);
  check("and their token says so", /owner/.test(String(forTeacher.body?.token)), String(forTeacher.body?.token));

  const forStudent = await api(`/sessions/${sessionId}/room`, { token: student.token });
  check("a paid student gets a room too", forStudent.status === 200, `status=${forStudent.status}`);
  check("but is not the owner", forStudent.body?.isOwner === false);
  check("and their token says guest", /guest/.test(String(forStudent.body?.token)), String(forStudent.body?.token));

  const forOutsider = await api(`/sessions/${sessionId}/room`, { token: outsider.token });
  check("somebody who never booked still gets no room at all", forOutsider.status === 403,
    `status=${forOutsider.status}`);
  const anon = await api(`/sessions/${sessionId}/room`);
  check("nor does somebody signed out", anon.status === 401, `status=${anon.status}`);

  /** The app is told what the provider can do, rather than guessing. */
  check("the provider's abilities come with the room",
    forTeacher.body?.capabilities?.screenShare === false, JSON.stringify(forTeacher.body?.capabilities));

  /**
   * A provider with no idea who anybody is says so, rather than inventing a name.
   *
   * `identity` was added to the room grant when Stream arrived — every candidate that mints its
   * own token binds it to one — and it is optional precisely so a provider without identities is
   * not made to pretend. Echo has none; nor does Daily.
   */
  check("a provider without identities returns none", forTeacher.body?.identity === null,
    JSON.stringify(forTeacher.body?.identity));

  console.log("\nThe timing rules are untouched by the swap\n");

  {
    const over = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "Long over", subject: "Maths", description: "d",
      date: new Date(Date.now() + 3600_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    sql(`update sessions set date = now() - interval '3 days' where id = ${over.body.id}`);
    const room = await api(`/sessions/${over.body.id}/room`, { token: teacher.token });
    check("a class that is long over gets no room, whoever the provider is",
      room.status === 409, `status=${room.status}`);
  }

  try { server.kill("SIGKILL"); } catch { /* gone */ }

  console.log("\nAnd the same server on Daily still says Daily\n");

  {
    const dailyPort = PORT + 1;
    const dailyServer = startServer(dailyPort, "daily");
    process.on("exit", () => { try { dailyServer.kill("SIGKILL"); } catch { /* gone */ } });
    if (!(await waitFor(dailyPort))) throw new Error("the Daily server never came up");
    const dailyApi = makeApi(dailyPort);

    const t2 = await register(dailyApi, "teacher", "Second Teacher");
    const s2 = await dailyApi("/sessions", { method: "POST", token: t2.token, body: {
      topic: "Still Daily", subject: "Maths", description: "d",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    await dailyApi(`/sessions/${s2.body.id}`, { method: "PATCH", token: t2.token, body: { status: "live" } });
    const room = await dailyApi(`/sessions/${s2.body.id}/room`, { token: t2.token });

    /**
     * Without a Daily API key this cannot mint a room, and that is the honest outcome — a 502,
     * not a pretend room. What matters here is that nothing fell back to `echo` behind our
     * backs: the provider is chosen by configuration, not by what happens to work.
     */
    if (room.status === 200) {
      check("on Daily, the room says daily", room.body?.provider === "daily", JSON.stringify(room.body?.provider));
      check("and Daily can share a screen", room.body?.capabilities?.screenShare === true);
    } else {
      check("with no Daily key it fails honestly rather than silently using another provider",
        room.status === 502, `status=${room.status} ${JSON.stringify(room.body)}`);
    }
    try { dailyServer.kill("SIGKILL"); } catch { /* gone */ }
  }

  /**
   * The Stream experiment, with nothing configured — which is how it stands today.
   *
   * Two things are being proved and they matter in opposite directions. First, that selecting an
   * unconfigured provider **fails closed**: no room, no token, and an error rather than a
   * plausible-looking address that would become a black rectangle on somebody's phone. Second,
   * that the checks in front of the provider still run *first* — an outsider is refused for not
   * being in the class, not because the video happens to be broken. If those two ever swapped
   * over, an unconfigured provider would look like an access control and a configured one would
   * quietly stop being one.
   *
   * Nothing here reaches Stream. There are no credentials to reach it with, which is the point.
   */
  console.log("\nAn unconfigured provider refuses, and the door is still locked in front of it\n");

  {
    const streamPort = PORT + 2;
    const streamServer = startServer(streamPort, "stream");
    process.on("exit", () => { try { streamServer.kill("SIGKILL"); } catch { /* gone */ } });
    if (!(await waitFor(streamPort))) throw new Error("the stream server never came up");
    const streamApi = makeApi(streamPort);

    const t3 = await register(streamApi, "teacher", "Third Teacher");
    const s3 = await register(streamApi, "student", "Third Student");
    const outsider3 = await register(streamApi, "student", "Still Nobody");

    const created3 = await streamApi("/sessions", { method: "POST", token: t3.token, body: {
      topic: "Stream experiment", subject: "Maths", description: "d",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    const sid = created3.body.id;
    await streamApi(`/sessions/${sid}/book`, { method: "POST", token: s3.token, body: { paymentMethod: "esewa" } });
    await streamApi(`/sessions/${sid}`, { method: "PATCH", token: t3.token, body: { status: "live" } });

    const room = await streamApi(`/sessions/${sid}/room`, { token: t3.token });
    check("with no Stream credentials the teacher gets no room at all",
      room.status === 502, `status=${room.status} ${JSON.stringify(room.body)}`);
    check("and no pretend address to join", !room.body?.roomUrl, JSON.stringify(room.body?.roomUrl));
    check("and no token", !room.body?.token, JSON.stringify(room.body?.token));

    const paid = await streamApi(`/sessions/${sid}/room`, { token: s3.token });
    check("a paid student gets the same honest refusal", paid.status === 502, `status=${paid.status}`);

    /**
     * The order these two are answered in is the whole point.
     *
     * 403 rather than 502 means the membership check ran before the provider was ever consulted
     * — so the class's door does not depend on which company is carrying the video, and an
     * outsider is refused for the right reason.
     */
    const outside = await streamApi(`/sessions/${sid}/room`, { token: outsider3.token });
    check("somebody who never booked is refused for not being in the class, not for the video",
      outside.status === 403, `status=${outside.status}`);
    const anon3 = await streamApi(`/sessions/${sid}/room`);
    check("and somebody signed out is refused before anything else", anon3.status === 401,
      `status=${anon3.status}`);

    const over = await streamApi("/sessions", { method: "POST", token: t3.token, body: {
      topic: "Over on stream", subject: "Maths", description: "d",
      date: new Date(Date.now() + 3600_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    sql(`update sessions set date = now() - interval '3 days' where id = ${over.body.id}`);
    const late = await streamApi(`/sessions/${over.body.id}/room`, { token: t3.token });
    check("a class that is long over is still refused on its own terms, not the provider's",
      late.status === 409, `status=${late.status}`);

    try { streamServer.kill("SIGKILL"); } catch { /* gone */ }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
