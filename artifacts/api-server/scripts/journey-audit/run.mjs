/**
 * The whole staging journey, against a real server shaped like staging.
 *
 * Staging is deliberately a server with things switched **off**: no mail provider, no payment
 * provider, no file storage, no Daily key, and `VIDEO_PROVIDER=echo`. Most of this project's
 * suites test what happens when a thing works. This one tests the other half — what a person is
 * told when it does not — because that is what the owner actually sees on the preview, and
 * because two of the defects it now guards were exactly that: a server that could not send email
 * telling somebody to wait a minute for one, and a paid student being told they were not enrolled.
 *
 * It starts its own server, on its own port, with its own environment. Nothing here touches
 * production, and nothing here needs a credential.
 *
 * Usage: node scripts/journey-audit/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const PORT = Number(process.env.JOURNEY_TEST_PORT ?? 8099);

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

function startServer() {
  return spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "journey-audit-secret",
      // Staging's own shape. Every omission below is deliberate: no RESEND_API_KEY, no
      // BREVO_API_KEY, no EMAIL_FROM, no DAILY_API_KEY, no R2 credentials.
      NODE_ENV: "production",
      VIDEO_PROVIDER: "echo",
      ALLOW_TEST_TEACHING_ACCESS: "true",
    },
    stdio: "ignore",
  });
}

async function waitFor() {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/healthz`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${PORT}/api${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
}

const stamp = Date.now();
let seq = 0;
async function register(role, name) {
  seq += 1;
  const email = `journey_${stamp}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name, email, password: PASSWORD, role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "audit" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}
const PASSWORD = "journeyPassword123";

/** Mark an address verified. No mailer exists, so the link nobody received cannot be clicked. */
const verify = (userId) =>
  sql(`update account_security set email_verified_at = now() where user_id = ${userId}`);

async function run() {
  const server = startServer();
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch { /* gone */ } });
  if (!(await waitFor())) throw new Error("the server never came up");

  console.log("\nRegistering when the server cannot send email\n");

  const teacher = await register("teacher", "Journey Teacher");
  check("a teacher can register", !!teacher.token);
  check("and is told no email went out, rather than that one did",
    teacher.verificationEmailSent === false && teacher.emailConfigured === false,
    JSON.stringify({ sent: teacher.verificationEmailSent, configured: teacher.emailConfigured }));

  const student = await register("student", "Journey Student");
  const outsider = await register("student", "Journey Outsider");

  const dupe = await api("/auth/register", { method: "POST", body: {
    name: "Impostor", email: teacher.email, password: "somethingElse123", role: "student",
    grade: "9", dateOfBirth: "2000-01-01" } });
  check("the same address cannot register twice", dupe.status === 409, `status=${dupe.status}`);

  const wrongPassword = await api("/auth/login", { method: "POST", body: { email: teacher.email, password: "nope" } });
  const noSuchAccount = await api("/auth/login", { method: "POST", body: { email: `ghost_${stamp}@example.com`, password: PASSWORD } });
  check("a wrong password and an unknown address are indistinguishable",
    wrongPassword.status === noSuchAccount.status &&
      JSON.stringify(wrongPassword.body) === JSON.stringify(noSuchAccount.body),
    `${wrongPassword.status} vs ${noSuchAccount.status}`);

  /**
   * The regression this suite exists for.
   *
   * Registration issues a verification token, so the *first* resend anybody can ask for is always
   * inside the one-minute cooldown. The cooldown used to be consulted before the mail
   * configuration, so a server with no provider answered "Please wait a minute before asking for
   * another email" — on the ordinary path, to every tester, about an email that did not exist and
   * could not be sent.
   */
  const resend = await api("/auth/verification/resend", { method: "POST", token: teacher.token, body: {} });
  check("a server that cannot send email says so, rather than asking for patience",
    resend.status === 503, `status=${resend.status} ${JSON.stringify(resend.body)}`);
  check("and does not pretend an email is on its way", resend.body?.sent === false);
  check("and reports its configuration the way /auth/password/forgot already does",
    resend.body?.emailConfigured === false, JSON.stringify(resend.body?.emailConfigured));
  check("the message names the missing thing", /not configured/i.test(String(resend.body?.error)),
    String(resend.body?.error));

  console.log("\nVerified sign-in\n");

  verify(teacher.user.id);
  verify(student.user.id);
  verify(outsider.user.id);
  const teacherAuth = await api("/auth/login", { method: "POST", body: { email: teacher.email, password: PASSWORD } });
  check("a verified teacher signs in", teacherAuth.status === 200 && teacherAuth.body?.user?.emailVerified === true,
    JSON.stringify(teacherAuth.body?.user?.emailVerified));
  const T = teacherAuth.body.token;
  const S = (await api("/auth/login", { method: "POST", body: { email: student.email, password: PASSWORD } })).body.token;
  const O = (await api("/auth/login", { method: "POST", body: { email: outsider.email, password: PASSWORD } })).body.token;

  console.log("\nDocuments, on a server with no file storage\n");

  const upload = await api("/storage/uploads/request-url", { method: "POST", token: T, body: {
    name: "citizenship.jpg", size: 1024, contentType: "image/jpeg" } });
  check("asking to upload says uploads are not set up here", upload.status === 503,
    `status=${upload.status} ${JSON.stringify(upload.body)}`);
  check("and says it in a sentence rather than failing obscurely",
    /not set up/i.test(String(upload.body?.error)), String(upload.body?.error));

  const forged = await api("/teachers/me/credentials", { method: "POST", token: T, body: {
    documentType: "citizenship", fileKey: `not-mine/${stamp}.jpg`, originalName: "citizenship.jpg",
    contentType: "image/jpeg" } });
  check("a credential naming a file the teacher never uploaded is refused",
    forged.status === 400, `status=${forged.status} ${JSON.stringify(forged.body)}`);

  console.log("\nA teacher nobody has approved yet\n");

  const eligibility = await api("/teachers/me/plan-eligibility", { token: T });
  check("cannot choose a plan", eligibility.body?.allowed === false, JSON.stringify(eligibility.body));
  check("and is told why, in a code the screen can act on",
    eligibility.body?.code === "OPERATOR_REVIEW", JSON.stringify(eligibility.body?.code));

  const subscribe = await api(`/teachers/${teacher.user.teacher.id}/subscribe`, { method: "POST", token: T, body: {
    tier: "base", paymentMethod: "esewa" } });
  check("cannot buy one either, whatever the screen offered", subscribe.status === 403,
    `status=${subscribe.status}`);

  const earlyClass = await api("/sessions", { method: "POST", token: T, body: {
    topic: "Too soon", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 3600_000).toISOString(), duration: 60, price: 500, maxStudents: 5 } });
  check("and cannot create a class", earlyClass.status === 403, `status=${earlyClass.status}`);

  console.log("\nAn operator reviews the account\n");

  const operator = await register("student", "Journey Operator");
  verify(operator.user.id);
  // An operator is a registered account promoted in the database — see ISSUES.md. `requireAdmin`
  // reads users.role, so the operator_accounts row on its own is not access.
  sql(`update users set role = 'admin' where id = ${operator.user.id}`);
  sql(`insert into operator_accounts (user_id, login_id, is_administrator, must_change_password)
       values (${operator.user.id}, 'journey-${stamp}', true, false)`);
  const A = (await api("/auth/login", { method: "POST", body: { email: operator.email, password: PASSWORD } })).body.token;

  const queue = await api("/admin/teachers/pending", { token: A });
  check("the pending teacher is in the operator's queue",
    Array.isArray(queue.body?.teachers) && queue.body.teachers.some((t) => t.userId === teacher.user.id),
    `status=${queue.status}`);

  const approveTooSoon = await api(`/admin/teachers/${teacher.user.id}/decision`, { method: "POST", token: A, body: {
    decision: "approved", reason: "audit" } });
  check("a teacher who has submitted no document cannot be approved",
    approveTooSoon.status === 409, `status=${approveTooSoon.status} ${JSON.stringify(approveTooSoon.body)}`);

  // Storage is off, so no genuine upload is possible. Inserting the row directly is the honest
  // boundary of this suite: it exercises the *review*, and proves nothing about the upload.
  sql(`insert into teacher_credentials (teacher_id, document_type, file_key, original_name, content_type, status)
       values (${teacher.user.id}, 'citizenship', 'journey/${stamp}.jpg', 'citizenship.jpg', 'image/jpeg', 'pending')`);
  const credId = sql(`select id from teacher_credentials where teacher_id = ${teacher.user.id} order by id desc limit 1`);

  const vagueWord = await api(`/admin/teacher-credentials/${credId}/decision`, { method: "POST", token: A, body: {
    decision: "accepted", reason: "audit" } });
  check("a decision the API does not recognise is refused", vagueWord.status === 400, `status=${vagueWord.status}`);

  const silentRejection = await api(`/admin/teacher-credentials/${credId}/decision`, { method: "POST", token: A, body: {
    decision: "rejected" } });
  check("a rejection with no reason is refused, so the teacher can be told what to fix",
    silentRejection.status === 400, `status=${silentRejection.status}`);

  const accepted = await api(`/admin/teacher-credentials/${credId}/decision`, { method: "POST", token: A, body: {
    decision: "approved", reason: "audit" } });
  check("the document can be approved", accepted.status === 200, `status=${accepted.status}`);
  check("and the operator is told the teacher was NOT notified, because email is off",
    accepted.body?.notified?.email === "not_configured" && accepted.body?.notified?.inApp === false,
    JSON.stringify(accepted.body?.notified));

  const approved = await api(`/admin/teachers/${teacher.user.id}/decision`, { method: "POST", token: A, body: {
    decision: "approved", reason: "audit" } });
  check("the account can be approved once its document has been", approved.status === 200,
    `status=${approved.status}`);
  check("approval does not claim a notification it could not deliver",
    approved.body?.notified?.email === "not_configured", JSON.stringify(approved.body?.notified?.email));

  console.log("\nThe staging teaching grant\n");

  const grantNonTeacher = await api(`/admin/teachers/${student.user.id}/test-access`, { method: "POST", token: A, body: {
    tier: "base", reason: "audit", days: 7 } });
  check("a grant cannot be given to somebody who is not a teacher", grantNonTeacher.status === 404,
    `status=${grantNonTeacher.status}`);

  const grantNoReason = await api(`/admin/teachers/${teacher.user.id}/test-access`, { method: "POST", token: A, body: {
    tier: "base", days: 7 } });
  check("a grant with no written reason is refused, because it could not be audited",
    grantNoReason.status === 400, `status=${grantNoReason.status}`);

  const grant = await api(`/admin/teachers/${teacher.user.id}/test-access`, { method: "POST", token: A, body: {
    tier: "base", reason: "staging journey audit", days: 7 } });
  check("an explained grant is recorded", grant.status === 201, `status=${grant.status}`);
  check("with an expiry, so it cannot become permanent by being forgotten",
    !!grant.body?.grant?.validUntil, JSON.stringify(grant.body?.grant?.validUntil));
  check("and says who gave it", grant.body?.grant?.grantedBy === operator.user.id,
    JSON.stringify(grant.body?.grant?.grantedBy));

  const nowEligible = await api("/teachers/me/plan-eligibility", { token: T });
  check("the teacher may now teach", nowEligible.body?.allowed === true, JSON.stringify(nowEligible.body));

  console.log("\nA class, a booking, and a classroom\n");

  const created = await api("/sessions", { method: "POST", token: T, body: {
    topic: "Journey class", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 120_000).toISOString(), duration: 60, price: 500, maxStudents: 5 } });
  check("the approved teacher creates a class", created.status === 201, `status=${created.status}`);
  const sessionId = created.body?.id;

  const booking = await api(`/sessions/${sessionId}/book`, { method: "POST", token: S, body: { paymentMethod: "esewa" } });
  check("a student books it", booking.status === 201, `status=${booking.status}`);
  check("and the enrolment is paid the moment it exists, with nothing in between",
    booking.body?.paymentStatus === "paid" && booking.body?.paid === true,
    JSON.stringify({ status: booking.body?.paymentStatus, paid: booking.body?.paid }));

  await api(`/sessions/${sessionId}`, { method: "PATCH", token: T, body: { status: "live" } });

  const teacherRoom = await api(`/sessions/${sessionId}/room`, { token: T });
  check("the teacher gets a room from the staging provider", teacherRoom.status === 200,
    `status=${teacherRoom.status}`);
  check("named echo, not Daily", teacherRoom.body?.provider === "echo", JSON.stringify(teacherRoom.body?.provider));
  check("and is the owner", teacherRoom.body?.isOwner === true);

  const studentRoom = await api(`/sessions/${sessionId}/room`, { token: S });
  check("the paid student gets one too", studentRoom.status === 200, `status=${studentRoom.status}`);
  check("but is not the owner", studentRoom.body?.isOwner === false);

  const outsiderRoom = await api(`/sessions/${sessionId}/room`, { token: O });
  check("somebody who never booked gets no room", outsiderRoom.status === 403, `status=${outsiderRoom.status}`);
  check("and is told the true reason — they are not in this class",
    /enrolled/i.test(String(outsiderRoom.body?.error)), String(outsiderRoom.body?.error));

  /**
   * The other regression this suite exists for.
   *
   * `canAccessSession` folded four different refusals into one `false`, and the room route turned
   * that into "You must be enrolled in this session to join it." For a student who opens their
   * booked class the evening before, that sentence is **false**: they are enrolled, they have
   * paid, and only the clock is wrong. This project has fixed that shape of bug in the other
   * direction — a dropped student's screen still saying "Booked & paid" — and it is the same
   * wound.
   */
  const tomorrow = await api("/sessions", { method: "POST", token: T, body: {
    topic: "Tomorrow's class", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 26 * 3600_000).toISOString(), duration: 60, price: 500, maxStudents: 5 } });
  await api(`/sessions/${tomorrow.body.id}/book`, { method: "POST", token: S, body: { paymentMethod: "esewa" } });
  const early = await api(`/sessions/${tomorrow.body.id}/room`, { token: S });
  check("a paid student who is simply early is refused on the clock, not on their booking",
    early.status === 409, `status=${early.status} ${JSON.stringify(early.body)}`);
  check("and is never told they are not enrolled in a class they paid for",
    !/enrolled/i.test(String(early.body?.error)), String(early.body?.error));
  check("the message says when the doors open", /opens/i.test(String(early.body?.error)),
    String(early.body?.error));
  /**
   * And it is a *different* shape from a class that is over.
   *
   * `expired: true` used to be on every timing refusal, and both classrooms read it as terminal —
   * so a teacher who was early was offered "create a new session" for a class their students had
   * booked. The code now says which kind it is, and `expired` is only true when it is true.
   */
  check("a class that has not opened yet is not labelled expired",
    early.body?.code === "too_early" && early.body?.expired === false,
    JSON.stringify({ code: early.body?.code, expired: early.body?.expired }));
  check("and says when the door opens, so a screen can wait exactly that long",
    typeof early.body?.opensAt === "number" && early.body.opensAt > Date.now(),
    JSON.stringify(early.body?.opensAt));

  // A class that really is over keeps the terminal shape.
  const longOver = await api("/sessions", { method: "POST", token: T, body: {
    topic: "Long over", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 3600_000).toISOString(), duration: 60, price: 500, maxStudents: 5 } });
  await api(`/sessions/${longOver.body.id}/book`, { method: "POST", token: S, body: { paymentMethod: "esewa" } });
  sql(`update sessions set date = now() - interval '3 days' where id = ${longOver.body.id}`);
  const finished = await api(`/sessions/${longOver.body.id}/room`, { token: S });
  check("a class that finished is still terminal, and says so",
    finished.status === 409 && finished.body?.code === "finished" && finished.body?.expired === true,
    JSON.stringify({ status: finished.status, code: finished.body?.code, expired: finished.body?.expired }));

  console.log("\nWhat nobody may reach\n");

  const studentReadsAdmin = await api("/admin/users", { token: S });
  check("a student cannot read the operator's user list", studentReadsAdmin.status === 403,
    `status=${studentReadsAdmin.status}`);
  const selfGrant = await api(`/admin/teachers/${teacher.user.id}/test-access`, { method: "POST", token: T, body: {
    tier: "tier4", reason: "self-service", days: 365 } });
  check("a teacher cannot grant themselves teaching access", selfGrant.status === 403,
    `status=${selfGrant.status}`);
  const anonymous = await api("/auth/me");
  check("and signed out is signed out", anonymous.status === 401, `status=${anonymous.status}`);

  console.log("\nAsking to reset a password tells an attacker nothing\n");

  const knownAddress = await api("/auth/password/forgot", { method: "POST", body: { email: student.email } });
  const unknownAddress = await api("/auth/password/forgot", { method: "POST", body: { email: `ghost_${stamp}@example.com` } });
  check("the two answers are identical",
    knownAddress.status === unknownAddress.status &&
      JSON.stringify(knownAddress.body) === JSON.stringify(unknownAddress.body),
    `${JSON.stringify(knownAddress.body)} vs ${JSON.stringify(unknownAddress.body)}`);
  check("and both say plainly whether this server can send the email at all",
    knownAddress.body?.emailConfigured === false, JSON.stringify(knownAddress.body?.emailConfigured));

  try { server.kill("SIGKILL"); } catch { /* gone */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
