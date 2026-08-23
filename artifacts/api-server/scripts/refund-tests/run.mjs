/**
 * Moving a class, getting out of one, and the money that follows.
 *
 * Everything here is about somebody's money, so the standard is higher than usual: it is not
 * enough that the right thing happens, the arithmetic has to add up exactly and the same
 * request sent twice must not pay twice. Two rules get their own sections at the end for that
 * reason — the three shares always summing back to the price, and two simultaneous drops
 * producing one refund.
 *
 * Time is moved by editing the database rather than by waiting. A suite that has to sit for
 * 48 hours is a suite nobody runs.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/refund-tests/run.mjs
 */
import { execFileSync } from "node:child_process";

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
  // The address comes back with the account: half of these tests sign somebody in again, and
  // /auth/register does not echo it. Two earlier suites sent `undefined` here and failed with
  // "email and password are required", which reads exactly like a broken login.
  const email = `rf_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email,
    password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }),
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A class, by default far enough ahead that every rule here is satisfied. */
async function makeSession(teacher, { inDays = 10, price = 500, duration = 60, maxStudents = 10 } = {}) {
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Class ${++seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + inDays * DAY).toISOString(),
    duration, price, maxStudents,
  } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function book(student, sessionId) {
  const res = await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  if (res.status > 201) throw new Error(`book ${sessionId}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Move a class's start without going through the rules, to set up a state. */
function setStart(sessionId, ms) {
  sql(`update sessions set date = to_timestamp(${Math.round(ms / 1000)}) where id = ${sessionId}`);
}

/** Age a teacher's schedule changes out of this calendar month. */
function ageChanges(teacherId) {
  sql(`update schedule_changes set changed_at = changed_at - interval '70 days' where teacher_id = ${teacherId}`);
}

async function run() {
  console.log("\nMoving a class\n");

  const teacher = await register("teacher", "Ram Prasad");
  const student = await register("student", "Sita Sharma");
  const other = await register("student", "Bikash Thapa");
  const stranger = await register("teacher", "Someone Else");
  const agent = await makeAgent();

  {
    const s = await makeSession(teacher);
    const to = new Date(Date.now() + 12 * DAY).toISOString();
    const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { date: to } });
    check("a class more than two days away can be moved", moved.status === 200, `status=${moved.status} ${JSON.stringify(moved.body)}`);
    check("and it actually moved",
      new Date(moved.body?.date).getTime() === new Date(to).getTime(),
      `got ${moved.body?.date}`);
    check("and the move is on the record",
      sql(`select count(*) from schedule_changes where session_id = ${s.id}`) === "1");
  }

  {
    const s = await makeSession(teacher);
    setStart(s.id, Date.now() + 20 * HOUR);
    const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token,
      body: { date: new Date(Date.now() + 10 * DAY).toISOString() } });
    check("a class starting tomorrow cannot be moved", moved.status === 409, `status=${moved.status}`);
    check("and the refusal says why", /48 hours/.test(String(moved.body?.error)), String(moved.body?.error));
  }

  {
    const s = await makeSession(teacher);
    const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token,
      body: { date: new Date(Date.now() + 20 * HOUR).toISOString() } });
    check("a class cannot be moved to tomorrow", moved.status === 400, `status=${moved.status}`);
    check("because the students who booked need time to decide",
      /time to decide/.test(String(moved.body?.error)), String(moved.body?.error));
  }

  {
    const s = await makeSession(teacher);
    const same = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { date: s.date } });
    check("sending the same time back is accepted", same.status === 200, `status=${same.status}`);
    check("and spends nothing",
      sql(`select count(*) from schedule_changes where session_id = ${s.id}`) === "0");
  }

  {
    const s = await makeSession(teacher);
    const asStudent = await api(`/sessions/${s.id}`, { method: "PATCH", token: student.token,
      body: { date: new Date(Date.now() + 12 * DAY).toISOString() } });
    check("a student cannot move a class", asStudent.status === 403, `status=${asStudent.status}`);
    const asStranger = await api(`/sessions/${s.id}`, { method: "PATCH", token: stranger.token,
      body: { date: new Date(Date.now() + 12 * DAY).toISOString() } });
    check("nor can another teacher", asStranger.status === 403, `status=${asStranger.status}`);
  }

  {
    const s = await makeSession(teacher);
    sql(`update sessions set status = 'completed' where id = ${s.id}`);
    const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token,
      body: { date: new Date(Date.now() + 12 * DAY).toISOString() } });
    check("a class that has been held cannot be moved", moved.status === 409, `status=${moved.status}`);

    const c = await makeSession(teacher);
    sql(`update sessions set status = 'cancelled' where id = ${c.id}`);
    const movedCancelled = await api(`/sessions/${c.id}`, { method: "PATCH", token: teacher.token,
      body: { date: new Date(Date.now() + 12 * DAY).toISOString() } });
    check("nor can a cancelled one", movedCancelled.status === 409, `status=${movedCancelled.status}`);
  }

  console.log("\nFive changes a month, counted per change\n");

  {
    // A dedicated teacher: the allowance is per person per month, so a shared one would carry
    // whatever the tests above already spent.
    const quotaTeacher = await register("teacher", "Quota Kumar");
    ageChanges(quotaTeacher.user.id);

    // One class, moved five times. The owner was explicit that this spends the lot: "it is
    // strictly 5 edits for any session".
    const s = await makeSession(quotaTeacher);
    for (let i = 1; i <= 5; i += 1) {
      const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: quotaTeacher.token,
        body: { date: new Date(Date.now() + (10 + i) * DAY).toISOString() } });
      check(`change ${i} of five goes through`, moved.status === 200, `status=${moved.status} ${JSON.stringify(moved.body)}`);
    }

    const sixth = await api(`/sessions/${s.id}`, { method: "PATCH", token: quotaTeacher.token,
      body: { date: new Date(Date.now() + 20 * DAY).toISOString() } });
    check("the sixth is refused", sixth.status === 409, `status=${sixth.status}`);
    check("and says how many were allowed", sixth.body?.editsAllowed === 5, JSON.stringify(sixth.body));

    // The point of "per change": a different class is refused too, because the allowance
    // belongs to the teacher and not to the lesson.
    const fresh = await makeSession(quotaTeacher);
    const another = await api(`/sessions/${fresh.id}`, { method: "PATCH", token: quotaTeacher.token,
      body: { date: new Date(Date.now() + 20 * DAY).toISOString() } });
    check("and so is a change to a class that has never been moved", another.status === 409, `status=${another.status}`);

    // Everything else about a class stays editable — only the time is capped.
    const topic = await api(`/sessions/${fresh.id}`, { method: "PATCH", token: quotaTeacher.token, body: { topic: "New topic" } });
    check("but the topic can still be changed", topic.status === 200, `status=${topic.status}`);

    ageChanges(quotaTeacher.user.id);
    const nextMonth = await api(`/sessions/${fresh.id}`, { method: "PATCH", token: quotaTeacher.token,
      body: { date: new Date(Date.now() + 20 * DAY).toISOString() } });
    check("the allowance comes back next month", nextMonth.status === 200, `status=${nextMonth.status}`);
  }

  console.log("\nWhat the teacher is shown before they change anything\n");

  {
    const infoTeacher = await register("teacher", "Info Teacher");
    ageChanges(infoTeacher.user.id);
    const s = await makeSession(infoTeacher);
    const info = await api(`/sessions/${s.id}/schedule-info`, { token: infoTeacher.token });
    check("a teacher can see what they have left", info.status === 200, `status=${info.status}`);
    check("which is five, before they have moved anything", info.body?.editsLeft === 5, JSON.stringify(info.body));
    check("and that this class can be moved", info.body?.canMove === true);
    check("and that the price is not locked yet", info.body?.priceLocked === false);

    const notMine = await api(`/sessions/${s.id}/schedule-info`, { token: teacher.token });
    check("but not into somebody else's class", notMine.status === 403, `status=${notMine.status}`);

    await api(`/sessions/${s.id}`, { method: "PATCH", token: infoTeacher.token,
      body: { date: new Date(Date.now() + 15 * DAY).toISOString() } });
    const after = await api(`/sessions/${s.id}/schedule-info`, { token: infoTeacher.token });
    check("and the count goes down when one is spent", after.body?.editsLeft === 4, JSON.stringify(after.body));
    check("and the move is dated", typeof after.body?.lastMovedAt === "string");
  }

  console.log("\nWhat a teacher may not change once somebody has paid\n");

  {
    const s = await makeSession(teacher, { price: 500 });
    const before = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { price: 600 } });
    check("the price can be changed while nobody has bought it", before.status === 200, `status=${before.status}`);

    await book(student, s.id);
    const after = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { price: 900 } });
    check("but not after somebody has", after.status === 409, `status=${after.status}`);
    check("and the price really did not change",
      sql(`select price from sessions where id = ${s.id}`) === "600");

    const same = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { price: 600 } });
    check("sending the same price back is not a change", same.status === 200, `status=${same.status}`);

    const shrink = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { maxStudents: 0 } });
    check("a class cannot be shrunk to nothing", shrink.status === 400, `status=${shrink.status}`);
    const below = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { maxStudents: 0.5 } });
    check("nor to a fraction of a person", below.status === 400, `status=${below.status}`);
  }

  {
    const s = await makeSession(teacher, { maxStudents: 3 });
    await book(student, s.id);
    await book(other, s.id);
    const below = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { maxStudents: 1 } });
    check("a class cannot be shrunk below the people already in it", below.status === 409, `status=${below.status}`);
    const exact = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { maxStudents: 2 } });
    check("but it can be shrunk down to them", exact.status === 200, `status=${exact.status}`);
  }

  {
    const s = await makeSession(teacher, { duration: 60 });
    await book(student, s.id);
    setStart(s.id, Date.now() + 20 * HOUR);

    const shorter = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { duration: 45 } });
    check("a class can always be made shorter", shorter.status === 200, `status=${shorter.status}`);

    const longer = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { duration: 180 } });
    check("but not longer the night before, once somebody has paid", longer.status === 409, `status=${longer.status}`);

    const empty = await makeSession(teacher, { duration: 60 });
    setStart(empty.id, Date.now() + 20 * HOUR);
    const noneBooked = await api(`/sessions/${empty.id}`, { method: "PATCH", token: teacher.token, body: { duration: 180 } });
    check("a class nobody has bought can still be made longer", noneBooked.status === 200, `status=${noneBooked.status}`);
  }

  console.log("\nDropping a class you changed your mind about\n");

  {
    const s = await makeSession(teacher, { price: 500 });
    await book(student, s.id);

    const info = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("a student can ask what dropping would cost", info.status === 200, `status=${info.status}`);
    check("and is told they can", info.body?.canDrop === true, JSON.stringify(info.body));
    check("half comes back", info.body?.studentRefund === 250, JSON.stringify(info.body));
    check("a quarter to the teacher", info.body?.teacherShare === 125);
    check("a quarter to the platform", info.body?.platformShare === 125);
    check("the three add back to what was paid",
      info.body?.studentRefund + info.body?.teacherShare + info.body?.platformShare === 500);
    check("it is called a cancellation fee, not a processing fee",
      /cancellation fee/.test(String(info.body?.detail)) && !/processing fee/.test(String(info.body?.detail)),
      String(info.body?.detail));
    check("and the wait is stated up front",
      /5-7 business days/.test(String(info.body?.detail)), String(info.body?.detail));

    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("the drop goes through", dropped.status === 200, `status=${dropped.status} ${JSON.stringify(dropped.body)}`);
    check("the message says requested, never refunded",
      /requested/.test(String(dropped.body?.message)) && !/you have been refunded/i.test(String(dropped.body?.message)),
      String(dropped.body?.message));
    check("the enrolment stops being paid",
      sql(`select payment_status from session_enrollments where session_id=${s.id} and student_id=${student.user.id}`) === "refunded");
    check("and the seat goes back on sale",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "0");
    check("the debt is written down as owed",
      sql(`select status from refunds where session_id=${s.id} and student_id=${student.user.id}`) === "owed");
    check("for the right amount",
      sql(`select amount from refunds where session_id=${s.id} and student_id=${student.user.id}`) === "250");

    const again = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("dropping twice is refused", again.status === 409, `status=${again.status}`);
    check("and did not write a second refund",
      sql(`select count(*) from refunds where session_id=${s.id} and student_id=${student.user.id}`) === "1");

    // The seat really is for sale: somebody else can take it.
    const retaken = await api(`/sessions/${s.id}/book`, { method: "POST", token: other.token, body: { paymentMethod: "esewa" } });
    check("and another student can take the place", retaken.status <= 201, `status=${retaken.status}`);
    check("which puts the count back up",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "1");
  }

  {
    const s = await makeSession(teacher, { price: 501 });
    await book(student, s.id);
    const info = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("an odd price rounds in the student's favour", info.body?.studentRefund === 251, JSON.stringify(info.body));
    check("and still adds back exactly",
      info.body?.studentRefund + info.body?.teacherShare + info.body?.platformShare === 501,
      JSON.stringify(info.body));
  }

  {
    const s = await makeSession(teacher);
    await book(student, s.id);
    setStart(s.id, Date.now() + 20 * HOUR);
    const info = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("a class starting tomorrow cannot be dropped", info.body?.canDrop === false, JSON.stringify(info.body));
    check("and Support is offered instead", /Support/.test(String(info.body?.reason)), String(info.body?.reason));
    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("and the drop itself is refused", dropped.status === 409, `status=${dropped.status}`);
    check("with nothing written down",
      sql(`select count(*) from refunds where session_id=${s.id}`) === "0");
  }

  {
    const s = await makeSession(teacher);
    const notMine = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("a student who never booked cannot drop", notMine.status === 409, `status=${notMine.status}`);
    const asTeacher = await api(`/sessions/${s.id}/drop`, { method: "POST", token: teacher.token });
    check("and a teacher cannot drop their own class", asTeacher.status === 403, `status=${asTeacher.status}`);
  }

  console.log("\nDropping a class the teacher moved\n");

  {
    const moveTeacher = await register("teacher", "Moving Mohan");
    ageChanges(moveTeacher.user.id);
    const s = await makeSession(moveTeacher, { price: 500 });
    await book(student, s.id);

    const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: moveTeacher.token,
      body: { date: new Date(Date.now() + 15 * DAY).toISOString() } });
    check("the teacher moves it", moved.status === 200, `status=${moved.status}`);
    check("and the record says who it disrupted",
      sql(`select affected_students from schedule_changes where session_id=${s.id}`) === "1");

    const info = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("the student is offered the whole price back", info.body?.studentRefund === 500, JSON.stringify(info.body));
    check("with nothing kept by anyone",
      info.body?.teacherShare === 0 && info.body?.platformShare === 0, JSON.stringify(info.body));
    check("and told it is because the teacher moved it",
      /moved this class/.test(String(info.body?.headline)), String(info.body?.headline));

    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("and the drop pays the full price", dropped.body?.refund?.amount === 500, JSON.stringify(dropped.body));
    check("recorded as the teacher's doing, not the student's",
      sql(`select reason from refunds where session_id=${s.id}`) === "schedule_change");
  }

  {
    // The full-price window is 24 hours. After that the ordinary half applies again.
    const staleTeacher = await register("teacher", "Stale Sundar");
    ageChanges(staleTeacher.user.id);
    const s = await makeSession(staleTeacher, { price: 500 });
    await book(student, s.id);
    await api(`/sessions/${s.id}`, { method: "PATCH", token: staleTeacher.token,
      body: { date: new Date(Date.now() + 15 * DAY).toISOString() } });
    sql(`update schedule_changes set changed_at = changed_at - interval '25 hours' where session_id = ${s.id}`);
    const info = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("a day after the change, the full-price window has closed",
      info.body?.studentRefund === 250, JSON.stringify(info.body));
  }

  console.log("\nWhat a student who already left is shown\n");

  {
    const s = await makeSession(teacher, { price: 500 });
    await book(student, s.id);
    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("the drop this case depends on happened", dropped.status === 200, `status=${dropped.status}`);

    const after = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("they are told they have left, not that they were never here",
      after.body?.left === true, JSON.stringify(after.body));
    check("with the amount they are owed", after.body?.refundAmount === 250, JSON.stringify(after.body));
    check("and that it is requested rather than paid",
      after.body?.refundPaid === false && /requested/i.test(String(after.body?.detail)),
      String(after.body?.detail));
    check("no Drop button is offered to somebody already out", after.body?.canDrop === false);

    // Somebody who genuinely never booked must not be told any of this.
    const never = await api(`/sessions/${s.id}/drop-info`, { token: other.token });
    check("and somebody who never booked is not told about a refund",
      never.body?.left !== true && never.body?.enrolled === false, JSON.stringify(never.body));

    // Once an agent settles it, the wording follows.
    sql(`update refunds set status = 'paid', paid_at = now() where session_id = ${s.id} and student_id = ${student.user.id}`);
    const settled = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("once it is paid, they are told that instead",
      settled.body?.refundPaid === true && /has been paid/i.test(String(settled.body?.detail)),
      String(settled.body?.detail));
  }

  console.log("\nThe thread a refunded student can still read\n");

  {
    const s = await makeSession(teacher, { price: 500 });
    await book(student, s.id);
    await api(`/sessions/${s.id}/messages`, { method: "POST", token: teacher.token, body: { body: "Bring a ruler." } });
    await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });

    const read = await api(`/sessions/${s.id}/messages`, { token: student.token });
    check("a student who dropped can still read what was said", read.status === 200, `status=${read.status}`);
    check("and the message is still there",
      (read.body?.messages ?? []).some((m) => m.body === "Bring a ruler."), JSON.stringify(read.body));
    check("and the app is told to hide the composer", read.body?.readOnly === true, JSON.stringify(read.body));

    const post = await api(`/sessions/${s.id}/messages`, { method: "POST", token: student.token, body: { body: "hello" } });
    check("but they cannot post into a class they have left", post.status === 403, `status=${post.status}`);

    const outsider = await api(`/sessions/${s.id}/messages`, { token: stranger.token });
    check("and somebody who was never in it still sees nothing", outsider.status === 403, `status=${outsider.status}`);
  }

  console.log("\nCalling the class off entirely\n");

  {
    /**
     * The hole this closes: cancelling used to be the cheap way out of a class. No lock, no
     * allowance, no refund and no notification — the students who paid were left with a class
     * that had stopped existing, which made the whole regime for *moving* one pointless.
     */
    const offTeacher = await register("teacher", "Cancelling Chandra");
    ageChanges(offTeacher.user.id);
    const s = await makeSession(offTeacher, { price: 600 });
    await book(student, s.id);
    await book(other, s.id);

    const cancelled = await api(`/sessions/${s.id}`, { method: "PATCH", token: offTeacher.token,
      body: { status: "cancelled" } });
    check("a teacher can call off a class they cannot teach", cancelled.status === 200, `status=${cancelled.status}`);
    check("and everybody who paid is refunded",
      sql(`select count(*) from refunds where session_id=${s.id}`) === "2");
    check("in full, because it was not their doing",
      sql(`select distinct amount from refunds where session_id=${s.id}`) === "600");
    check("with nobody keeping a share",
      sql(`select distinct teacher_share || '/' || platform_share from refunds where session_id=${s.id}`) === "0/0");
    check("recorded as the teacher calling it off",
      sql(`select distinct reason from refunds where session_id=${s.id}`) === "teacher_cancelled");
    check("no enrolment is left reading as paid",
      sql(`select count(*) from session_enrollments where session_id=${s.id} and payment_status='paid'`) === "0");
    check("and the seats are all released",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "0");
    check("it spends none of the month's five changes",
      sql(`select count(*) from schedule_changes where teacher_id=${offTeacher.user.id}`) === "0");

    await api(`/sessions/${s.id}`, { method: "PATCH", token: offTeacher.token, body: { status: "cancelled" } });
    check("cancelling again pays nobody twice",
      sql(`select count(*) from refunds where session_id=${s.id}`) === "2");
  }

  {
    // Somebody who already dropped is not paid a second time by the cancellation.
    const offTeacher = await register("teacher", "Late Cancelling Laxman");
    ageChanges(offTeacher.user.id);
    const s = await makeSession(offTeacher, { price: 600 });
    await book(student, s.id);
    await book(other, s.id);
    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("the drop this case depends on happened", dropped.status === 200, `status=${dropped.status}`);

    await api(`/sessions/${s.id}`, { method: "PATCH", token: offTeacher.token, body: { status: "cancelled" } });
    check("a student who had already dropped is not refunded twice",
      sql(`select count(*) from refunds where session_id=${s.id} and student_id=${student.user.id}`) === "1");
    check("and still only gets the half they agreed to",
      sql(`select amount from refunds where session_id=${s.id} and student_id=${student.user.id}`) === "300");
    check("while the one still in the class gets all of it",
      sql(`select amount from refunds where session_id=${s.id} and student_id=${other.user.id}`) === "600");
  }

  {
    // A class that already happened is a dispute, not a cancellation. No automatic refund.
    const offTeacher = await register("teacher", "Afterwards Anil");
    const s = await makeSession(offTeacher, { price: 600 });
    await book(student, s.id);
    sql(`update sessions set status = 'completed' where id = ${s.id}`);
    await api(`/sessions/${s.id}`, { method: "PATCH", token: offTeacher.token, body: { status: "cancelled" } });
    check("cancelling a class that was already taught refunds nobody automatically",
      sql(`select count(*) from refunds where session_id=${s.id}`) === "0");
  }

  {
    /**
     * Booking and cancelling at the same instant.
     *
     * The narrow window: the cancel handler listed who had paid, and *then* wrote the status.
     * A booking committing in between was not on that list, so a student ended up paid into a
     * class that no longer existed, with no refund and no notification — the worst outcome this
     * whole feature exists to prevent, reachable by nothing more than bad timing.
     *
     * Both ends are closed now: the booking transaction re-reads the status under its own lock,
     * and the refund reads who has paid *after* the write. Either alone would leave a smaller
     * version of the same hole.
     */
    const raceTeacher = await register("teacher", "Racing Ramesh");
    ageChanges(raceTeacher.user.id);

    /**
     * Several buyers per round, not one.
     *
     * With a single booking the timing is too tidy: it always commits before the cancel reads
     * back who has paid, so the post-write re-read alone is enough and the lock re-check looks
     * redundant. It is not — it covers the other ordering, where a booking transaction is still
     * open when that read happens. Six at once makes some of them commit late, which is what
     * puts that half of the fix under test rather than taking it on trust.
     */
    const buyers = [];
    for (let i = 0; i < 6; i += 1) buyers.push(await register("student", `Buyer ${i}`));

    let stranded = 0;
    for (let round = 0; round < 8; round += 1) {
      const s = await makeSession(raceTeacher, { price: 400, maxStudents: 20 });
      // Fired together, so which lands first is genuinely up to the database.
      await Promise.all([
        ...buyers.map((b) =>
          api(`/sessions/${s.id}/book`, { method: "POST", token: b.token, body: { paymentMethod: "esewa" } })),
        api(`/sessions/${s.id}`, { method: "PATCH", token: raceTeacher.token, body: { status: "cancelled" } }),
      ]);
      // Anybody still reading as paid on a cancelled class has been stranded.
      const left = sql(
        `select count(*) from session_enrollments e join sessions x on x.id = e.session_id ` +
        `where e.session_id = ${s.id} and e.payment_status = 'paid' and x.status = 'cancelled'`,
      );
      stranded += Number(left);
    }
    check("nobody is left paid into a class that was cancelled underneath them",
      stranded === 0, `stranded=${stranded} across 8 rounds of 6`);
  }

  {
    /**
     * Everybody holding a paid place when a class moves is counted and told.
     *
     * Deterministic on purpose: the bookings are settled before the move is sent. The count on
     * the record is what a later argument about "they kept moving it" is read from, and it has
     * to match who was actually in the class.
     *
     * Not asserted here, because it cannot be forced reliably from outside: a booking that
     * commits in the instant *after* the move is not counted and is not told. The class still
     * exists and the drop quote still reads the change record, so the money is right and only
     * the notification is missed. Closing it properly means the booking checking the slot the
     * student actually agreed to, which needs the app to send it. Recorded in ISSUES.md.
     */
    const moveTeacher = await register("teacher", "Counting Kamal");
    ageChanges(moveTeacher.user.id);
    const s = await makeSession(moveTeacher, { price: 400, maxStudents: 20 });
    for (let i = 0; i < 5; i += 1) {
      const buyer = await register("student", `Counted ${i}`);
      await book(buyer, s.id);
    }

    const moved = await api(`/sessions/${s.id}`, { method: "PATCH", token: moveTeacher.token,
      body: { date: new Date(Date.now() + 14 * DAY).toISOString() } });
    check("the move goes through", moved.status === 200, `status=${moved.status}`);
    check("and the record names how many it disrupted",
      sql(`select affected_students from schedule_changes where session_id = ${s.id}`) === "5");
    check("which matches who was actually holding a place",
      sql(`select count(*) from session_enrollments where session_id = ${s.id} and payment_status = 'paid'`) === "5");
  }

  console.log("\nNonsense numbers are refused rather than rounded\n");

  {
    const s = await makeSession(teacher);
    for (const [field, value] of [["duration", 45.5], ["maxStudents", 3.5], ["price", 99.5]]) {
      const res = await api(`/sessions/${s.id}`, { method: "PATCH", token: teacher.token, body: { [field]: value } });
      check(`a fractional ${field} is refused, not rounded`, res.status === 400, `status=${res.status}`);
    }
    const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "Fractional", subject: "Maths", description: "d",
      date: new Date(Date.now() + 10 * DAY).toISOString(), duration: 60, price: 99.5, maxStudents: 10 } });
    check("and a new class cannot be created with one either", created.status === 400, `status=${created.status}`);
  }

  console.log("\nStill able to complain about it afterwards\n");

  {
    /**
     * The sequence this exists for: a student drops a class, the refund does not arrive, and
     * they want to chase it. Every filter on the way to Support asked for a *paid* enrolment,
     * so the class vanished from their support form at exactly the moment it became worth
     * reporting, leaving them only "Not session related".
     */
    const s = await makeSession(teacher, { price: 500 });
    await book(student, s.id);

    /**
     * Drop first, *then* age the class. The other order does not work and does not say so: a
     * class dated yesterday is inside the 24-hour deadline, so the drop is refused, the
     * enrolment stays paid, and every assertion below passes without testing anything. That is
     * how this was first written, and putting the paid-only filter back changed nothing.
     */
    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("the drop this section depends on actually happened", dropped.status === 200, `status=${dropped.status}`);
    check("and the enrolment really is refunded",
      sql(`select payment_status from session_enrollments where session_id=${s.id} and student_id=${student.user.id}`) === "refunded");

    // Yesterday, so it falls inside the seven days the support dropdown offers.
    sql(`update sessions set date = now() - interval '1 day' where id = ${s.id}`);

    const offered = await api("/support/sessions", { token: student.token });
    check("a dropped class is still in the support dropdown",
      (offered.body?.sessions ?? []).some((row) => row.id === s.id),
      JSON.stringify((offered.body?.sessions ?? []).map((r) => r.id)));

    const filed = await api("/disputes", { method: "POST", token: student.token, body: {
      sessionId: s.id, reason: "Payment Issue", description: "My refund has not arrived." } });
    check("and they can still file a report about it", filed.status <= 201, `status=${filed.status}`);

    const outsider = await api("/disputes", { method: "POST", token: other.token, body: {
      sessionId: s.id, reason: "Payment Issue", description: "Nothing to do with me." } });
    check("while somebody who was never in it still cannot", outsider.status === 403, `status=${outsider.status}`);
  }

  console.log("\nThe queue of what is owed\n");

  let owedRefundId = null;
  {
    const s = await makeSession(teacher, { price: 400 });
    await book(student, s.id);
    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    owedRefundId = dropped.body?.refund?.id;

    const asStudent = await api("/admin/refunds", { token: student.token });
    check("a student cannot see the refund queue", asStudent.status === 403, `status=${asStudent.status}`);
    const asTeacher = await api("/admin/refunds", { token: teacher.token });
    check("nor can a teacher", asTeacher.status === 403, `status=${asTeacher.status}`);

    // Filtered to this student. The queue is oldest-first and capped, so an unfiltered read is
    // only deterministic while the database is nearly empty — which it is not, by this point.
    const queue = await api(`/admin/refunds?studentId=${student.user.id}`, { token: agent.token });
    check("an agent can", queue.status === 200, `status=${queue.status}`);
    check("and is told whether it was readable", queue.body?.known === true);
    const row = (queue.body?.refunds ?? []).find((r) => r.id === owedRefundId);
    check("the drop is in the queue", !!row, JSON.stringify(queue.body?.refunds?.slice(0, 3)));
    check("with the student named", row?.studentName === "Sita Sharma", JSON.stringify(row));
    check("and the class named", typeof row?.topic === "string" && row.topic.length > 0);
    check("and a running total to pay out", typeof queue.body?.totalOwed === "number" && queue.body.totalOwed >= 200);

    const bare = await api(`/admin/refunds/${owedRefundId}/paid`, { method: "POST", token: agent.token, body: {} });
    check("marking one paid needs a reference", bare.status === 400, `status=${bare.status}`);
    check("and it stays owed",
      sql(`select status from refunds where id=${owedRefundId}`) === "owed");

    const paid = await api(`/admin/refunds/${owedRefundId}/paid`, { method: "POST", token: agent.token,
      body: { reference: "ESEWA-99881" } });
    check("with one, it is settled", paid.status === 200, `status=${paid.status}`);
    check("and who settled it is on the record",
      sql(`select paid_by from refunds where id=${owedRefundId}`) === String(agent.user.id));
    check("along with what to point at",
      sql(`select note from refunds where id=${owedRefundId}`) === "ESEWA-99881");
    check("and the agent's action is in the audit log",
      sql(`select count(*) from activity_log where action='admin.refund.paid' and subject_id=${owedRefundId}`) === "1");

    const twice = await api(`/admin/refunds/${owedRefundId}/paid`, { method: "POST", token: agent.token,
      body: { reference: "ESEWA-99882" } });
    check("paying it twice is refused", twice.status === 409, `status=${twice.status}`);

    const settled = await api(`/admin/refunds?status=paid&studentId=${student.user.id}`, { token: agent.token });
    check("and it moves to the settled list",
      (settled.body?.refunds ?? []).some((r) => r.id === owedRefundId));
    const stillOwed = await api(`/admin/refunds?studentId=${student.user.id}`, { token: agent.token });
    check("and off the one still to pay",
      !(stillOwed.body?.refunds ?? []).some((r) => r.id === owedRefundId));
  }

  console.log("\nA full refund an agent decides on\n");

  {
    const s = await makeSession(teacher, { price: 700 });
    await book(student, s.id);
    // The situation this exists for: a class that happened badly, argued about afterwards.
    sql(`update sessions set status = 'completed' where id = ${s.id}`);

    const bare = await api(`/admin/sessions/${s.id}/refund`, { method: "POST", token: agent.token,
      body: { studentId: student.user.id } });
    check("a full refund has to say why", bare.status === 400, `status=${bare.status}`);
    check("and the reason is what makes it reviewable",
      /outside the student's control/.test(String(bare.body?.error)), String(bare.body?.error));

    const notAStudent = await api(`/admin/sessions/${s.id}/refund`, { method: "POST", token: agent.token,
      body: { studentId: other.user.id, note: "power cut" } });
    check("and it cannot be given to somebody who was not in the class", notAStudent.status === 404, `status=${notAStudent.status}`);

    const granted = await api(`/admin/sessions/${s.id}/refund`, { method: "POST", token: agent.token,
      body: { studentId: student.user.id, note: "Teacher never joined; valley-wide power cut." } });
    check("with a reason, it goes through", granted.status === 200, `status=${granted.status} ${JSON.stringify(granted.body)}`);
    check("for the whole price", granted.body?.refund?.amount === 700, JSON.stringify(granted.body));
    check("with nobody keeping a share",
      granted.body?.refund?.teacherShare === 0 && granted.body?.refund?.platformShare === 0);
    check("recorded as a judgement rather than a rule",
      sql(`select reason from refunds where session_id=${s.id}`) === "agent_discretion");
    check("with the reason kept",
      sql(`select note from refunds where session_id=${s.id}`).includes("power cut"));
    check("and the agent's action logged",
      sql(`select count(*) from activity_log where action='admin.refund.granted' and subject_id=${s.id}`) === "1");
    check("a finished class does not have its attendance rewritten",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "1");

    const twice = await api(`/admin/sessions/${s.id}/refund`, { method: "POST", token: agent.token,
      body: { studentId: student.user.id, note: "again" } });
    check("and it cannot be granted twice", twice.status === 409, `status=${twice.status}`);

    const byStudent = await api(`/admin/sessions/${s.id}/refund`, { method: "POST", token: student.token,
      body: { studentId: student.user.id, note: "please" } });
    check("a student cannot grant themselves one", byStudent.status === 403, `status=${byStudent.status}`);
  }

  {
    // Granted before the class: the seat should go back on sale, unlike the finished case above.
    const s = await makeSession(teacher, { price: 700 });
    await book(student, s.id);
    const granted = await api(`/admin/sessions/${s.id}/refund`, { method: "POST", token: agent.token,
      body: { studentId: student.user.id, note: "Student hospitalised." } });
    check("a refund before the class goes through", granted.status === 200, `status=${granted.status}`);
    check("and that seat does go back on sale",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "0");
  }

  console.log("\nThe dashboard an agent opens first\n");

  {
    const overview = await api("/admin/overview", { token: agent.token });
    check("the desk counts what is owed", typeof overview.body?.refundsOwed === "number", JSON.stringify(overview.body));
    check("and how much", overview.body?.refundsOwedTotal > 0, JSON.stringify(overview.body));
  }

  console.log("\nTwo taps at once\n");

  {
    const s = await makeSession(teacher, { price: 500 });
    await book(student, s.id);
    // The real failure this guards: a student on a poor connection tapping Drop twice. Without
    // the guard both requests write a refund and the seat count drops by two.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token })),
    );
    const ok = results.filter((r) => r.status === 200).length;
    check("exactly one of six simultaneous drops succeeds", ok === 1, `succeeded=${ok}`);
    check("and exactly one refund is written",
      sql(`select count(*) from refunds where session_id=${s.id}`) === "1");
    check("and the seat count drops by exactly one",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "0");
  }

  {
    const quotaTeacher = await register("teacher", "Racing Rita");
    ageChanges(quotaTeacher.user.id);
    const classes = await Promise.all(Array.from({ length: 8 }, () => makeSession(quotaTeacher)));
    // Eight moves fired at once against an allowance of five. Some may lose the race and be
    // refused, but the count must never end up above five.
    await Promise.all(classes.map((s, i) =>
      api(`/sessions/${s.id}`, { method: "PATCH", token: quotaTeacher.token,
        body: { date: new Date(Date.now() + (11 + i) * DAY).toISOString() } })));
    const used = Number(sql(`select count(*) from schedule_changes where teacher_id = ${quotaTeacher.user.id}`));
    check("simultaneous moves cannot push a teacher past the allowance", used <= 5, `used=${used}`);
    check("and at least some of them went through", used > 0, `used=${used}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
