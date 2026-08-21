/**
 * When a class may be started, and when a force-closed one stops blocking the next.
 *
 * Both reported from a real session, and both were possible:
 *
 *   "A teacher could go back to past calls and start them ... It is a HARD NO."
 *   "started another session but could not join because it says You still have an active
 *    session. There was no way going back to the active session either!"
 *
 * These drive the real API against a real database, because both rules are about rows and
 * sockets rather than arithmetic — the arithmetic itself is covered in src/lib/sessionStart.test.ts.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/session-tests/run.mjs
 * Needs PGURL to age rows past the windows without waiting hours.
 */
import { WebSocket } from "ws";
import { execFileSync } from "node:child_process";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function sql(statement) {
  return execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" }).trim();
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role} ${seq}`, email: `st_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createSession(teacher, { minutesFromNow = 5, duration = 60 } = {}) {
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Class ${++seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    duration, price: 500, maxStudents: 10 } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const goLive = (teacher, id) => api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
const endClass = (teacher, id) => api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "completed" } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function classroomSocket(token, sessionId, name) {
  const ws = new WebSocket(`${WS}/api/ws?sessionId=${sessionId}&token=${encodeURIComponent(token)}&name=${name}`);
  ws.on("error", () => {});
  return { ws, open: () => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); }) };
}

async function testCannotStartAnOldClass() {
  console.log("\nA class that is over stays over");
  const teacher = await register("teacher");

  const fresh = await createSession(teacher);
  check("a class scheduled for shortly can be started", (await goLive(teacher, fresh.id)).status === 200);
  await endClass(teacher, fresh.id);

  // Ended a moment ago: the teacher may have hung up by accident.
  const again = await goLive(teacher, fresh.id);
  check("a class just ended can be restarted", again.status === 200, `status ${again.status}`);
  await endClass(teacher, fresh.id);

  // Aged past the window, the way a class from this morning would be.
  sql(`update session_activity set ended_at = now() - interval '4 hours' where session_id = ${fresh.id}`);
  const stale = await goLive(teacher, fresh.id);
  check("a class that ended four hours ago cannot be restarted", stale.status === 409, `status ${stale.status}`);
  check("and the teacher is told why", /no longer be started/i.test(stale.body?.error ?? ""), stale.body?.error ?? "");

  // The reported case: scrolling back to a class from days ago and starting it.
  const old = await createSession(teacher, { minutesFromNow: -60 * 30 });
  const started = await goLive(teacher, old.id);
  check("a class from days ago cannot be started at all", started.status === 409, `status ${started.status}`);

  // And an old class refused must not have been left live.
  const status = sql(`select status from sessions where id = ${old.id}`);
  check("refusing it leaves it alone rather than half-started", status !== "live", `status in db: ${status}`);
}

async function testForceCloseDoesNotBlockTheNextClass() {
  console.log("\nA force-closed class does not block the next one");
  const teacher = await register("teacher");

  const first = await createSession(teacher);
  check("the first class starts", (await goLive(teacher, first.id)).status === 200);

  const socket = classroomSocket(teacher.token, first.id, "T");
  await socket.open();
  await wait(600);
  const seen = sql(`select count(*) from session_activity where session_id = ${first.id} and teacher_last_seen_at is not null`);
  check("the teacher being in the room is recorded", seen === "1", `rows: ${seen}`);

  // While the teacher is really there, a second class is still refused — that rule stays.
  const second = await createSession(teacher);
  const blocked = await goLive(teacher, second.id);
  check("a second class is refused while the first is genuinely running", blocked.status === 409, `status ${blocked.status}`);
  check("and the running class is named so the app can offer it", Boolean(blocked.body?.liveSessionId), JSON.stringify(blocked.body));

  // Force-close: the socket dies and nothing comes back.
  socket.ws.terminate();
  sql(`update session_activity set teacher_last_seen_at = now() - interval '5 minutes' where session_id = ${first.id}`);
  sql(`update sessions set started_at = now() - interval '5 minutes' where id = ${first.id}`);

  const afterCrash = await goLive(teacher, second.id);
  check("after a force-close the next class starts", afterCrash.status === 200, `status ${afterCrash.status} ${JSON.stringify(afterCrash.body)}`);

  const firstStatus = sql(`select status from sessions where id = ${first.id}`);
  check("the abandoned class is closed rather than left live", firstStatus === "completed", `status: ${firstStatus}`);
}

async function testTeacherCanGetBackIntoTheirClass() {
  console.log("\nA teacher can get back into the class they are still in");
  const teacher = await register("teacher");
  const first = await createSession(teacher);
  await goLive(teacher, first.id);

  const socket = classroomSocket(teacher.token, first.id, "T");
  await socket.open();
  await wait(600);

  const second = await createSession(teacher);
  const blocked = await goLive(teacher, second.id);
  check("the refusal carries the class to return to", blocked.body?.liveSessionId === first.id,
    JSON.stringify(blocked.body));
  check("and its name, so the offer can say which one", blocked.body?.liveSessionTopic === first.topic,
    JSON.stringify(blocked.body));

  // Rejoining the class they are already in must simply work.
  const rejoin = await api(`/sessions/${first.id}/room`, { token: teacher.token });
  check("rejoining the running class is allowed", rejoin.status === 200, `status ${rejoin.status}`);
  socket.ws.close();
}

async function testAStudentCannotStartAnything() {
  console.log("\nOnly the teacher decides when a class runs");
  const teacher = await register("teacher");
  const student = await register("student");
  const s = await createSession(teacher);
  await api(`/sessions/${s.id}/book`, { method: "POST", token: student.token, body: {} });
  const attempt = await api(`/sessions/${s.id}`, { method: "PATCH", token: student.token, body: { status: "live" } });
  check("a student cannot take a class live", attempt.status === 403, `status ${attempt.status}`);
}

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) { console.error(`No API at ${API}. Start it first, or set API_URL.`); process.exit(1); }

  await testCannotStartAnOldClass();
  await testForceCloseDoesNotBlockTheNextClass();
  await testTeacherCanGetBackIntoTheirClass();
  await testAStudentCannotStartAnything();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
