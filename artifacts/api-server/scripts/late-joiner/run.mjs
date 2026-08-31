/**
 * What a student who joins a course late may read.
 *
 * The owner's decision, in their words: *"Let the Teacher have the ability to 'Pin' any
 * important messages that is available for anyone to see at any time — but hide any other prior
 * messages for students who enrolled late."*
 *
 * Both halves matter and they pull against each other, which is why they were asked for
 * together. A month of a class's conversation is other people's, and somebody joining on the
 * 20th walking into three weeks of it is being handed a room they were not in. But the things
 * that always matter — the timetable, the book to buy, where the class meets — must survive
 * that cut, or every new student has to ask again.
 *
 * Usage: PGURL=... API_URL=http://127.0.0.1:8080 node scripts/late-joiner/run.mjs
 */
import { execFileSync } from "node:child_process";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`  ok   ${n}`); } else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); } };
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t }; }
  return { status: r.status, body: b };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const email = `lj_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: role === "teacher" ? `Teacher ${seq}` : `Student ${seq}`,
    email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return { ...res.body, email };
}

const bodiesOf = (view) => (view?.messages ?? []).map((m) => m.body);
const pinnedOf = (view) => (view?.pinned ?? []).map((m) => m.body);

async function run() {
  console.log("\nA course with some history\n");

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
  await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  const made = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "Daily algebra", startMinute: 17 * 60, durationMinutes: 60,
    timeZone: "Asia/Kathmandu", monthlyPrice: 2000, maxStudents: 20 } });
  const classId = made.body?.id ?? made.body?.class?.id;
  check("the course exists", !!classId, JSON.stringify(made.body).slice(0, 160));

  const say = (token, body) => api(`/monthly/classes/${classId}/messages`, { method: "POST", token, body: { body } });

  await say(teacher.token, "Week one: we start at chapter 1.");
  const rule = await say(teacher.token, "Always bring your compass and a ruler.");
  await say(teacher.token, "Week two: chapter 2 tomorrow.");

  // Pinned *before* anybody joins late, which is the case that matters — the teacher marks the
  // thing that always applies, and it has to survive a cut made afterwards.
  const pinId = rule.body?.id;
  const pinned = await api(`/monthly/messages/${pinId}/pin`, { method: "PATCH", token: teacher.token, body: { pinned: true } });
  check("the teacher can pin a message", pinned.status === 200, `status=${pinned.status}`);

  console.log("\nSomebody who was there from the start\n");

  const early = await register("student");
  const joinedEarly = await api(`/monthly/classes/${classId}/join`, { method: "POST", token: early.token, body: { paymentMethod: "esewa" } });
  check("an early student joins", joinedEarly.status < 300, `status=${joinedEarly.status}`);

  /*
   * Backdated so this student genuinely predates the messages above. Joining is instantaneous
   * in a test, and a cut measured in milliseconds would pass for the wrong reason.
   */
  sql(`update recurring_enrollments set joined_at = now() - interval '10 days'
       where recurring_id = ${classId} and student_id = ${early.user.id}`);

  const earlyView = (await api(`/monthly/classes/${classId}/messages`, { token: early.token })).body;
  check("they see the whole conversation", bodiesOf(earlyView).length === 3, JSON.stringify(bodiesOf(earlyView)));

  console.log("\nSomebody who joins on the twentieth\n");

  await say(teacher.token, "Week three: revision.");

  const late = await register("student");
  const joinedLate = await api(`/monthly/classes/${classId}/join`, { method: "POST", token: late.token, body: { paymentMethod: "esewa" } });
  check("a late student joins", joinedLate.status < 300, `status=${joinedLate.status}`);

  // Everything above happened before them.
  sql(`update session_messages set created_at = now() - interval '1 day' where recurring_id = ${classId}`);

  await say(teacher.token, "Welcome to everyone who joined this week.");

  const lateView = (await api(`/monthly/classes/${classId}/messages`, { token: late.token })).body;
  const lateBodies = bodiesOf(lateView);

  check("they do not get the weeks before they arrived",
    !lateBodies.includes("Week one: we start at chapter 1.") && !lateBodies.includes("Week three: revision."),
    JSON.stringify(lateBodies));
  check("but they do see what was said after they joined",
    lateBodies.includes("Welcome to everyone who joined this week."), JSON.stringify(lateBodies));

  /*
   * The pairing the owner asked for. The pinned rule was written in week one — long before this
   * student existed — and is the one thing from back then they must still be able to read.
   */
  check("and the pinned message survives the cut",
    pinnedOf(lateView).includes("Always bring your compass and a ruler."), JSON.stringify(pinnedOf(lateView)));

  check("nothing they cannot read is offered as 'earlier'",
    (lateView?.earlier ?? 0) === 0, `earlier=${lateView?.earlier}`);

  console.log("\nAnd the teacher\n");

  const teacherView = (await api(`/monthly/classes/${classId}/messages`, { token: teacher.token })).body;
  check("the teacher still reads all of it — it is their class",
    bodiesOf(teacherView).length === 5, JSON.stringify(bodiesOf(teacherView)));
  check("and the early student is not cut either",
    bodiesOf((await api(`/monthly/classes/${classId}/messages`, { token: early.token })).body).length === 5);

  console.log("\nUnpinning\n");

  await api(`/monthly/messages/${pinId}/pin`, { method: "PATCH", token: teacher.token, body: { pinned: false } });
  const afterUnpin = (await api(`/monthly/classes/${classId}/messages`, { token: late.token })).body;
  check("an unpinned message goes back behind the cut",
    !pinnedOf(afterUnpin).includes("Always bring your compass and a ruler.") &&
    !bodiesOf(afterUnpin).includes("Always bring your compass and a ruler."),
    JSON.stringify({ pinned: pinnedOf(afterUnpin), messages: bodiesOf(afterUnpin) }));

  const asStudent = await api(`/monthly/messages/${pinId}/pin`, { method: "PATCH", token: late.token, body: { pinned: true } });
  check("and a student cannot pin anything", asStudent.status >= 400, `status=${asStudent.status}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

run().catch((err) => { console.error(err); process.exit(1); });
