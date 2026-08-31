/**
 * A class's own message thread, and the log of who did what.
 *
 * Both exist for the same reason — a support agent, weeks later, needing to know what actually
 * happened — so both are tested against a real server and a real database rather than in
 * isolation. What is being checked is not the SQL but the wiring: whether a message survives a
 * restart, whether the people who should see it do and the people who should not cannot, and
 * whether the audit log records an action nobody wrote a line of code to record.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/thread-tests/run.mjs
 * RESTART_CMD restarts the API and returns once it is healthy.
 */
import { WebSocket } from "ws";
import { execFileSync, execSync } from "node:child_process";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const RESTART_CMD = process.env.RESTART_CMD;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  /**
   * One retry, for the restart in the middle of this suite.
   *
   * Node keeps connections alive and reuses them, so the first request after the server has
   * been restarted is sent down a socket the old process closed and fails before it reaches
   * anything. That is an artefact of the test restarting the server, not a fault in the
   * server, and retrying once tells the two apart: a real outage fails twice.
   */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${API}/api${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
      return { status: res.status, body: parsed };
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("unreachable");
}

let seq = 0;
async function register(role, name) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email: `th_${Date.now()}_${seq}@example.com`,
    password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return res.body;
}

async function createSession(teacher, { minutesFromNow = 5 } = {}) {
  seq += 1;
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Thread ${seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    duration: 60, price: 500, maxStudents: 10 } });
  if (res.status > 201) throw new Error(`create: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function book(student, sessionId) {
  const res = await api(`/sessions/${sessionId}/book`, {
    method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  if (res.status > 201) throw new Error(`book: ${res.status} ${JSON.stringify(res.body)}`);
}

/** The signed-in socket the app keeps open. */
function channel(token) {
  const ws = new WebSocket(`${WS}/api/ws?token=${encodeURIComponent(token)}`);
  const events = [];
  const waiters = [];
  ws.on("message", (raw) => {
    let data; try { data = JSON.parse(String(raw)); } catch { return; }
    if (data?.type !== "notification") return;
    events.push(data);
    for (const w of waiters.splice(0)) w(data);
  });
  return {
    open: () => new Promise((resolve, reject) => {
      if (ws.readyState === 1) return resolve();
      ws.once("open", resolve); ws.once("error", reject);
    }),
    next: (predicate, ms = 4000) => new Promise((resolve) => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      const timer = setTimeout(() => resolve(null), ms);
      waiters.push((e) => { if (!predicate(e)) return; clearTimeout(timer); resolve(e); });
    }),
    close: () => ws.close(),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log("\nA class has a thread everybody in it shares\n");

  const teacher = await register("teacher", "Ram Prasad");
  const alice = await register("student", "Alice Rai");
  const bob = await register("student", "Bob Thapa");
  const stranger = await register("student", "Nobody");
  const session = await createSession(teacher);
  await book(alice, session.id);
  await book(bob, session.id);

  const late = await api(`/sessions/${session.id}/messages`, { method: "POST", token: teacher.token,
    body: { body: "Running about ten minutes late, sorry — please wait in the room." } });
  check("the teacher can post to the thread", late.status === 201, `status ${late.status}`);
  check("and is badged as the teacher", late.body?.senderRole === "teacher", late.body?.senderRole);

  const reply = await api(`/sessions/${session.id}/messages`, { method: "POST", token: alice.token,
    body: { body: "No problem, I am here." } });
  check("a student who paid can reply", reply.status === 201, `status ${reply.status}`);
  check("and is badged as a student", reply.body?.senderRole === "student", reply.body?.senderRole);

  const asBob = await api(`/sessions/${session.id}/messages`, { token: bob.token });
  check("another student in the class reads both", (asBob.body?.messages ?? []).length === 2,
    `${(asBob.body?.messages ?? []).length} messages`);
  check("and neither is marked as his", (asBob.body?.messages ?? []).every((m) => m.mine === false));

  const asAlice = await api(`/sessions/${session.id}/messages`, { token: alice.token });
  check("the person who wrote one sees it as theirs",
    (asAlice.body?.messages ?? []).filter((m) => m.mine).length === 1);

  const asStranger = await api(`/sessions/${session.id}/messages`, { token: stranger.token });
  check("somebody with no place in the class cannot read it", asStranger.status === 403, `status ${asStranger.status}`);
  const strangerWrite = await api(`/sessions/${session.id}/messages`, { method: "POST", token: stranger.token,
    body: { body: "let me in" } });
  check("nor write to it", strangerWrite.status === 403, `status ${strangerWrite.status}`);

  const anonymous = await api(`/sessions/${session.id}/messages`);
  check("a signed-out request is refused", anonymous.status === 401, `status ${anonymous.status}`);

  const empty = await api(`/sessions/${session.id}/messages`, { method: "POST", token: alice.token, body: { body: "   " } });
  check("an empty message is refused", empty.status === 400, `status ${empty.status}`);
  const huge = await api(`/sessions/${session.id}/messages`, { method: "POST", token: alice.token,
    body: { body: "x".repeat(2001) } });
  check("an essay is refused rather than truncated", huge.status === 400, `status ${huge.status}`);

  console.log("\nCatching up on what you have not seen\n");

  const after = await api(`/sessions/${session.id}/messages?after=${late.body.id}`, { token: bob.token });
  check("asking for what is newer than a message returns only that",
    (after.body?.messages ?? []).length === 1 && after.body.messages[0].id === reply.body.id,
    JSON.stringify((after.body?.messages ?? []).map((m) => m.id)));

  console.log("\nIt reaches people who are looking at the app\n");

  const bobInbox = channel(bob.token);
  await bobInbox.open();
  await wait(300);
  await api(`/sessions/${session.id}/messages`, { method: "POST", token: teacher.token,
    body: { body: "Starting now." } });
  const event = await bobInbox.next((e) => e.kind === "session_message");
  check("a student in the class is told", !!event);
  check("the event names the class", event?.sessionId === session.id, `sessionId=${event?.sessionId}`);
  check("and carries enough to show a preview", typeof event?.preview === "string" && event.preview.length > 0);
  bobInbox.close();

  const senderInbox = channel(teacher.token);
  await senderInbox.open();
  await wait(300);
  await api(`/sessions/${session.id}/messages`, { method: "POST", token: teacher.token, body: { body: "Again." } });
  const echoed = await senderInbox.next((e) => e.kind === "session_message", 1500);
  check("the sender is not notified about their own message", echoed === null, JSON.stringify(echoed));
  senderInbox.close();

  console.log("\nIt survives the server restarting\n");

  if (RESTART_CMD) {
    /**
     * The restart's own output is kept, not discarded.
     *
     * It was run with `stdio: "ignore"`, and when it failed in CI that threw away the one thing
     * that would have said why — the script prints the API's log before giving up, and none of
     * it reached anybody. A test that restarts a server has to be able to explain a server that
     * did not come back.
     */
    try {
      execSync(RESTART_CMD, { stdio: "pipe", encoding: "utf8" });
    } catch (err) {
      const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
      console.log(`  FAIL the API could not be restarted\n${detail || String(err)}`);
      failed += 1;
      failures.push("the API could not be restarted");
      console.log(`\n${passed} passed, ${failed} failed`);
      process.exit(1);
    }
    const afterRestart = await api(`/sessions/${session.id}/messages`, { token: alice.token });
    check("the thread is still there after a restart",
      (afterRestart.body?.messages ?? []).length >= 4, `${(afterRestart.body?.messages ?? []).length} messages`);
    check("with the words intact",
      (afterRestart.body?.messages ?? []).some((m) => /ten minutes late/.test(m.body)));
  } else {
    console.log("  (skipped: set RESTART_CMD to exercise this)");
  }

  console.log("\nEverything anybody does is written down\n");

  const logged = sql(
    `select action from activity_log where subject_type='session' and subject_id=${session.id} order by id`,
  ).split("\n").filter(Boolean);
  check("posting to the thread is logged", logged.includes("session.messages"), logged.join(","));
  check("booking the class is logged", logged.includes("session.book"), logged.join(","));

  const named = sql(
    `select count(*) from activity_log where action='session_message.sent' and subject_id=${session.id}`,
  );
  check("and the named event carries more than the route did", Number(named) >= 4, named);

  const whoBooked = sql(
    `select user_id from activity_log where action='session.book' and subject_id=${session.id} order by id limit 1`,
  );
  check("the log says who did it", Number(whoBooked) === alice.user.id, `${whoBooked} vs ${alice.user.id}`);

  const reads = sql(`select count(*) from activity_log where action like '%.messages' and detail->>'method'='GET'`);
  check("reading is not logged, only doing", Number(reads) === 0, reads);

  const refused = sql(
    `select count(*) from activity_log where subject_id=${session.id} and (detail->>'status')::int >= 400`,
  );
  check("a refused request is not recorded as an action taken", Number(refused) === 0, refused);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
