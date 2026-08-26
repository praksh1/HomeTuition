/**
 * A teacher who is going to be away, and the make-up they must not schedule into it.
 *
 * The owner's question: *"A teacher is planning to go out of town 2 weeks from now, can the
 * teacher schedule make up classes when he is out of town?"* Today they can, because nothing in
 * the app knows they are away — so cover for a class they missed lands on a day they will miss
 * too. One absence becomes two, and a student is told to turn up for a class nobody will hold.
 *
 * Marking leave deliberately does **not** cancel the daily classes inside it or excuse missing
 * them. Running a class for only part of a month is a separate, larger question and is parked;
 * see .agents/backlog/monthly-partial-months-and-dropping.md. What is checked here is the
 * narrow thing that was asked for, and that it does not quietly do more than that.
 *
 * Usage: PGURL=... API_URL=http://127.0.0.1:8080 node scripts/teacher-leave/run.mjs
 */
import { execFileSync } from "node:child_process";

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

const day = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

async function run() {
  console.log("\nA teacher with a class and a missed day\n");

  const email = `tl_${Date.now()}@example.com`;
  const teacher = (await api("/auth/register", { method: "POST", body: {
    name: "Away Teacher", email, password: "password123", role: "teacher", subject: "Maths", bio: "x" } })).body;
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
  await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  const made = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "Daily algebra", startMinute: 17 * 60, durationMinutes: 60,
    timeZone: "Asia/Kathmandu", monthlyPrice: 2000, maxStudents: 20 } });
  const classId = made.body?.id ?? made.body?.class?.id;
  check("the class exists", !!classId, JSON.stringify(made.body).slice(0, 140));

  // A day in the past, marked missed — the thing a make-up is for.
  sql(`insert into recurring_days (recurring_id, cycle_index, kind, scheduled_for, status, missed_at)
       values (${classId}, 0, 'regular', now() - interval '2 days', 'missed', now() - interval '2 days')`);
  const missedId = sql(`select id from recurring_days where recurring_id = ${classId} and status = 'missed' order by id desc limit 1`);
  check("and a missed class to make up", !!missedId, `id=${missedId}`);

  console.log("\nBooking the trip\n");

  const tripFrom = Date.now() + 14 * day;
  const tripTo = Date.now() + 21 * day;
  const booked = await api("/monthly/leave", { method: "POST", token: teacher.token, body: {
    startsAt: iso(tripFrom), endsAt: iso(tripTo), reason: "Wedding in Pokhara" } });
  check("a teacher can say when they are away", booked.status === 201, `status=${booked.status}`);
  check("and is told how many classes fall inside it",
    typeof booked.body?.classesInside === "number", JSON.stringify(booked.body).slice(0, 200));
  /*
   * The honest part: leave is not a licence. A teacher reading this should understand that the
   * classes are still theirs, because the rules have not changed — only the make-up guard has.
   */
  check("and told plainly that it excuses nothing",
    /does not cancel them or excuse missing them|No classes fall/.test(String(booked.body?.note)),
    String(booked.body?.note));

  const listed = await api("/monthly/leave", { token: teacher.token });
  check("the leave is listed back", (listed.body?.leave ?? []).length === 1, JSON.stringify(listed.body));

  console.log("\nThe make-up they must not schedule\n");

  const intoTrip = await api(`/monthly/classes/${classId}/makeups`, { method: "POST", token: teacher.token, body: {
    missedDayId: Number(missedId), at: iso(tripFrom + 2 * day) } });
  check("a make-up inside the trip is refused", intoTrip.status === 409, `status=${intoTrip.status}`);
  check("and says why, in the teacher's own words",
    /away then/i.test(String(intoTrip.body?.error)) && /Pokhara/.test(String(intoTrip.body?.error)),
    String(intoTrip.body?.error));
  check("and nothing was written for it",
    sql(`select count(*) from recurring_days where recurring_id = ${classId} and kind = 'makeup'`) === "0");

  const dayBefore = await api(`/monthly/classes/${classId}/makeups`, { method: "POST", token: teacher.token, body: {
    missedDayId: Number(missedId), at: iso(tripFrom - 2 * day) } });
  check("a day before the trip is accepted", dayBefore.status < 300, `status=${dayBefore.status} ${JSON.stringify(dayBefore.body).slice(0, 160)}`);

  console.log("\nTwo classes at once\n");

  sql(`delete from recurring_days where recurring_id = ${classId} and kind = 'makeup'`);
  const existing = sql(`select id from recurring_days where recurring_id = ${classId} and status = 'planned' order by scheduled_for asc limit 1`);
  const existingAt = sql(`select to_char(scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from recurring_days where id = ${existing}`);
  if (existingAt) {
    const clash = await api(`/monthly/classes/${classId}/makeups`, { method: "POST", token: teacher.token, body: {
      missedDayId: Number(missedId), at: existingAt } });
    check("a make-up on top of an existing class is refused", clash.status === 409, `status=${clash.status}`);
    check("and says so", /already a class at that time/i.test(String(clash.body?.error)), String(clash.body?.error));
  }

  console.log("\nWhat leave does not do\n");

  const inside = sql(`select count(*) from recurring_days
    where recurring_id = ${classId} and status = 'planned'
      and scheduled_for >= to_timestamp(${Math.floor(tripFrom / 1000)})
      and scheduled_for <= to_timestamp(${Math.floor(tripTo / 1000)})`);
  check("the classes inside the trip are still on the calendar", Number(inside) >= 0, `planned inside=${inside}`);
  check("none of them were cancelled by booking leave",
    sql(`select count(*) from recurring_days where recurring_id = ${classId} and status = 'cancelled'`) === "0");

  console.log("\nCancelling the trip\n");

  const leaveId = listed.body.leave[0].id;
  const removed = await api(`/monthly/leave/${leaveId}`, { method: "DELETE", token: teacher.token });
  check("leave can be withdrawn", removed.status === 200, `status=${removed.status}`);
  sql(`delete from recurring_days where recurring_id = ${classId} and kind = 'makeup'`);
  const nowAllowed = await api(`/monthly/classes/${classId}/makeups`, { method: "POST", token: teacher.token, body: {
    missedDayId: Number(missedId), at: iso(tripFrom + 2 * day) } });
  check("and then that day is bookable again", nowAllowed.status < 300, `status=${nowAllowed.status}`);

  const otherEmail = `tl2_${Date.now()}@example.com`;
  const other = (await api("/auth/register", { method: "POST", body: {
    name: "Other", email: otherEmail, password: "password123", role: "teacher", subject: "Maths", bio: "x" } })).body;
  const nosy = await api(`/monthly/leave/${leaveId}`, { method: "DELETE", token: other.token });
  check("and one teacher cannot delete another's leave", nosy.status === 404, `status=${nosy.status}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

run().catch((err) => { console.error(err); process.exit(1); });
