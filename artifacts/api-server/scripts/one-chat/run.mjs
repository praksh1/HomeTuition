/**
 * One conversation per class, however you reach it.
 *
 * The owner's worry, in their words: *"users will get confused between which chat they're
 * using — one may write something in one chat and if they're not replying right away they may
 * reply in another link. I just don't want this to be confusing."*
 *
 * They were describing a real fault, not a labelling problem. The chat inside a lesson was
 * broadcast and never stored: it lived in memory and went with the room. So anything said
 * during a class disappeared, and the natural thing to do next was to say it again in the class
 * thread — two conversations about one lesson, neither complete.
 *
 * What is checked here is that there is now one. A message typed in the room lands in the
 * thread, and for a monthly class it lands in the **course's** thread rather than in one of
 * thirty daily ones — because a teacher saying "bring your compass tomorrow" should not have to
 * choose which day to say it in.
 *
 * Usage: PGURL=... API_URL=http://127.0.0.1:8080 node scripts/one-chat/run.mjs
 */
import { execFileSync } from "node:child_process";
import { WebSocket } from "ws";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");
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
  const email = `oc_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: role === "teacher" ? `Teacher ${seq}` : `Student ${seq}`,
    email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return { ...res.body, email };
}

/** Say something in the classroom the way the app does, and wait for it to come back. */
function sayInRoom(sessionId, token, text) {
  return new Promise((resolve, reject) => {
    // The upgrade handler answers on /api/ws; a sessionId is what makes it a classroom
    // connection rather than the signed-in user's own channel.
    const ws = new WebSocket(`${WS}/api/ws?sessionId=${sessionId}&token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("no reply from the room")); }, 12000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "chat", text })));
    ws.on("message", (raw) => {
      let m = null; try { m = JSON.parse(raw.toString()); } catch { return; }
      // The sender does not get their own message echoed, so the presence tick is the signal
      // that the socket is live and the send has been processed.
      if (m?.type === "presence" || m?.type === "chat") {
        clearTimeout(timer);
        setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 1500);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function run() {
  console.log("\nA one-off class\n");

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
  const soon = new Date(Date.now() + 60 * 1000).toISOString();
  const made = await api("/sessions", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "One-off", date: soon, duration: 60, maxStudents: 20, price: 500 } });
  const sessionId = made.body.id;

  await sayInRoom(sessionId, teacher.token, "Said during the lesson.");
  const kept = sql(`select count(*) from session_messages where session_id = ${sessionId} and body = 'Said during the lesson.'`);
  check("what is said in the room is kept", kept === "1", `rows=${kept}`);

  const thread = await api(`/sessions/${sessionId}/messages`, { token: teacher.token });
  const bodies = JSON.stringify(thread.body);
  check("and appears in the class thread, not a second conversation",
    bodies.includes("Said during the lesson."), bodies.slice(0, 200));

  console.log("\nA monthly class\n");

  await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  const klass = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "Daily algebra", startMinute: 17 * 60, durationMinutes: 60,
    timeZone: "Asia/Kathmandu", monthlyPrice: 2000, maxStudents: 20 } });
  const klassId = klass.body?.id ?? klass.body?.class?.id;
  check("a monthly class exists", !!klassId, JSON.stringify(klass.body).slice(0, 160));

  /*
   * Force today's class into existence rather than waiting for the sweep, then use it. The
   * point is which thread the message lands in, not when the row appears.
   */
  const dayId = sql(`select id from recurring_days where recurring_id = ${klassId} order by scheduled_for asc limit 1`);
  check("the class has a day to hold", !!dayId, `dayId=${dayId}`);

  await api(`/monthly/classes/${klassId}`, { token: teacher.token });
  const daySession = sql(`select coalesce(session_id::text, '') from recurring_days where id = ${dayId}`);
  check("and that day has become a real class", !!daySession, `session_id=${daySession}`);

  if (daySession) {
    await sayInRoom(Number(daySession), teacher.token, "Bring your compass tomorrow.");

    /*
     * The whole point. A message said in one day's room belongs to the course, not to that
     * day — otherwise a month of teaching is thirty conversations nobody can follow.
     */
    const onCourse = sql(`select count(*) from session_messages where recurring_id = ${klassId} and body = 'Bring your compass tomorrow.'`);
    check("a message said in a daily room joins the course's thread", onCourse === "1", `rows=${onCourse}`);

    const onDay = sql(`select count(*) from session_messages where session_id = ${daySession} and body = 'Bring your compass tomorrow.'`);
    check("and does not start a thread of its own for that day", onDay === "0", `rows=${onDay}`);

    const courseThread = await api(`/monthly/classes/${klassId}/messages`, { token: teacher.token });
    check("so it is there when the course chat is opened",
      JSON.stringify(courseThread.body).includes("Bring your compass tomorrow."),
      JSON.stringify(courseThread.body).slice(0, 220));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

run().catch((err) => { console.error(err); process.exit(1); });
