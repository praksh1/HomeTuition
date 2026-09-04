/**
 * Test *booking* access — one free door, and the fence around it.
 *
 * The owner has to walk the whole journey on the live site: find a class, book it, and enter the
 * real classroom. The site is also taking real money from real students at the same time. Every
 * quick way to reconcile those is a way to give the public a free door — pull the payment keys,
 * add a global "simulated payments" flag, run production as `NODE_ENV=test`, hardcode an email,
 * or believe a flag the client sends.
 *
 * This is the narrow way instead: three separate conditions, all required, none of them client-
 * controlled. Most of this suite is about what a grant does **not** do.
 *
 * ## Why the gateway proof works
 *
 * These servers run with `PAYMENT_WEBHOOK_SECRET` set, which is production's shape: `paymentMode()`
 * returns `gateway`, and `chargeForSession` in gateway mode **refuses** — the redirect-and-callback
 * dance is not implemented, so an ordinary booking comes back 402 "declined". That makes the
 * central claim testable rather than asserted: on one server, with one class, an ordinary student
 * is declined by the gateway and a granted student is enrolled. The only way the granted booking
 * can succeed is if the gateway was never reached.
 *
 * Usage: PGURL=... node scripts/test-student-access/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

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

const SECRET = "test-student-access-secret";

/** Boots a server with a chosen environment and hands back a client bound to its port. */
async function withServer(port, extraEnv, run) {
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: PGURL,
      SESSION_SECRET: SECRET,
      NODE_ENV: "test",
      /*
        The gateway is configured on every server here, on purpose.

        This is production's shape — money is being taken from the public — and it is what makes
        the central claim provable: an ordinary booking is refused by the gateway, so a booking
        that succeeds is one the gateway never saw.
      */
      PAYMENT_WEBHOOK_SECRET: "gateway-is-configured",
      // Nothing here talks to Daily. The provider seam is checked, not the provider.
      VIDEO_PROVIDER: "echo",
      ALLOW_TEST_TEACHING_ACCESS: "true",
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
  api.base = base;
  api.ws = `ws://127.0.0.1:${port}`;

  try { await run(api); } finally { stop(); }
}

let seq = 0;
async function register(api, role, name) {
  seq += 1;
  const email = `tsa_${Date.now()}_${seq}@example.com`;
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
const payPlan = (id) => sql(`update teacher_profiles set subscription_active = true where user_id = ${id}`);
/** Onboarding is a gate for a test grant, so a student who is to receive one has finished it. */
const onboard = (id) =>
  sql(`insert into user_onboarding (user_id, completed_at) values (${id}, now())
       on conflict (user_id) do update set completed_at = now()`);

/** A student ready to be granted: verified, onboarded, in good standing. */
async function readyStudent(api, name) {
  const s = await register(api, "student", name);
  verify(s.id);
  onboard(s.id);
  return s;
}

/** A teacher who may create classes because an operator granted test teaching access. */
async function testTeacher(api, agentToken, name) {
  const t = await register(api, "teacher", name);
  verify(t.id);
  approve(t.id);
  const granted = await api(`/admin/teachers/${t.id}/test-access`, { method: "POST", token: agentToken,
    body: { tier: "tier4", reason: "release-candidate walkthrough", days: 7 } });
  if (granted.status !== 201) throw new Error(`grant teaching: ${granted.status} ${JSON.stringify(granted.body)}`);
  return t;
}

/** A teacher who paid for a plan like anybody else, whose classes are ordinary paid classes. */
async function paidTeacher(api, name) {
  const t = await register(api, "teacher", name);
  verify(t.id);
  approve(t.id);
  payPlan(t.id);
  return t;
}

const MIN = 60_000;
/** Two minutes out: inside the ten-minute door, so the room tests can actually open one. */
const makeClass = (api, token, topic, atMs = Date.now() + 2 * MIN) =>
  api("/sessions", { method: "POST", token, body: {
    subject: "Maths", topic, date: new Date(atMs).toISOString(),
    duration: 60, maxStudents: 20, price: 500 } });

const grantStudent = (api, agentToken, id, days = 7) =>
  api(`/admin/students/${id}/test-access`, { method: "POST", token: agentToken,
    body: { reason: "release-candidate walkthrough", days } });

const book = (api, token, sessionId) =>
  api(`/sessions/${sessionId}/book`, { method: "POST", token, body: { paymentMethod: "esewa" } });

const enrolmentRow = (sessionId, studentId) =>
  sql(`select coalesce(payment_status,'-') || '|' || coalesce(payment_method,'-') || '|' || coalesce(payment_reference,'-')
       from session_enrollments where session_id = ${sessionId} and student_id = ${studentId}`);

/** A classroom socket, opened and awaited — the second door, which must agree with the first. */
function classroomSocket(api, token, sessionId, name) {
  const ws = new WebSocket(
    `${api.ws}/api/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`,
  );
  return new Promise((resolve) => {
    const done = (accepted) => { try { ws.close(); } catch { /* gone */ } resolve(accepted); };
    ws.once("open", () => done(true));
    ws.once("error", () => done(false));
    ws.once("close", () => done(false));
    setTimeout(() => done(false), 5000);
  });
}

/* ================================================================== off by default */

console.log("\nOff unless the server says otherwise\n");
await withServer(8101, { ALLOW_TEST_STUDENT_ACCESS: "" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await testTeacher(api, agentToken, "Switchless Sita");
  const student = await readyStudent(api, "Switchless Sunil");

  const cls = await makeClass(api, teacher.token, "Off by default");
  check("a class made under a teaching grant is marked a test class",
    sql(`select count(*) from test_classes where session_id = ${cls.body.id}`) === "1");

  const refused = await grantStudent(api, agentToken, student.id);
  check("an operator cannot grant test booking access at all", refused.status === 409,
    `${refused.status} ${JSON.stringify(refused.body)}`);
  check("and is told which switch is off",
    /ALLOW_TEST_STUDENT_ACCESS/.test(refused.body?.error ?? ""), refused.body?.error);

  // A row planted directly in the table — the state a server would be in if the switch were
  // turned off while grants were outstanding.
  sql(`insert into test_student_grants (student_id, reason, valid_until)
       values (${student.id}, 'planted', now() + interval '7 days')`);
  const booked = await book(api, student.token, cls.body.id);
  check("and a grant that exists in the table still buys nothing", booked.status === 402,
    `${booked.status} ${JSON.stringify(booked.body)}`);
  check("no enrolment was written", sql(
    `select count(*) from session_enrollments where session_id = ${cls.body.id} and student_id = ${student.id}`) === "0");
});

/* ================================================================== the one free door */

console.log("\nThe one booking that skips the gateway\n");
await withServer(8102, { ALLOW_TEST_STUDENT_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await testTeacher(api, agentToken, "Granted Gita");
  const tested = await readyStudent(api, "Granted Gopal");
  const ordinary = await readyStudent(api, "Ordinary Ojaswi");

  const granted = await grantStudent(api, agentToken, tested.id);
  check("an operator can grant test booking access", granted.status === 201,
    `${granted.status} ${JSON.stringify(granted.body)}`);
  check("and the grant carries a reason and an end date",
    !!granted.body?.grant?.reason && !!granted.body?.grant?.validUntil, JSON.stringify(granted.body?.grant));

  const cls = await makeClass(api, teacher.token, "The walkthrough");
  const id = cls.body.id;

  /*
    The whole claim, on one class, on one server, with the gateway configured.

    The ordinary student is refused *by the gateway*. The granted one is enrolled. Nothing but
    "the gateway was never called" explains the second result.
  */
  const ordinaryTry = await book(api, ordinary.token, id);
  check("an ordinary student booking a test class is sent to the gateway, and refused by it",
    ordinaryTry.status === 402, `${ordinaryTry.status} ${JSON.stringify(ordinaryTry.body)}`);
  check("and no enrolment is left behind by the refusal", sql(
    `select count(*) from session_enrollments where session_id = ${id} and student_id = ${ordinary.id}`) === "0");

  const testTry = await book(api, tested.token, id);
  check("the granted student is enrolled without the gateway being called", testTry.status === 201,
    `${testTry.status} ${JSON.stringify(testTry.body)}`);
  check("the row says test, not paid",
    enrolmentRow(id, tested.id) === "test|test_access|-", enrolmentRow(id, tested.id));
  check("and there is no invented receipt", sql(
    `select count(*) from session_enrollments where session_id = ${id} and student_id = ${tested.id}
     and payment_reference is not null`) === "0");
  check("the response says plainly that no payment was processed",
    testTry.body?.test === true && /no payment was processed/i.test(testTry.body?.testLabel ?? ""),
    JSON.stringify(testTry.body));

  /* ---- the two ways a grant is not a season ticket ---- */

  const paid = await paidTeacher(api, "Paying Pramila");
  const ordinaryClass = await makeClass(api, paid.token, "An ordinary paid class");
  check("that class is not marked a test class",
    sql(`select count(*) from test_classes where session_id = ${ordinaryClass.body.id}`) === "0");
  const crossTry = await book(api, tested.token, ordinaryClass.body.id);
  check("a granted student pays for an ordinary teacher's class like anybody else",
    crossTry.status === 402, `${crossTry.status} ${JSON.stringify(crossTry.body)}`);
  check("and holds no seat in it", sql(
    `select count(*) from session_enrollments where session_id = ${ordinaryClass.body.id}
     and student_id = ${tested.id}`) === "0");

  /* ---- both doors into the classroom agree ---- */

  await api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
  const room = await api(`/sessions/${id}/room`, { token: tested.token });
  check("the test student is let into the video room", room.status === 200,
    `${room.status} ${JSON.stringify(room.body)}`);
  check("and the room says what kind of class this is",
    room.body?.test === true && /no payment was processed/i.test(room.body?.testLabel ?? ""),
    JSON.stringify(room.body));
  check("the provider is still whatever the server was configured with",
    room.body?.provider === "echo", String(room.body?.provider));
  check("the whiteboard socket agrees with the room",
    await classroomSocket(api, tested.token, id, "Granted Gopal"));

  const shutOut = await api(`/sessions/${id}/room`, { token: ordinary.token });
  check("and the student who was refused is still outside both", shutOut.status === 403,
    `${shutOut.status} ${JSON.stringify(shutOut.body)}`);
  check("including the socket",
    (await classroomSocket(api, ordinary.token, id, "Ordinary Ojaswi")) === false);

  /* ---- the class is the student's own, and says what it is ---- */
  const mine = await api(`/sessions?studentId=${tested.id}`, { token: tested.token });
  const row = (mine.body?.sessions ?? []).find((s) => s.id === id);
  check("the class appears in the student's own list", !!row, JSON.stringify(mine.body?.sessions?.length));
  check("tagged as a test enrolment rather than a paid one", row?.enrolment === "test", String(row?.enrolment));
});

/* ================================================================== no money, anywhere */

console.log("\nNothing a test booking touches is money\n");
await withServer(8103, { ALLOW_TEST_STUDENT_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await testTeacher(api, agentToken, "Unpaid Urmila");
  const tested = await readyStudent(api, "Unpaid Utsav");
  await grantStudent(api, agentToken, tested.id);

  const cls = await makeClass(api, teacher.token, "Counts as nothing");
  const id = cls.body.id;
  await book(api, tested.token, id);

  check("it is not counted as a paid enrolment anywhere", sql(
    `select count(*) from session_enrollments where session_id = ${id} and payment_status = 'paid'`) === "0");
  check("the seat is still taken, so the class cannot be oversold",
    sql(`select enrolled_count from sessions where id = ${id}`) === "1");

  // Dropping is the route that creates a refund debt. It reads `payment_status = 'paid'`.
  const dropped = await api(`/sessions/${id}/drop`, { method: "POST", token: tested.token, body: { reason: "x" } });
  check("a test enrolment cannot be dropped for a refund", dropped.status >= 400,
    `${dropped.status} ${JSON.stringify(dropped.body)}`);
  check("and no refund row exists for it",
    sql(`select count(*) from refunds where session_id = ${id}`) === "0");

  // Cancelling the class pays back everyone who paid. Nobody did.
  await api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "cancelled" } });
  check("cancelling the class owes nobody anything",
    sql(`select count(*) from refunds where session_id = ${id}`) === "0");
  check("the test enrolment was not turned into a refunded one", sql(
    `select count(*) from session_enrollments where session_id = ${id} and payment_status = 'test'`) === "1");
});

/* ================================================================== one booking, many requests */

console.log("\nEight requests at once are still one seat\n");
await withServer(8104, { ALLOW_TEST_STUDENT_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await testTeacher(api, agentToken, "Racing Rita");
  const tested = await readyStudent(api, "Racing Ram");
  await grantStudent(api, agentToken, tested.id);

  const cls = await makeClass(api, teacher.token, "All at once");
  const id = cls.body.id;

  const results = await Promise.all(Array.from({ length: 8 }, () => book(api, tested.token, id)));
  const created = results.filter((r) => r.status === 201).length;
  const already = results.filter((r) => r.status === 200 && r.body?.alreadyBooked).length;
  check("exactly one request creates the enrolment", created === 1,
    `${created} created, ${already} already, statuses ${results.map((r) => r.status).join(",")}`);
  check("and the rest are told they already have it", created + already === 8,
    results.map((r) => r.status).join(","));
  check("there is exactly one enrolment row", sql(
    `select count(*) from session_enrollments where session_id = ${id} and student_id = ${tested.id}`) === "1");
  check("and the seat count agrees", sql(`select enrolled_count from sessions where id = ${id}`) === "1");
  check("still a test row after all that", enrolmentRow(id, tested.id) === "test|test_access|-",
    enrolmentRow(id, tested.id));
});

/* ================================================================== ending a grant */

console.log("\nExpiry, revocation, and a class that stays what it was\n");
await withServer(8105, { ALLOW_TEST_STUDENT_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await testTeacher(api, agentToken, "Ending Eliza");
  const expiring = await readyStudent(api, "Expiring Esha");
  const revoked = await readyStudent(api, "Revoked Rabin");
  await grantStudent(api, agentToken, expiring.id);
  await grantStudent(api, agentToken, revoked.id);

  const one = (await makeClass(api, teacher.token, "Before")).body.id;
  const two = (await makeClass(api, teacher.token, "After")).body.id;

  check("both students can book while their grants are live",
    (await book(api, expiring.token, one)).status === 201 &&
    (await book(api, revoked.token, one)).status === 201);

  sql(`update test_student_grants set valid_until = now() - interval '1 hour' where student_id = ${expiring.id}`);
  const afterExpiry = await book(api, expiring.token, two);
  check("an expired grant stops working without anybody revoking it", afterExpiry.status === 402,
    `${afterExpiry.status} ${JSON.stringify(afterExpiry.body)}`);

  const revokeRes = await api(`/admin/students/${revoked.id}/test-access/revoke`, { method: "POST", token: agentToken });
  check("an operator can end a grant early", revokeRes.status === 200 && revokeRes.body?.revoked === 1,
    JSON.stringify(revokeRes.body));
  const afterRevoke = await book(api, revoked.token, two);
  check("and the next booking goes to the gateway", afterRevoke.status === 402,
    `${afterRevoke.status} ${JSON.stringify(afterRevoke.body)}`);

  /*
    A class does not stop having been a test class.

    The teacher's own grant is revoked here — after the class exists. Asking "does this teacher
    currently hold a grant" at booking time would make the class paid retroactively; the class was
    written down when it was created, so it stays what it was.
  */
  await api(`/admin/teachers/${teacher.id}/test-access/revoke`, { method: "POST", token: agentToken });
  check("the class is still marked, after the teacher's grant is revoked",
    sql(`select count(*) from test_classes where session_id = ${two}`) === "1");
  const later = await readyStudent(api, "Later Laxmi");
  await grantStudent(api, agentToken, later.id);
  const stillFree = await book(api, later.token, two);
  check("and a granted student can still book it", stillFree.status === 201,
    `${stillFree.status} ${JSON.stringify(stillFree.body)}`);
});

/* ================================================================== closing the switch after the fact */

console.log("\nWhat happens to what already exists when the switch goes off\n");
let switchedOff = null;
await withServer(8106, { ALLOW_TEST_STUDENT_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);
  const teacher = await testTeacher(api, agentToken, "Closing Chandra");
  const tested = await readyStudent(api, "Closing Chetan");
  const paying = await readyStudent(api, "Paying Puja");
  await grantStudent(api, agentToken, tested.id);

  const id = (await makeClass(api, teacher.token, "Before the switch")).body.id;
  await book(api, tested.token, id);
  // A paid seat in the same class, written directly: this is the access that must survive.
  sql(`insert into session_enrollments (session_id, student_id, payment_status, payment_method, payment_reference)
       values (${id}, ${paying.id}, 'paid', 'esewa', 'REAL-123')`);
  await api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  check("with the switch on, the test student is in the room",
    (await api(`/sessions/${id}/room`, { token: tested.token })).status === 200);
  switchedOff = { id, tested, paying, teacher };
});

await withServer(8107, { ALLOW_TEST_STUDENT_ACCESS: "" }, async (api) => {
  const { id, tested, paying } = switchedOff;
  // The tokens were signed with the same SESSION_SECRET, so they are still good.
  const closed = await api(`/sessions/${id}/room`, { token: tested.token });
  check("with the switch off, the test enrolment opens nothing", closed.status === 403,
    `${closed.status} ${JSON.stringify(closed.body)}`);
  check("and the socket closes with it",
    (await classroomSocket(api, tested.token, id, "Closing Chetan")) === false);
  check("the row is still there, unchanged — closing a door is not a refund",
    enrolmentRow(id, tested.id) === "test|test_access|-", enrolmentRow(id, tested.id));

  const stillPaid = await api(`/sessions/${id}/room`, { token: paying.token });
  check("the student who actually paid is unaffected", stillPaid.status === 200,
    `${stillPaid.status} ${JSON.stringify(stillPaid.body)}`);
  check("and their socket still opens",
    await classroomSocket(api, paying.token, id, "Paying Puja"));
  check("the class the switch does not touch is still marked",
    sql(`select count(*) from test_classes where session_id = ${id}`) === "1");
});

/* ================================================================== who may grant, and to whom */

console.log("\nWho may grant, and what a grant must say\n");
await withServer(8108, { ALLOW_TEST_STUDENT_ACCESS: "true" }, async (api) => {
  const agentToken = await makeAgent(api);
  const student = await readyStudent(api, "Grabby Gaurav");
  const other = await readyStudent(api, "Other Ojas");
  const teacher = await paidTeacher(api, "Teaching Tara");

  check("a student cannot grant themselves anything",
    (await api(`/admin/students/${student.id}/test-access`, { method: "POST", token: student.token,
      body: { reason: "please", days: 7 } })).status === 403);
  check("nor can another student grant it to them",
    (await api(`/admin/students/${student.id}/test-access`, { method: "POST", token: other.token,
      body: { reason: "please", days: 7 } })).status === 403);
  check("nor can a teacher",
    (await api(`/admin/students/${student.id}/test-access`, { method: "POST", token: teacher.token,
      body: { reason: "please", days: 7 } })).status === 403);
  check("nor can somebody signed out",
    (await api(`/admin/students/${student.id}/test-access`, { method: "POST",
      body: { reason: "please", days: 7 } })).status === 401);

  const noReason = await api(`/admin/students/${student.id}/test-access`, { method: "POST", token: agentToken,
    body: { reason: "   ", days: 7 } });
  check("a grant without a reason is refused", noReason.status === 400, JSON.stringify(noReason.body));
  const forever = await api(`/admin/students/${student.id}/test-access`, { method: "POST", token: agentToken,
    body: { reason: "forever please", days: 3650 } });
  check("and one that is not temporary is refused", forever.status === 400, JSON.stringify(forever.body));

  await grantStudent(api, agentToken, student.id);
  await grantStudent(api, agentToken, student.id);
  check("granting twice leaves exactly one live grant", sql(
    `select count(*) from test_student_grants where student_id = ${student.id} and revoked_at is null`) === "1");

  check("both actions are in the activity log", sql(
    `select count(*) from activity_log where subject_id = ${student.id}
     and action in ('admin.test_student.granted')`) >= "1");
  await api(`/admin/students/${student.id}/test-access/revoke`, { method: "POST", token: agentToken });
  check("and so is the revocation", sql(
    `select count(*) from activity_log where subject_id = ${student.id}
     and action = 'admin.test_student.revoked'`) === "1");

  /* ---- the three gates a grant does not open ---- */

  const unverified = await register(api, "student", "Unverified Umesh");
  onboard(unverified.id);
  const noEmail = await grantStudent(api, agentToken, unverified.id);
  check("an unverified student cannot be granted test access", noEmail.status === 409,
    JSON.stringify(noEmail.body));

  const halfway = await register(api, "student", "Halfway Hari");
  verify(halfway.id);
  const noOnboarding = await grantStudent(api, agentToken, halfway.id);
  check("nor can one who has not finished onboarding", noOnboarding.status === 409,
    JSON.stringify(noOnboarding.body));

  const suspended = await readyStudent(api, "Suspended Sabin");
  sql(`update users set suspended_at = now(), suspended_reason = 'x' where id = ${suspended.id}`);
  const noSuspended = await grantStudent(api, agentToken, suspended.id);
  check("nor a suspended account", noSuspended.status === 409, JSON.stringify(noSuspended.body));

  const teacherGrant = await grantStudent(api, agentToken, teacher.id);
  check("and a teacher is sent to the teaching grant instead", teacherGrant.status === 409,
    JSON.stringify(teacherGrant.body));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
