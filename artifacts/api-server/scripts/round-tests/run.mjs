/**
 * The bugs from the fourth testing round, each pinned so it cannot come back.
 *
 * All four were reachable by a real person in a browser, and three of them chained: a teacher
 * created a class in the past, it sat in Upcoming saying "Session Expired", a student bought
 * it, and the class page told them their teacher was 2,279 minutes late and offered a refund
 * form for a lesson that was never going to happen.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/round-tests/run.mjs
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
  const email = `rd_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function makeSession(teacher, { inDays = 10, price = 500, duration = 60 } = {}) {
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Round ${++seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + inDays * DAY).toISOString(),
    duration, price, maxStudents: 10 } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function run() {
  console.log("\nA class cannot be created in the past\n");

  const teacher = await register("teacher", "Ram Prasad");
  const student = await register("student", "Sita Sharma");
  const other = await register("student", "Bikash Thapa");

  {
    for (const [label, when] of [
      ["yesterday", new Date(Date.now() - DAY)],
      ["two days ago", new Date(Date.now() - 2 * DAY)],
      ["an hour ago", new Date(Date.now() - 60 * MIN)],
    ]) {
      const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
        topic: "Backdated", subject: "Maths", description: "d",
        date: when.toISOString(), duration: 60, price: 500, maxStudents: 10 } });
      check(`a class dated ${label} is refused`, res.status === 400, `status=${res.status}`);
      check(`and the refusal says why (${label})`,
        /in the past/i.test(String(res.body?.error)), String(res.body?.error));
    }

    // "Create & Go Live Now" sends the current time, so that has to keep working. The grace
    // exists for exactly this: a strict comparison would reject the teacher's own clock.
    const now = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "Right now", subject: "Maths", description: "d",
      date: new Date().toISOString(), duration: 60, price: 500, maxStudents: 10 } });
    check("but a class starting right now still works", now.status <= 201, `status=${now.status} ${JSON.stringify(now.body)}`);

    const soon = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "In a minute", subject: "Maths", description: "d",
      date: new Date(Date.now() + MIN).toISOString(), duration: 60, price: 500, maxStudents: 10 } });
    check("and so does one a minute from now", soon.status <= 201, `status=${soon.status}`);
  }

  console.log("\nA class that has started cannot be bought\n");

  {
    const s = await makeSession(teacher, { price: 500 });
    // Aged past its start the only way a class legitimately gets there.
    sql(`update sessions set date = now() - interval '2 days' where id = ${s.id}`);

    const booked = await api(`/sessions/${s.id}/book`, { method: "POST", token: student.token,
      body: { paymentMethod: "esewa" } });
    check("a class from two days ago cannot be booked", booked.status === 409, `status=${booked.status}`);
    check("and the refusal says it has started",
      /already started/i.test(String(booked.body?.error)), String(booked.body?.error));
    check("nothing was written",
      sql(`select count(*) from session_enrollments where session_id=${s.id}`) === "0");
    check("and no money was taken",
      sql(`select enrolled_count from sessions where id=${s.id}`) === "0");
  }

  {
    // The boundary: a minute before the start is still on sale, a minute after is not.
    const s = await makeSession(teacher, { price: 500 });
    sql(`update sessions set date = now() + interval '1 minute' where id = ${s.id}`);
    const justInTime = await api(`/sessions/${s.id}/book`, { method: "POST", token: student.token,
      body: { paymentMethod: "esewa" } });
    check("a class a minute away can still be booked", justInTime.status <= 201, `status=${justInTime.status}`);

    const t = await makeSession(teacher, { price: 500 });
    sql(`update sessions set date = now() - interval '1 minute' where id = ${t.id}`);
    const justTooLate = await api(`/sessions/${t.id}/book`, { method: "POST", token: other.token,
      body: { paymentMethod: "esewa" } });
    check("a class a minute past its start cannot", justTooLate.status === 409, `status=${justTooLate.status}`);
  }

  console.log("\nThe Subscribe button knows whether you already subscribed\n");

  {
    const followTeacher = await register("teacher", "Followed Farhan");
    const profileId = sql(`select id from teacher_profiles where user_id = ${followTeacher.user.id}`);
    check("the teacher has a profile to follow", !!profileId, `profileId=${profileId}`);

    const before = await api(`/teachers/${profileId}`, { token: student.token });
    check("before following, it says so", before.body?.isFollowing === false, JSON.stringify(before.body?.isFollowing));

    const followed = await api(`/teachers/${profileId}/follow`, { method: "POST", token: student.token, body: {} });
    check("following works", followed.status <= 201, `status=${followed.status}`);

    /**
     * The bug: this used to come from a `?studentId=` query parameter carrying the student's
     * *profile* row id, while the table keys on their *users* row id. So it was false on every
     * reload — green on the tap, grey again the moment the screen was rebuilt.
     */
    const after = await api(`/teachers/${profileId}`, { token: student.token });
    check("and afterwards the server says you are following", after.body?.isFollowing === true,
      JSON.stringify(after.body?.isFollowing));

    // The profile id and the user id are different numbers, which is what made this hide.
    check("the two ids really are different, which is why this hid",
      String(profileId) !== String(followTeacher.user.id),
      `profile=${profileId} user=${followTeacher.user.id}`);

    const someoneElse = await api(`/teachers/${profileId}`, { token: other.token });
    check("another student is not shown as following", someoneElse.body?.isFollowing === false,
      JSON.stringify(someoneElse.body?.isFollowing));

    const signedOut = await api(`/teachers/${profileId}`);
    check("and somebody signed out is not either", signedOut.body?.isFollowing === false,
      JSON.stringify(signedOut.body?.isFollowing));

    // It must survive a fresh sign-in, which is the case the owner actually reported.
    const again = await api("/auth/login", { method: "POST", body: { email: student.email, password: "password123" } });
    const fresh = await api(`/teachers/${profileId}`, { token: again.body?.token });
    check("it survives signing out and back in", fresh.body?.isFollowing === true,
      JSON.stringify(fresh.body?.isFollowing));

    await api(`/teachers/${profileId}/follow`, { method: "DELETE", token: student.token });
    const unfollowed = await api(`/teachers/${profileId}`, { token: student.token });
    check("and unfollowing turns it off again", unfollowed.body?.isFollowing === false,
      JSON.stringify(unfollowed.body?.isFollowing));

    /**
     * It was also a leak. Whether a named student follows a named teacher was answerable by
     * anybody who could put a number in a URL, because identity came from the query rather
     * than the token.
     */
    const probe = await api(`/teachers/${profileId}?studentId=${student.user.id}`, { token: other.token });
    check("and a stranger cannot probe somebody else's subscription with a query parameter",
      probe.body?.isFollowing === false, JSON.stringify(probe.body?.isFollowing));
  }

  console.log("\nA dropped class stays in the student's list\n");

  {
    const dropTeacher = await register("teacher", "Dropped Deepak");
    const s = await makeSession(dropTeacher, { price: 500 });
    await api(`/sessions/${s.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

    const before = await api(`/sessions?studentId=${student.user.id}&limit=50`);
    const listedBefore = (before.body?.sessions ?? []).find((row) => row.id === s.id);
    check("it is in the list while they hold it", !!listedBefore);
    check("tagged as paid", listedBefore?.enrolment === "paid", JSON.stringify(listedBefore?.enrolment));

    const dropped = await api(`/sessions/${s.id}/drop`, { method: "POST", token: student.token });
    check("the drop goes through", dropped.status === 200, `status=${dropped.status}`);

    const after = await api(`/sessions?studentId=${student.user.id}&limit=50`);
    const listedAfter = (after.body?.sessions ?? []).find((row) => row.id === s.id);
    check("and it is still in the list after dropping", !!listedAfter,
      JSON.stringify((after.body?.sessions ?? []).map((r) => r.id)));
    check("now tagged as dropped", listedAfter?.enrolment === "refunded", JSON.stringify(listedAfter?.enrolment));

    const info = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("its page says how much is owed", info.body?.refundAmount === 250, JSON.stringify(info.body));
    check("and how many business days are left",
      typeof info.body?.businessDaysLeft === "number" && info.body.businessDaysLeft > 0,
      JSON.stringify(info.body?.businessDaysLeft));
    check("counted from the promise, not made up",
      info.body?.businessDaysTotal === 7, JSON.stringify(info.body?.businessDaysTotal));

    // A week of business days later, the window is spent and the number stops at zero.
    sql(`update refunds set requested_at = now() - interval '20 days' where session_id = ${s.id}`);
    const late = await api(`/sessions/${s.id}/drop-info`, { token: student.token });
    check("once the window has passed it reads zero rather than going negative",
      late.body?.businessDaysLeft === 0, JSON.stringify(late.body?.businessDaysLeft));

    // Someone who never booked still sees nothing of any of this.
    const stranger = await api(`/sessions?studentId=${other.user.id}&limit=50`);
    check("and it is not in anybody else's list",
      !(stranger.body?.sessions ?? []).some((row) => row.id === s.id));
  }

  console.log("\nAn unpaid enrolment still never appears\n");

  {
    // The original reason for the paid-only filter, which must survive letting `refunded` in.
    const s = await makeSession(teacher, { price: 500 });
    sql(`insert into session_enrollments (session_id, student_id, payment_status) ` +
        `values (${s.id}, ${other.user.id}, 'pending')`);
    const list = await api(`/sessions?studentId=${other.user.id}&limit=50`);
    check("a pending enrolment is not a class you own",
      !(list.body?.sessions ?? []).some((row) => row.id === s.id),
      JSON.stringify((list.body?.sessions ?? []).map((r) => r.id)));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
