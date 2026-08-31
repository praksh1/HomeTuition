/**
 * The support desk, and the door in front of it.
 *
 * Two halves, and the first matters more: a tool that can suspend accounts and reset passwords
 * is one where the question "who is allowed in here" has to be answered by the server on every
 * request, not by whichever screen the app happens to show. So this spends as much effort
 * trying to get in as it does on the features once inside.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/admin-tests/run.mjs
 * PGURL is used to make an agent account, which nothing in the app can do — deliberately.
 */
import { execFileSync } from "node:child_process";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

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
  const res = await fetch(`${API}/api${path}`, {
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
  // Returned alongside the response, because half this suite signs people back in and the
  // register endpoint does not echo the address. Without it every login here sent `undefined`
  // and came back "email and password are required" — which looks exactly like a broken login.
  const email = `ad_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email,
    password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

/** An agent, made the only way there is: directly, by the owner. */
async function makeAgent() {
  const account = await register("student", "Support Agent");
  sql(`update users set role = 'admin' where id = ${account.user.id}`);
  const signedIn = await api("/auth/login", { method: "POST", body: { email: account.email, password: "password123" } });
  return { ...account, token: signedIn.body?.token ?? account.token };
}

async function run() {
  console.log("\nThe door\n");

  const agent = await makeAgent();
  const teacher = await register("teacher", "Ram Prasad");
  prepareTeacherForClass(teacher.user.id);
  const student = await register("student", "Sita Sharma");

  const asStudent = await api("/admin/overview", { token: student.token });
  check("a student cannot see the support desk", asStudent.status === 403, `status=${asStudent.status}`);
  const asTeacher = await api("/admin/overview", { token: teacher.token });
  check("nor can a teacher", asTeacher.status === 403, `status=${asTeacher.status}`);
  const anonymous = await api("/admin/overview");
  check("nor can somebody signed out", anonymous.status === 401, `status=${anonymous.status}`);

  const asAgent = await api("/admin/overview", { token: agent.token });
  check("an agent can", asAgent.status === 200, `status=${asAgent.status}`);
  check("and is told whether the numbers were readable", asAgent.body?.known === true);

  const selfPromote = await api("/auth/register", { method: "POST", body: {
    name: "Sneaky", email: `sneak_${Date.now()}@example.com`, password: "password123", role: "admin",
  } });
  check("nobody can register themselves as an agent", selfPromote.status === 400, `status=${selfPromote.status}`);

  /**
   * The role is re-read on every request rather than taken from the token. An account demoted
   * this morning would otherwise keep every power it had until its token expired.
   */
  sql(`update users set role = 'student' where id = ${agent.user.id}`);
  const demoted = await api("/admin/overview", { token: agent.token });
  check("a demoted agent loses access immediately, on the old token", demoted.status === 403, `status=${demoted.status}`);
  sql(`update users set role = 'admin' where id = ${agent.user.id}`);

  console.log("\nA ticket, with the evidence behind it\n");

  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Algebra", subject: "Maths", description: "d",
    date: new Date(Date.now() + 5 * 60_000).toISOString(), duration: 60, price: 500, maxStudents: 10 } });
  const sessionId = created.body.id;
  await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  await api(`/sessions/${sessionId}/messages`, { method: "POST", token: teacher.token,
    body: { body: "Running late, sorry." } });

  const filed = await api("/disputes", { method: "POST", token: student.token, body: {
    reason: "Refund Request", description: "Teacher never really taught.", sessionId } });
  const ticketId = filed.body.id;

  const list = await api("/admin/tickets?status=open", { token: agent.token });
  check("the ticket is in the open queue", (list.body?.tickets ?? []).some((t) => t.id === ticketId));

  const full = await api(`/admin/tickets/${ticketId}`, { token: agent.token });
  check("an agent can open it", full.status === 200, `status=${full.status}`);
  check("and sees who reported it", full.body?.ticket?.reporterName === "Sita Sharma", full.body?.ticket?.reporterName);
  check("with the class attached", full.body?.session?.id === sessionId);
  check("the class's message thread is there as evidence",
    (full.body?.messages ?? []).some((m) => /Running late/.test(m.body)),
    JSON.stringify((full.body?.messages ?? []).map((m) => m.body)));
  check("so is what the attendance record shows", full.body?.attendance?.known === true);
  check("and the findings drawn from it", Array.isArray(full.body?.findings));
  check("along with what the reporter has been doing",
    (full.body?.reporterActivity?.rows ?? []).length > 0);

  const noReason = await api(`/admin/tickets/${ticketId}`, { method: "PATCH", token: agent.token,
    body: { status: "resolved" } });
  check("a ticket cannot be closed without saying what was decided", noReason.status === 400, `status=${noReason.status}`);

  const resolved = await api(`/admin/tickets/${ticketId}`, { method: "PATCH", token: agent.token,
    body: { status: "resolved", resolution: "Refunded in full; teacher warned." } });
  check("with a decision, it closes", resolved.status === 200, `status=${resolved.status}`);
  // The reply carries the ticket, its history and what may follow — see scripts/ticket-tests,
  // which is where the lifecycle itself is checked.
  check("and the decision is kept", /Refunded in full/.test(resolved.body?.ticket?.resolution ?? ""));

  const closing = sql(`select count(*) from activity_log where action='admin.ticket.resolved' and subject_id=${ticketId}`);
  check("closing it is written down against the agent", Number(closing) === 1, closing);

  console.log("\nSuspending an account\n");

  const noWhy = await api(`/admin/users/${teacher.user.id}/suspend`, { method: "POST", token: agent.token, body: {} });
  check("a suspension needs a reason", noWhy.status === 400, `status=${noWhy.status}`);

  const suspended = await api(`/admin/users/${teacher.user.id}/suspend`, { method: "POST", token: agent.token,
    body: { reason: "Repeated no-shows." } });
  check("with one, it goes through", suspended.status === 200, `status=${suspended.status}`);

  const blocked = await api("/auth/login", { method: "POST", body: { email: teacher.email, password: "password123" } });
  check("the suspended teacher cannot sign in", blocked.status === 403, `status=${blocked.status}`);
  check("and is told why", /Repeated no-shows/.test(blocked.body?.error ?? ""), blocked.body?.error);

  const wrongPassword = await api("/auth/login", { method: "POST", body: { email: teacher.email, password: "nope" } });
  check("a wrong password on a suspended account still says only 'invalid'",
    wrongPassword.status === 401, `status=${wrongPassword.status}`);

  const self = await api(`/admin/users/${agent.user.id}/suspend`, { method: "POST", token: agent.token,
    body: { reason: "oops" } });
  check("an agent cannot suspend themselves out of the room", self.status === 400, `status=${self.status}`);

  const otherAgent = await makeAgent();
  const agentOnAgent = await api(`/admin/users/${otherAgent.user.id}/suspend`, { method: "POST", token: agent.token,
    body: { reason: "disagreement" } });
  check("nor another agent", agentOnAgent.status === 403, `status=${agentOnAgent.status}`);

  const restored = await api(`/admin/users/${teacher.user.id}/unsuspend`, { method: "POST", token: agent.token });
  check("a suspension can be lifted", restored.status === 200, `status=${restored.status}`);
  const backIn = await api("/auth/login", { method: "POST", body: { email: teacher.email, password: "password123" } });
  check("and they can sign in again", backIn.status === 200, `status=${backIn.status}`);

  console.log("\nResetting a password without learning it\n");

  const issued = await api(`/admin/users/${student.user.id}/password-reset`, { method: "POST", token: agent.token });
  check("an agent can issue a code", issued.status === 200, `status=${issued.status}`);
  check("which is six digits", /^\d{6}$/.test(issued.body?.code ?? ""), issued.body?.code);

  const stored = sql(`select code_hash from password_resets where user_id=${student.user.id} order by id desc limit 1`);
  check("only its hash is stored, never the code", stored.length === 64 && stored !== issued.body.code, stored.slice(0, 20));

  const logged = sql(
    `select detail::text from activity_log where action='admin.password_reset.issued' and subject_id=${student.user.id} order by id desc limit 1`,
  );
  check("and the code is not in the audit log either", !logged.includes(issued.body.code), logged);

  const wrongCode = await api("/auth/redeem-reset", { method: "POST", body: {
    email: student.email, code: "000000", newPassword: "brand-new-password" } });
  check("a wrong code is refused", wrongCode.status === 400, `status=${wrongCode.status}`);

  const shortOne = await api("/auth/redeem-reset", { method: "POST", body: {
    email: student.email, code: issued.body.code, newPassword: "short" } });
  check("so is a password too short to be worth having", shortOne.status === 400, `status=${shortOne.status}`);

  const redeemed = await api("/auth/redeem-reset", { method: "POST", body: {
    email: student.email, code: issued.body.code, newPassword: "brand-new-password" } });
  check("the right code lets them choose their own password", redeemed.status === 200, `status=${redeemed.status}`);

  const withNew = await api("/auth/login", { method: "POST", body: { email: student.email, password: "brand-new-password" } });
  check("which works", withNew.status === 200, `status=${withNew.status}`);
  const withOld = await api("/auth/login", { method: "POST", body: { email: student.email, password: "password123" } });
  check("and the old one does not", withOld.status === 401, `status=${withOld.status}`);

  const reused = await api("/auth/redeem-reset", { method: "POST", body: {
    email: student.email, code: issued.body.code, newPassword: "another-password-entirely" } });
  check("a code cannot be used twice", reused.status === 400, `status=${reused.status}`);

  const unknown = await api("/auth/redeem-reset", { method: "POST", body: {
    email: "nobody@example.com", code: "123456", newPassword: "brand-new-password" } });
  check("an address with no account gets the same answer as a wrong code",
    unknown.status === 400 && unknown.body?.error === wrongCode.body?.error,
    `${unknown.status} ${unknown.body?.error}`);

  console.log("\nReviewing a teacher's credentials\n");

  const applicant = await register("teacher", "New Teacher");
  // The account cannot honestly be approved without an identity document. Storage itself is
  // covered by the upload suites; this fixture begins where the support-desk workflow begins:
  // with a submitted document waiting for an operator to open and decide.
  sql(`insert into teacher_credentials
        (teacher_id, document_type, file_key, original_name, content_type, status)
       values
        (${applicant.user.id}, 'citizenship', 'ci/teacher-${applicant.user.id}/citizenship.pdf',
         'citizenship.pdf', 'application/pdf', 'submitted')`);
  const pending = await api("/admin/teachers/pending", { token: agent.token });
  /**
   * The queue is oldest-first, which is the right order for a queue and the wrong one to look
   * for the newest entry in — after enough runs the applicant is off the end of the page. So
   * the queue is checked for being a queue, and the applicant is looked up directly.
   */
  check("there is a review queue", (pending.body?.teachers ?? []).length > 0);
  check("and everybody in it is actually waiting",
    (pending.body?.teachers ?? []).every((t) => t.approvalStatus === "pending"));
  const applicantRecord = await api(`/admin/users/${applicant.user.id}`, { token: agent.token });
  check("the new teacher is waiting to be reviewed",
    applicantRecord.body?.teacherProfile?.approvalStatus === "pending",
    JSON.stringify(applicantRecord.body?.teacherProfile));
  const credentialId = applicantRecord.body?.credentials?.[0]?.id;
  check("the operator sees the submitted identity document", Number.isInteger(credentialId),
    JSON.stringify(applicantRecord.body?.credentials));

  const documentApproved = await api(`/admin/teacher-credentials/${credentialId}/decision`, {
    method: "POST", token: agent.token, body: { decision: "approved" },
  });
  check("the identity document can be approved", documentApproved.status === 200,
    `status=${documentApproved.status} ${JSON.stringify(documentApproved.body).slice(0, 160)}`);

  const bareRejection = await api(`/admin/teachers/${applicant.user.id}/decision`, { method: "POST", token: agent.token,
    body: { decision: "rejected" } });
  check("a rejection has to say why", bareRejection.status === 400, `status=${bareRejection.status}`);

  const approved = await api(`/admin/teachers/${applicant.user.id}/decision`, { method: "POST", token: agent.token,
    body: { decision: "approved" } });
  check("an approval goes through", approved.status === 200, `status=${approved.status}`);
  check("and is recorded on the profile",
    sql(`select approval_status from teacher_profiles where user_id=${applicant.user.id}`) === "approved");

  console.log("\nThe log an agent reads when nothing else answers it\n");

  const forUser = await api(`/admin/activity?userId=${student.user.id}`, { token: agent.token });
  check("everything one person did can be pulled up", (forUser.body?.rows ?? []).length > 0);
  check("and it says so was readable", forUser.body?.known === true);

  const forSession = await api(`/admin/activity?subjectType=session&subjectId=${sessionId}`, { token: agent.token });
  check("so can everything that happened to one class", (forSession.body?.rows ?? []).length > 0);
  check("agent actions are in there too",
    (await api(`/admin/activity?userId=${agent.user.id}`, { token: agent.token })).body?.rows?.some(
      (r) => String(r.action).startsWith("admin."),
    ));

  const logToStudent = await api(`/admin/activity?userId=${student.user.id}`, { token: student.token });
  check("and none of it is readable by anyone but an agent", logToStudent.status === 403, `status=${logToStudent.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
