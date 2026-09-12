/** Real API + disposable PostgreSQL. No shared database, real payment, or media service. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocket } from "ws";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const serverRoot = path.join(root, "artifacts/api-server");
const requireDb = createRequire(path.join(root, "lib/db/package.json"));
const { Pool } = requireDb("pg");
const url = process.env.PGURL ?? process.env.DATABASE_URL;
assert.ok(url && ["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname), "Only a disposable local PostgreSQL database is allowed");
const pool = new Pool({ connectionString: url });
const q = (text, values = []) => pool.query(text, values);
let port = Number(process.env.BATCH_TEST_PORT ?? 8118);
let child, log = "", passed = 0;
const until = new Date(Date.now() + 120 * 86400000).toISOString();
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
async function api(route, token, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, headers: { "Content-Type": "application/json", "X-Fadko-Platform": "web", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  return { status: response.status, body: result };
}
async function start(extra = {}) {
  log = "";
  child = spawn(process.execPath, [path.join(serverRoot, "dist/index.mjs")], { cwd: root, env: { ...process.env, DATABASE_URL: url, PORT: String(port), NODE_ENV: "test", SESSION_SECRET: "batch-test-only-secret", PAYMENT_WEBHOOK_SECRET: "synthetic-gateway-configured", VIDEO_PROVIDER: "echo", ALLOW_TEST_TEACHING_ACCESS: "true", ALLOW_TEST_STUDENT_ACCESS: "true", TEST_ACCESS_UNTIL: until, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => { log += data; }); child.stderr.on("data", (data) => { log += data; });
  for (let i = 0; i < 100; i++) {
    try {
      const health = await api("/healthz");
      if (health.status === 200 && log.includes("learning program and test-booking tables are present")) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Test API did not initialize: ${log.slice(-6000)}`);
}
async function stop() {
  if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await exited; }
}
async function account(role, grant = true) {
  const registered = await api("/auth/register", null, { name: `Test ${role}`, email: `${randomUUID()}@example.com`, password: "Synthetic-password-123!", role, ...(role === "teacher" ? { subject: "Mathematics", bio: "Testing tuition classes." } : { grade: "10", dateOfBirth: "2000-01-01" }) });
  assert.ok(registered.status < 300, JSON.stringify(registered));
  const a = registered.body;
  await q("UPDATE account_security SET email_verified_at=now() WHERE user_id=$1", [a.user.id]);
  await q("INSERT INTO user_onboarding (user_id,completed_at) VALUES ($1,now()) ON CONFLICT (user_id) DO UPDATE SET completed_at=now()", [a.user.id]);
  if (role === "teacher") await q("UPDATE teacher_profiles SET approval_status='approved', subscription_active=false WHERE user_id=$1", [a.user.id]);
  if (grant) await grantAccount(a, role);
  return a;
}
async function grantAccount(a, role) {
  if (role === "teacher") await q("INSERT INTO test_teaching_grants (teacher_id,tier,reason,valid_until) VALUES ($1,'base','Synthetic pilot test',$2)", [a.user.id, until]);
  else await q("INSERT INTO test_student_grants (student_id,reason,valid_until) VALUES ($1,'Synthetic pilot test',$2)", [a.user.id, until]);
}
const versions = (item) => ({ expectedUpdatedAt: item.batch.updatedAt, expectedProgramUpdatedAt: item.programUpdatedAt });
function nepalLesson(at) {
  const wall = new Date(at + 345 * 60000).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16), durationMinutes: 30 };
}
async function offer(teacher, { capacity = 2, at = Math.ceil(Date.now() / 60000) * 60000 + 5 * 60000, extra = {} } = {}) {
  const body = { requestKey: randomUUID(), format: "fixed", title: "Test SEE Mathematics class", summary: "Practise algebra together and discuss worked examples with the teacher.", teachingLanguage: "Nepali", outline: "", capacity, totalTuitionNpr: 6000, lessons: [nepalLesson(at), nepalLesson(at + 86400000)], ...extra };
  const made = await api("/teaching-classes", teacher.token, body); assert.equal(made.status, 201, JSON.stringify(made));
  const pub = await api(`/teaching-classes/${made.body.item.batch.id}/publish`, teacher.token, versions(made.body.item)); assert.equal(pub.status, 200, JSON.stringify(pub));
  return { item: pub.body.item, body, id: pub.body.item.batch.id };
}
async function quote(id, a) { const result = await api(`/batch-tests/${id}`, a.token); assert.equal(result.status, 200, JSON.stringify(result)); return result.body; }
const book = (id, a, key, outcome = "success") => api(`/batch-tests/${id}`, a.token, { quoteKey: key, gateway: "fadko_test", outcome });
async function socketAccepted(token, id) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws?sessionId=${id}&token=${encodeURIComponent(token)}&name=Test`);
    const timer = setTimeout(() => done(false), 3000);
    function done(value) { clearTimeout(timer); ws.close(); resolve(value); }
    ws.on("error", () => done(false)); ws.on("close", () => done(false)); ws.on("open", () => done(true));
  });
}
try {
  await start();
  const teacher = await account("teacher"), a = await account("student"), b = await account("student"), outsider = await account("student", false);
  const operator = await account("student", false);
  await q("UPDATE users SET role='admin' WHERE id=$1", [operator.user.id]);
  const operatorLogin = await api("/auth/login", null, { email: operator.user.email, password: "Synthetic-password-123!" });
  assert.equal(operatorLogin.status, 200, JSON.stringify(operatorLogin));
  const operatorToken = operatorLogin.body.token;
  check("student cannot grant a four-month bypass", (await api(`/admin/students/${outsider.user.id}/test-access`, a.token, { reason: "Test", throughPilot: true })).status === 403);
  const pilotStudent = await account("student", false), pilotTeacher = await account("teacher", false);
  const longStudent = await api(`/admin/students/${pilotStudent.user.id}/test-access`, operatorToken, { reason: "Owner-authorized fixed pilot", throughPilot: true });
  check("operator can grant student access through fixed deadline", longStudent.status === 201 && longStudent.body.grant.validUntil === until);
  const longTeacher = await api(`/admin/teachers/${pilotTeacher.user.id}/test-access`, operatorToken, { reason: "Owner-authorized fixed pilot", tier: "base", throughPilot: true });
  check("operator can grant teacher access through fixed deadline", longTeacher.status === 201 && longTeacher.body.grant.validUntil === until);
  const c = await offer(teacher);
  check("test button advertised only by configured server", (await api(`/programs/${c.item.batch.programId}/batches`)).body.batches[0].testPilotEndsAt === until);
  check("anonymous cannot quote", (await api(`/batch-tests/${c.id}`)).status === 401);
  check("no student grant refused", (await api(`/batch-tests/${c.id}`, outsider.token)).status === 403);
  const proposal = await quote(c.id, a);
  check("old free-booking shortcut refused", (await api(`/batch-tests/${c.id}`, a.token, { quoteKey: proposal.quoteKey })).status === 400);
  check("declined test payment leaves no place or financial record", (await book(c.id, a, proposal.quoteKey, "declined")).status === 402 && Number((await q("SELECT count(*) n FROM batch_test_bookings WHERE batch_id=$1", [c.id])).rows[0].n) === 0);
  check("quote is a price illustration, never a receipt", proposal.testOnly && proposal.paymentCollectedNpr === 0 && proposal.quote.amountNpr === 6000 && proposal.lessons.length === 0);
  check("invented quote refused", (await book(c.id, a, "0".repeat(64))).status === 409);
  check("teacher cannot book own class", (await book(c.id, teacher, proposal.quoteKey)).status === 403);
  const replies = await Promise.all([book(c.id, a, proposal.quoteKey), book(c.id, a, proposal.quoteKey)]);
  check("concurrent retry books exactly once", replies.every((r) => r.status === 200) && replies.filter((r) => r.body.created).length === 1);
  const booked = replies[0].body;
  check("success returns frozen simulated 70/30 receipt", booked.receipts.length === 1 && booked.receipts[0].grossNpr === 6000 && booked.receipts[0].teacherNpr === 4200 && booked.receipts[0].fadkoNpr === 1800 && booked.receipts[0].actualMoneyCollectedNpr === 0);
  check("concurrent retry creates only one capture", Number((await q("SELECT count(*) n FROM batch_test_payments p JOIN batch_test_bookings b ON b.id=p.booking_id WHERE b.batch_id=$1", [c.id])).rows[0].n) === 1);
  check("teacher can read simulated ledger for own class", (await quote(c.id, teacher)).receipts.length === 1);
  check("operator sees simulated capture", (await api("/admin/batch-test-payments", operatorToken)).body.receipts.some(r => r.reference === booked.receipts[0].reference && r.grossNpr === 6000));
  check("student cannot read operator ledger", (await api("/admin/batch-test-payments", a.token)).status === 403);
  check("teacher cannot read operator ledger", (await api("/admin/batch-test-payments", teacher.token)).status === 403);
  check("another student cannot read first student's receipt", (await quote(c.id, b)).receipts.length === 0);
  await assert.rejects(q("UPDATE batch_test_payments SET receipt='{}' WHERE booking_id=(SELECT id FROM batch_test_bookings WHERE batch_id=$1 AND student_id=$2)", [c.id, a.user.id]), /SIMULATED_RECEIPT_IMMUTABLE/); passed++; console.log("PASS simulated capture cannot be rewritten");
  check("real lesson IDs materialised", booked.booked && booked.lessons.length === 2 && booked.lessons.every((l) => Number.isInteger(l.sessionId)));
  let rows = (await q("SELECT e.*,s.enrolled_count,s.price FROM session_enrollments e JOIN sessions s ON s.id=e.session_id JOIN batch_test_sessions bt ON bt.session_id=s.id WHERE bt.batch_id=$1", [c.id])).rows;
  check("no charged/paid/reference rows or duplicate enrolments", rows.length === 2 && rows.every((r) => r.payment_status === "test" && r.payment_method === "test_access" && r.payment_reference === null && r.enrolled_count === 1 && r.price === 0));
  const sid = booked.lessons[0].sessionId;
  check("individual free-lesson endpoint cannot bypass batch booking", (await api(`/sessions/${sid}/book`, outsider.token, { paymentMethod: "test_access" })).status === 409);
  check("unenrolled room refused", (await api(`/sessions/${sid}/room`, outsider.token)).status === 403);
  check("booked room uses existing membership", (await api(`/sessions/${sid}/room`, a.token)).status === 200);
  check("booked whiteboard socket admitted", await socketAccepted(a.token, sid));
  check("unenrolled whiteboard socket refused", !await socketAccepted(outsider.token, sid));
  const updated = (await api(`/teaching-classes/${c.id}`, teacher.token)).body.item;
  check("owner receives locked state without self schedule conflicts", updated.batch.bookingLocked && updated.batch.scheduleConflicts.length === 0);
  check("simple editor cannot change booked promise", (await api(`/teaching-classes/${c.id}`, teacher.token, { ...c.body, ...versions(updated), totalTuitionNpr: 1 }, "PATCH")).status === 409);
  check("older batch close cannot hide booked class", (await api(`/learning-program-batches/${c.id}/close`, teacher.token, {})).status === 409);
  await assert.rejects(q("UPDATE sessions SET duration=1 WHERE id=$1", [sid]), /BATCH_TEST_LOCKED/); passed++; console.log("PASS database protects old session editing path");
  await assert.rejects(q("UPDATE session_enrollments SET payment_status='paid' WHERE session_id=$1", [sid]), /BATCH_TEST_BOOKING_REQUIRED/); passed++; console.log("PASS database forbids false paid conversion");
  await assert.rejects(q("UPDATE learning_programs SET title='Changed after booking' WHERE id=$1", [c.item.batch.programId]), /BATCH_TEST_LOCKED/); passed++; console.log("PASS booked description cannot be replaced");
  await assert.rejects(q("DELETE FROM learning_program_batch_lessons WHERE batch_id=$1", [c.id]), /BATCH_TEST_LOCKED/); passed++; console.log("PASS booked timetable cannot be deleted");
  check("teacher can still start the scheduled call", (await api(`/sessions/${sid}`, teacher.token, { status: "live" }, "PATCH")).status === 200);
  const qb = await quote(c.id, b);
  check("second student shares the same lesson rooms", (await book(c.id, b, qb.quoteKey)).body.lessons[0].sessionId === sid);
  await grantAccount(outsider, "student");
  const qo = await quote(c.id, outsider);
  check("capacity remains enforced", (await book(c.id, outsider, qo.quoteKey)).status === 409);
  check("no duplicate lesson rows for second student", Number((await q("SELECT count(*) n FROM batch_test_sessions WHERE batch_id=$1", [c.id])).rows[0].n) === 2);
  const secondTeacher = await account("teacher");
  const clash = await offer(secondTeacher, { at: Date.parse(booked.lessons[0].startsAt) });
  const qc = await quote(clash.id, a);
  check("student timetable conflict refused atomically", (await book(clash.id, a, qc.quoteKey)).status === 409 && Number((await q("SELECT count(*) n FROM batch_test_contracts WHERE batch_id=$1", [clash.id])).rows[0].n) === 0);
  await q("UPDATE users SET suspended_at=now() WHERE id=$1", [a.user.id]);
  check("current suspension overrides a still-valid token", (await api(`/batch-tests/${c.id}`, a.token)).status === 403);
  await q("UPDATE users SET suspended_at=NULL WHERE id=$1", [a.user.id]);
  const raceClass = await offer(secondTeacher, { capacity: 1, at: Date.now() + 3 * 86400000 });
  const raceA = await quote(raceClass.id, a), raceB = await quote(raceClass.id, b);
  const race = await Promise.all([book(raceClass.id, a, raceA.quoteKey), book(raceClass.id, b, raceB.quoteKey)]);
  check("concurrent last seat is sold to exactly one test student", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 1);
  const stale = await offer(secondTeacher, { at: Date.now() + 6 * 86400000 });
  const oldQuote = await quote(stale.id, outsider);
  const revised = await api(`/teaching-classes/${stale.id}`, secondTeacher.token, { ...stale.body, ...versions(stale.item), totalTuitionNpr: 6500 }, "PATCH");
  assert.equal(revised.status, 200, JSON.stringify(revised));
  assert.equal((await api(`/teaching-classes/${stale.id}/publish`, secondTeacher.token, versions(revised.body.item))).status, 200);
  check("a real republish invalidates the old quote", (await book(stale.id, outsider, oldQuote.quoteKey)).status === 409);
  const lateTeacher = await account("teacher");
  const lateClass = await offer(lateTeacher, { at: Date.now() + 10 * 86400000, extra: { format: "ongoing", allowLateJoining: true } });
  // Advance this synthetic fixture to mid-period without changing the real server clock.
  const snapshot = structuredClone(lateClass.item.batch.published);
  snapshot.lessons[0].startsAt = new Date(Date.now() - 86400000).toISOString();
  snapshot.lessons[1].startsAt = new Date(Date.now() + 9 * 86400000).toISOString();
  snapshot.tuitionPeriod.startsAt = snapshot.lessons[0].startsAt;
  snapshot.tuitionPeriod.endsAt = new Date(Date.parse(snapshot.tuitionPeriod.startsAt) + 30 * 86400000).toISOString();
  snapshot.enrollmentClosesAt = snapshot.lessons.at(-1).startsAt;
  await q("UPDATE learning_program_batches SET published_snapshot=$2 WHERE id=$1", [lateClass.id, JSON.stringify(snapshot)]);
  const lateQuote = await quote(lateClass.id, outsider);
  check("mid-period quote excludes started lessons and prorates once", lateQuote.quote.status === "remaining_lessons" && lateQuote.quote.amountNpr === 3000 && lateQuote.quote.lessonPositions.length === 1 && lateQuote.quote.lessonPositions[0] === 1);
  const lateBooked = await book(lateClass.id, outsider, lateQuote.quoteKey);
  check("late booking materialises only purchased future subset", lateBooked.status === 200 && lateBooked.body.lessons.length === 1 && lateBooked.body.lessons[0].position === 1);
  const paidSession = (await q("INSERT INTO sessions (teacher_id,teacher_name,subject,topic,date,duration,max_students,price) VALUES ($1,'Synthetic teacher','Maths','Synthetic paid control',$2,30,2,100) RETURNING id", [teacher.user.id, booked.lessons[0].startsAt])).rows[0].id;
  await q("INSERT INTO session_enrollments (session_id,student_id,payment_status,payment_method) VALUES ($1,$2,'paid','synthetic_fixture')", [paidSession, outsider.user.id]);
  await stop(); port++;
  await start({ ALLOW_TEST_STUDENT_ACCESS: "false" });
  check("kill switch rejects booking access", (await api(`/batch-tests/${c.id}`, a.token)).status === 403);
  check("kill switch closes actual room access", (await api(`/sessions/${sid}/room`, a.token)).status === 403);
  check("kill switch never changes an existing paid place", (await api(`/sessions/${paidSession}/room`, outsider.token)).status === 200);
  check("kill switch removes test CTA", (await api(`/programs/${c.item.batch.programId}/batches`)).body.batches[0].testPilotEndsAt === null);
  await stop(); port++;
  await start({ TEST_ACCESS_UNTIL: new Date(Date.now() - 1000).toISOString() });
  check("fixed deadline closes booking", (await api(`/batch-tests/${c.id}`, a.token)).status === 403);
  check("fixed deadline closes whiteboard membership", !await socketAccepted(a.token, sid));
  console.log(`${passed} batch test-booking checks passed. Media delivery is NOT tested: provider is echo.`);
} catch (error) { console.error(log.slice(-5000)); throw error; }
finally { await stop(); await pool.end(); }
