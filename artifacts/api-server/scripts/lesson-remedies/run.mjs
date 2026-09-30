/** Real Express API + PostgreSQL races. NEVER accepts a remote/shared database or paid service. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFinanceChecks } from "./financeChecks.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const requireDb = createRequire(path.join(root, "lib/db/package.json"));
const requireApi = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { Pool } = requireDb("pg"); const jwt = requireApi("jsonwebtoken");
const url = process.env.PGURL ?? process.env.DATABASE_URL;
assert.ok(url, "Provide a disposable local PostgreSQL URL.");
const parsed = new URL(url);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname), "Remote/shared databases are forbidden.");
assert.match(parsed.pathname, /^\/fadko_makeup_test[A-Za-z0-9_-]*$/, "Database name must begin fadko_makeup_test.");
const pool = new Pool({ connectionString: url, max: 15 });
const q = (text, values = []) => pool.query(text, values);
const fixtureProgramIds = [];
const DAY = 86400000; const HOUR = 3600000; const duration = 30;
const secret = "disposable-makeup-tests-only-secret";
let port = Number(process.env.MAKEUP_TEST_PORT ?? 8126); let child; let log = ""; let passed = 0;
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`); };
const key = () => randomUUID();
async function api(route, token, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", "X-Fadko-Platform": "web", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function start(flag = "1", enforceOperators = false) {
  log = "";
  // Explicitly neutralize service credentials inherited from a developer shell.
  child = spawn(process.execPath, [path.join(root, "artifacts/api-server/dist/index.mjs")], { cwd: root,
    env: { ...process.env, DATABASE_URL: url, PORT: String(port), NODE_ENV: "test", SESSION_SECRET: secret,
      LESSON_REMEDIES_ENABLED: flag, VIDEO_PROVIDER: "echo", LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "", DAILY_API_KEY: "",
      RESEND_API_KEY: "", BREVO_API_KEY: "", ESEWA_MERCHANT_ID: "", KHALTI_SECRET_KEY: "", PAYMENT_WEBHOOK_SECRET: "",
      IDENTITY_COLLECTION_ENABLED: "false", OPERATOR_SITE_ENFORCEMENT_ENABLED: String(enforceOperators), COST_HEALTH_ALERTS_ENABLED: "false",
      ACCOUNT_CLOSURE_REQUESTS_ENABLED: "false", ACCOUNT_CLOSURE_COMPLETION_ENABLED: "false",
      ALLOW_TEST_TEACHING_ACCESS: "true", ALLOW_TEST_STUDENT_ACCESS: "true", TEST_ACCESS_UNTIL: new Date(Date.now() + 120 * DAY).toISOString() },
    stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (v) => { log += v; }); child.stderr.on("data", (v) => { log += v; });
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw Error(`Test API exited: ${log.slice(-4000)}`);
    try { if ((await api("/readyz")).status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Test API did not start: ${log.slice(-4000)}`);
}
async function stop() {
  if (child?.exitCode === null) { const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await exited; }
}
async function account(role) {
  const email = `${randomUUID()}@example.com`;
  const row = (await q("INSERT INTO users(email,name,role,password_hash) VALUES($1,$2,$3,'synthetic-not-a-login') RETURNING id", [email, `Synthetic ${role}`, role])).rows[0];
  const token = jwt.sign({ userId: row.id, email, role }, secret, { expiresIn: "1h" });
  return { id: row.id, token };
}
function receipt(bookingId, positions) {
  return { reference: `TEST-BATCH-${bookingId}`, mode: "simulation", event: "simulated_capture", currency: "NPR",
    grossNpr: positions.length * 1000, teacherNpr: positions.length * 700, fadkoNpr: positions.length * 300,
    teacherShareBps: 7000, fadkoShareBps: 3000, studentFeeNpr: 0, complaintWindowHours: 48,
    actualMoneyCollectedNpr: 0, actualMoneyPaidOutNpr: 0,
    allocations: positions.map((position) => ({ position, grossNpr: 1000, teacherNpr: 700, fadkoNpr: 300, state: "held" })) };
}
async function fixture({ monthly = true, count = 3, positions = null, at = Date.now() + 2 * DAY, paymentStatus = "test", studentFirst = false, teacherAccount = null } = {}) {
  assert.equal(paymentStatus, "test", "Mapped practice classes must use their real test-access enrollment contract.");
  const earlierStudent = studentFirst ? await account("student") : null;
  const teacher = teacherAccount ?? await account("teacher"); const student = earlierStudent ?? await account("student");
  // A published program snapshot is version 1; the schema's default 0 is a draft.
  const program = (await q("INSERT INTO learning_programs(teacher_id,type,title,status,version) VALUES($1,'structured','Synthetic make-up course','published',1) RETURNING id", [teacher.id])).rows[0].id;
  fixtureProgramIds.push(program);
  const batchId = (await q("INSERT INTO learning_program_batches(program_id,status,capacity,total_tuition_npr,version) VALUES($1,'published',10,$2,1) RETURNING id", [program, count * 1000])).rows[0].id;
  const lessons = Array.from({ length: count }, (_, position) => ({ position, startsAt: new Date(at + position * 2 * DAY).toISOString(), durationMinutes: duration }));
  const snapshot = { batchId, version: 1, programId: program, programVersion: 1, programTitle: "Synthetic make-up course",
    capacity: 10, totalTuitionNpr: count * 1000, timeZone: "Asia/Kathmandu", enrollmentClosesAt: lessons[0].startsAt, lessons,
    ...(monthly ? { tuitionPeriod: { groupId: batchId, index: 0, startsAt: lessons[0].startsAt, endsAt: new Date(at + 30 * DAY).toISOString() } } : {}) };
  await q("UPDATE learning_program_batches SET published_snapshot=$2 WHERE id=$1", [batchId, JSON.stringify(snapshot)]);
  const tg = (await q("INSERT INTO test_teaching_grants(teacher_id,tier,reason,valid_until) VALUES($1,'base','Disposable test',$2) RETURNING id", [teacher.id, new Date(Date.now() + 120 * DAY)])).rows[0].id;
  const sg = (await q("INSERT INTO test_student_grants(student_id,reason,valid_until) VALUES($1,'Disposable test',$2) RETURNING id", [student.id, new Date(Date.now() + 120 * DAY)])).rows[0].id;
  await q("INSERT INTO batch_test_contracts(batch_id,snapshot,teacher_grant_id) VALUES($1,$2,$3)", [batchId, JSON.stringify(snapshot), tg]);
  const selected = positions ?? lessons.map((l) => l.position);
  const bookingId = (await q("INSERT INTO batch_test_bookings(batch_id,student_id,student_grant_id,quote) VALUES($1,$2,$3,$4) RETURNING id", [batchId, student.id, sg, JSON.stringify({ lessonPositions: selected })])).rows[0].id;
  await q("INSERT INTO batch_test_payments(booking_id,receipt) VALUES($1,$2)", [bookingId, JSON.stringify(receipt(bookingId, selected))]);
  const sessionIds = [];
  for (const l of lessons) {
    const sid = (await q("INSERT INTO sessions(teacher_id,teacher_name,subject,topic,date,duration,max_students,enrolled_count,price) VALUES($1,'Synthetic teacher','Maths',$2,$3,$4,10,$5,0) RETURNING id",
      [teacher.id, `Synthetic lesson ${l.position + 1}`, l.startsAt, duration, selected.includes(l.position) ? 1 : 0])).rows[0].id;
    sessionIds.push(sid); await q("INSERT INTO batch_test_sessions(batch_id,position,session_id) VALUES($1,$2,$3)", [batchId, l.position, sid]);
    await q("INSERT INTO test_classes(session_id,teacher_id,grant_id) VALUES($1,$2,$3)", [sid, teacher.id, tg]);
    if (selected.includes(l.position)) await q("INSERT INTO session_enrollments(session_id,student_id,payment_status,payment_method) VALUES($1,$2,$3,'test_access')", [sid, student.id, paymentStatus]);
  }
  return { teacher, student, batchId, bookingId, sessionIds, snapshot };
}
const request = (f, i = 0, reason = "student_missed", requestKey = key()) => api(`/sessions/${f.sessionIds[i]}/makeup-request`, f.student.token, { reason, requestKey, note: "Synthetic request for the original purchased lesson." });
async function list(f, who = f.student) { const r = await api(`/class-groups/${f.batchId}/remedies`, who.token); assert.equal(r.status, 200, JSON.stringify(r)); return r.body; }
function lessonForCase(view, caseId) {
  const lesson = view.lessons.find(row => row.case?.id === caseId);
  assert.ok(lesson, `The private view must retain exact make-up case ${caseId}`);
  return lesson;
}
async function offer(f, c, startsAt = Date.now() + 12 * DAY, extra = {}) {
  return api(`/lesson-remedies/${c}/offer`, f.teacher.token, { startsAt: new Date(startsAt).toISOString(), requestKey: key(), ...extra });
}
async function accept(f, c, requestKey = key()) {
  const view = (await list(f)).lessons.find((l) => l.case?.id === c);
  return api(`/lesson-remedies/${c}/accept`, f.student.token, { offerId: view.case.offer.id, requestKey });
}
const resolve = (op, c, outcome, extra = {}) => api(`/admin/lesson-remedies/${c}/resolve`, op.token,
  { outcome, confirmed: true, note: "Synthetic operator reviewed the linked classroom records and evidence.", requestKey: key(), ...extra });
async function acceptedPastFixture(f) {
  const originalAt = Date.parse(f.snapshot.lessons[0].startsAt); const replacementAt = originalAt + 2 * DAY;
  const policy = { version: "2026-09-29-v1", kind: "monthly_tuition", purchasedLessonCount: f.sessionIds.length, courtesyLimit: 2,
    noRollover: true, teacherApprovalRequired: true, offerResponseHours: 168, replacementWithinDays: 30, reviewHours: 48, missedReplacement: "human_review" };
  const c = (await q(`INSERT INTO lesson_remedy_cases(original_booking_id,original_position,original_session_id,student_id,teacher_id,
    reason,status,policy_version,policy_snapshot,original_claim_closes_at,replacement_deadline_at)
    VALUES($1,0,$2,$3,$4,'student_missed','accepted',$5,$6,$7,$8) RETURNING id`, [f.bookingId, f.sessionIds[0], f.student.id, f.teacher.id,
    policy.version, JSON.stringify(policy), new Date(originalAt + duration * 60000 + 48 * HOUR), new Date(originalAt + duration * 60000 + 30 * DAY)])).rows[0].id;
  const replacementId = (await q(`INSERT INTO sessions(teacher_id,teacher_name,subject,topic,date,duration,max_students,enrolled_count,price,status)
    VALUES($1,'Synthetic teacher','Maths','Synthetic replacement',$2,$3,1,1,0,'completed') RETURNING id`, [f.teacher.id, new Date(replacementAt), duration])).rows[0].id;
  await q("INSERT INTO session_enrollments(session_id,student_id,payment_status,payment_method) VALUES($1,$2,'test','linked_makeup')", [replacementId, f.student.id]);
  await q(`INSERT INTO lesson_remedy_offers(case_id,version,offered_by,starts_at,ends_at,expires_at,status,replacement_session_id,accepted_at,created_at)
    VALUES($1,1,$2,$3,$4,$3,'accepted',$5,$6,$7)`, [c, f.teacher.id, new Date(replacementAt), new Date(replacementAt + duration * 60000), replacementId, new Date(replacementAt - HOUR), new Date(replacementAt - 2 * HOUR)]);
  await q(`INSERT INTO batch_test_ledger_entries(booking_id,position,event,from_state,to_state,gross_npr,teacher_npr,fadko_npr,detail)
    VALUES($1,0,'makeup_requested','future','replacement_pending',1000,700,300,'{"synthetic":true}')`, [f.bookingId]);
  return { caseId: c, replacementId, replacementAt };
}

try {
  await start(); const operator = await account("admin"); const outsider = await account("student");
  await q("INSERT INTO operator_accounts(user_id,login_id,must_change_password) VALUES($1,$2,false) ON CONFLICT(user_id) DO UPDATE SET must_change_password=false", [operator.id, `synthetic-${operator.id}`]);
  check("anonymous cannot inspect make-up queue", (await api("/lesson-remedies")).status === 401);
  check("student cannot inspect operator queue", (await api("/admin/lesson-remedies", outsider.token)).status === 403);
  const f = await fixture();
  // This release has only the read-only closure-status adapter. Seed its local-only
  // fixture, not identity collection or a closure-completion API.
  await q("CREATE TABLE IF NOT EXISTS account_closure_requests (user_id integer PRIMARY KEY REFERENCES users(id), status text NOT NULL, requested_at timestamptz, closed_at timestamptz)");
  const firstKey = key(); const first = await request(f, 0, "student_missed", firstKey);
  assert.equal(first.status, 200, JSON.stringify(first));
  const c = first.body.caseId;
  check("request immediately records original-amount hold", (await q("SELECT to_state,gross_npr FROM batch_test_ledger_entries WHERE booking_id=$1 ORDER BY id DESC LIMIT 1", [f.bookingId])).rows[0].to_state === "replacement_pending");
  check("same request key retries without duplicate cases or events", (await request(f, 0, "student_missed", firstKey)).body.changed === false && Number((await q("SELECT count(*) n FROM lesson_remedy_cases WHERE original_booking_id=$1", [f.bookingId])).rows[0].n) === 1);
  check("reusing request key for changed details refuses", (await request(f, 0, "teacher_missed", firstKey)).status === 409);
  check("another student cannot see the class's purchased lesson or case", (await list(f, outsider)).lessons.length === 0);
  check("another student cannot accept/withdraw someone else's case", (await api(`/lesson-remedies/${c}/withdraw`, outsider.token, { requestKey: key() })).status === 404);
  const offered = await offer(f, c); assert.equal(offered.status, 200, JSON.stringify(offered));
  check("student cannot propose teacher offer", (await api(`/lesson-remedies/${c}/offer`, f.student.token, { startsAt: new Date(Date.now() + 13 * DAY).toISOString(), requestKey: key() })).status === 403);
  const offerRow = lessonForCase(await list(f), c).case.offer;
  check("offer expiry is earlier of seven days and its start", Date.parse(offerRow.expiresAt) <= Date.now() + 7 * DAY && Date.parse(offerRow.expiresAt) <= Date.parse(offerRow.startsAt));
  const racingKey = key(); const acceptRace = await Promise.all(Array.from({ length: 9 }, () => api(`/lesson-remedies/${c}/accept`, f.student.token, { offerId: offerRow.id, requestKey: racingKey })));
  check("nine simultaneous accepts return one linked replacement", acceptRace.every((r) => r.status === 200) && new Set(acceptRace.map((r) => r.body.replacementSessionId)).size === 1 && acceptRace.filter((r) => r.body.changed).length === 1);
  const replacementId = acceptRace[0].body.replacementSessionId;
  check("replacement has one no-charge seat and no original timetable mapping", Number((await q("SELECT count(*) n FROM session_enrollments WHERE session_id=$1", [replacementId])).rows[0].n) === 1 && (await q("SELECT price FROM sessions WHERE id=$1", [replacementId])).rows[0].price === 0 && (await q("SELECT 1 FROM batch_test_sessions WHERE session_id=$1", [replacementId])).rowCount === 0);
  check("student cannot create replacement of replacement", (await api(`/sessions/${replacementId}/makeup-request`, f.student.token, { reason: "student_missed", requestKey: key() })).status === 404);
  check("generic paid booking cannot sell replacement", (await api(`/sessions/${replacementId}/book`, outsider.token, {})).status >= 400);
  check("generic teacher cannot change accepted replacement schedule", (await api(`/sessions/${replacementId}`, f.teacher.token, { date: new Date(Date.now() + 14 * DAY).toISOString() }, "PATCH")).status >= 400);
  check("operator cannot confirm completed delivery without evidence", (await resolve(operator, c, "replacement_delivered")).status === 409);
  const quota = await fixture(); const quotaRaces = await Promise.all(quota.sessionIds.map((_, i) => request(quota, i)));
  check("three concurrent monthly requests reserve exactly two allowance slots", quotaRaces.filter((r) => r.status === 200).length === 2 && quotaRaces.filter((r) => r.status === 409).length === 1);
  const quotaView = await list(quota); check("quota display and untouched lessons agree with server reservation", quotaView.quotas[0].used === 2 && quotaView.quotas[0].remaining === 0 && quotaView.lessons.filter((l) => !l.case).every((l) => !l.canRequest));
  const withdrawnCase = quotaRaces.find((r) => r.status === 200).body.caseId;
  check("withdraw releases pending courtesy reservation", (await api(`/lesson-remedies/${withdrawnCase}/withdraw`, quota.student.token, { requestKey: key() })).status === 200 && (await list(quota)).quotas[0].used === 1);
  const withdrawnIndex = quotaRaces.findIndex((r) => r.body?.caseId === withdrawnCase);
  check("eligible withdrawn original exposes the same re-request action", lessonForCase(await list(quota), withdrawnCase).canRequest);
  const reopened = await request(quota, withdrawnIndex);
  check("re-request reopens the same case and reserves its released quota slot", reopened.status === 200 && reopened.body.caseId === withdrawnCase && (await list(quota)).quotas[0].used === 2);
  assert.equal((await api(`/lesson-remedies/${withdrawnCase}/withdraw`, quota.student.token, { requestKey: key() })).status, 200);
  const deniedIndex = quotaRaces.findIndex((r) => r.status !== 200); check("another original lesson can use the released slot", (await request(quota, deniedIndex)).status === 200);
  check("withdrawn case cannot reopen when the allowance is now exhausted", !lessonForCase(await list(quota), withdrawnCase).canRequest && (await request(quota, withdrawnIndex)).status === 409);
  const blockedReopen = await fixture(); const blockedRequest = await request(blockedReopen);
  assert.equal(blockedRequest.status, 200);
  assert.equal((await api(`/lesson-remedies/${blockedRequest.body.caseId}/withdraw`, blockedReopen.student.token, { requestKey: key() })).status, 200);
  await q("INSERT INTO disputes(user_id,session_id,reason,description) VALUES($1,$2,'Refund Request','Synthetic support review blocks reopened request')", [blockedReopen.student.id, blockedReopen.sessionIds[0]]);
  check("active financial support hides and refuses a withdrawn re-request", !lessonForCase(await list(blockedReopen), blockedRequest.body.caseId).canRequest && (await request(blockedReopen)).status === 409);
  const overdueRequest = await fixture({ at: Date.now() - 3 * DAY });
  check("elapsed original claim window hides and refuses new requests", !(await list(overdueRequest)).lessons.find(l => l.originalSessionId === overdueRequest.sessionIds[0]).canRequest && (await request(overdueRequest)).status === 409);
  const short = await fixture({ monthly: false, count: 1 });
  check("one-lesson course has no student courtesy make-up", (await request(short)).status === 409 && (await list(short)).quotas[0].limit === 0);
  const teacherMissed = await request(short, 0, "teacher_missed"); assert.equal(teacherMissed.status, 200, JSON.stringify(teacherMissed));
  check("unverified teacher-missed claim does not grant exempt offer", (await offer(short, teacherMissed.body.caseId)).status === 409);
  check("teacher's explicit non-delivery confirmation permits exempt replacement", (await offer(short, teacherMissed.body.caseId, Date.now() + 13 * DAY, { confirmTeacherNonDelivery: true })).status === 200 && (await list(short)).quotas[0].used === 0);
  const replacement = await accept(short, teacherMissed.body.caseId); assert.equal(replacement.status, 200, JSON.stringify(replacement));
  check("teacher-missed make-up has no second charge or new receipt", Number((await q("SELECT count(*) n FROM batch_test_payments WHERE booking_id=$1", [short.bookingId])).rows[0].n) === 1);
  const conflict = await fixture(); const conflictReq = await request(conflict); const conflictStart = Date.parse(conflict.snapshot.lessons[1].startsAt);
  check("teacher schedule conflict returns actionable issues", (await offer(conflict, conflictReq.body.caseId, conflictStart)).body.code === "schedule_conflict");
  await q("INSERT INTO teacher_leave(teacher_id,starts_at,ends_at,reason) VALUES($1,$2,$3,'Synthetic leave')", [conflict.teacher.id, new Date(Date.now() + 10 * DAY), new Date(Date.now() + 11 * DAY)]);
  check("teacher leave cannot receive a make-up offer", (await offer(conflict, conflictReq.body.caseId, Date.now() + 10.5 * DAY)).body.code === "teacher_leave_conflict");
  check("replacement cannot exceed original thirty-day deadline", (await offer(conflict, conflictReq.body.caseId, Date.now() + 40 * DAY)).status === 409);
  const expired = await fixture(); const er = await request(expired); await offer(expired, er.body.caseId);
  await q("UPDATE lesson_remedy_offers SET created_at=now()-interval '2 hour',expires_at=now()-interval '1 hour' WHERE case_id=$1", [er.body.caseId]);
  check("expired offer is visibly unavailable and releases unaccepted reservation", lessonForCase(await list(expired), er.body.caseId).case.status === "review_required" && (await list(expired)).quotas[0].used === 0);
  check("expired acceptance refuses instead of creating seat", (await accept(expired, er.body.caseId)).status === 409);
  const expiredReopen = await request(expired);
  check("unaccepted review can re-request the same original without a replacement chain", expiredReopen.status === 200 && expiredReopen.body.caseId === er.body.caseId);
  check("teacher can propose a fresh time after expiry without replacement chain", (await offer(expired, er.body.caseId, Date.now() + 14 * DAY)).status === 200);
  const subset = await fixture({ positions: [1, 2] });
  check("late-join subset cannot request an unpurchased earlier lesson", (await request(subset, 0)).status === 404 && (await list(subset)).lessons.length === 2);
  const finance = await fixture(); const fr = await request(finance); await offer(finance, fr.body.caseId);
  await q("INSERT INTO disputes(user_id,session_id,reason,description) VALUES($1,$2,'Refund Request','Synthetic active refund review')", [finance.student.id, finance.sessionIds[0]]);
  check("actual refund review and make-up acceptance are mutually exclusive", (await accept(finance, fr.body.caseId)).status === 409);
  const safety = await fixture(); await q("INSERT INTO disputes(user_id,session_id,reason,description) VALUES($1,$2,'Inappropriate Behavior','Synthetic safety evidence')", [safety.student.id, safety.sessionIds[0]]);
  check("safety-only support does not silently consume financial make-up options", (await request(safety)).status === 200);
  const race = await fixture(); const rr = await request(race); await offer(race, rr.body.caseId);
  const rv = lessonForCase(await list(race), rr.body.caseId).case.offer;
  const raceResult = await Promise.all([api(`/lesson-remedies/${rr.body.caseId}/accept`, race.student.token, { offerId: rv.id, requestKey: key() }), resolve(operator, rr.body.caseId, "refund_approved")]);
  check("refund/acceptance race never leaves admitted replacement after original refund", raceResult[1].status === 200 && [200, 409].includes(raceResult[0].status) && (await q("SELECT 1 FROM session_enrollments WHERE student_id=$1 AND session_id IN (SELECT replacement_session_id FROM lesson_remedy_offers WHERE case_id=$2) AND payment_status IN ('paid','test')", [race.student.id, rr.body.caseId])).rowCount === 0);
  check("refund uses original NPR1000 allocation, not zero-price replacement", (await q("SELECT to_state,gross_npr FROM batch_test_ledger_entries WHERE booking_id=$1 AND position=0 ORDER BY id DESC LIMIT 1", [race.bookingId])).rows[0].gross_npr === 1000 && (await q("SELECT to_state FROM batch_test_ledger_entries WHERE booking_id=$1 AND position=0 ORDER BY id DESC LIMIT 1", [race.bookingId])).rows[0].to_state === "refund_owed");
  const refundedOriginal = lessonForCase(await list(race), rr.body.caseId);
  check("refunded original remains in private make-up history without new actions", refundedOriginal.case.status === "resolved" && !refundedOriginal.canRequest);
  check("refunded original cannot restart a make-up request", (await request(race)).status === 404);
  const delivery = await fixture({ at: Date.now() - 5 * DAY }); const delivered = await acceptedPastFixture(delivery);
  check("Completed label alone does not permit confirmation", (await resolve(operator, delivered.caseId, "replacement_delivered")).status === 409);
  await q("INSERT INTO session_activity(session_id,ended_at) VALUES($1,$2)", [delivered.replacementId, new Date(delivered.replacementAt + duration * 60000)]);
  await q("INSERT INTO session_participation(session_id,user_id,role,present_ms,join_count) VALUES($1,$2,'teacher',$3,1)", [delivered.replacementId, delivery.teacher.id, duration * 60000]);
  check("documented operator review confirms actual replacement and starts fresh48h window", (await resolve(operator, delivered.caseId, "replacement_delivered")).status === 200 && Date.parse(lessonForCase(await list(delivery), delivered.caseId).case.replacementReviewClosesAt) >= Date.now() + 48 * HOUR - 3000);
  const beforePayment = await api("/batch-tests/me/payments", delivery.student.token);
  check("confirmation does not immediately pay out during fresh replacement review", beforePayment.status === 200 && beforePayment.body.receipts.find((r) => r.bookingId === delivery.bookingId).allocations[0].state === "delivered_pending");
  check("generic operator payout cannot bypass fresh replacement review", (await api(`/admin/batch-test-payments/${delivery.bookingId}/allocations/0/events`, operator.token, { event: "payout_confirmed", note: "Synthetic attempt to bypass fresh review." })).status === 409);
  const failed = await fixture({ at: Date.now() - 5 * DAY }); const failedReplacement = await acceptedPastFixture(failed);
  check("missed replacement goes to human review, not automatic refund", (await resolve(operator, failedReplacement.caseId, "student_missed_replacement")).status === 200 && lessonForCase(await list(failed), failedReplacement.caseId).case.status === "review_required" && (await list(failed)).quotas[0].used === 1);
  check("teacher-failed replacement releases courtesy but keeps original review/hold", (await resolve(operator, failedReplacement.caseId, "teacher_missed_replacement")).status === 200 && (await list(failed)).quotas[0].used === 0 && lessonForCase(await list(failed), failedReplacement.caseId).case.status === "review_required");
  check("accepted-ever review cannot reopen an original for a second replacement", !lessonForCase(await list(failed), failedReplacement.caseId).canRequest && (await request(failed)).status === 409);
  const privateView = await list(delivery, delivery.teacher);
  check("participant DTO never contains private contacts, identity or operator notes", !/password|@example|dateOfBirth|citizenship|evidenceReviewed|Synthetic operator/.test(JSON.stringify(privateView)));
  const closure = await fixture(); await q("INSERT INTO account_closure_requests(user_id,status,requested_at,closed_at) VALUES($1,'closed',now(),now()) ON CONFLICT(user_id) DO UPDATE SET status='closed',closed_at=now()", [closure.student.id]);
  check("closure winning account row blocks newly created commitments", (await request(closure)).status >= 400);
  await runFinanceChecks({ api, q, connect: () => pool.connect(), check, fixture, request, offer, accept, resolve, operator, outsider, acceptedPastFixture, DAY, HOUR });
  await stop(); port++; await start("0");
  const disabled = await list(f);
  check("new-write kill switch makes future user requests fail closed", !disabled.enabled && (await request(f, 2)).status === 503);
  check("kill switch preserves durable replacement exclusion", (await api(`/sessions/${replacementId}/book`, outsider.token, {})).status >= 400);
  await stop(); port++; await start("0", true);
  const disabledOperator = await account("admin"); const passwordOperator = await account("admin");
  await q("INSERT INTO operator_accounts(user_id,login_id,must_change_password,disabled_at) VALUES($1,$2,false,now())", [disabledOperator.id, `disabled-${disabledOperator.id}`]);
  await q("INSERT INTO operator_accounts(user_id,login_id,must_change_password) VALUES($1,$2,true)", [passwordOperator.id, `password-${passwordOperator.id}`]);
  for (const restricted of [disabledOperator, passwordOperator]) {
    for (const route of ["/admin/lesson-remedies", "/lesson-remedies", `/class-groups/${f.batchId}/remedies`, `/sessions/${replacementId}`, `/sessions?teacherId=${f.teacher.id}`]) {
      check(`restricted operator ${restricted.id} cannot bypass desk authority through ${route}`, (await api(route, restricted.token)).status === 403);
    }
  }
  check("active rotated operator retains read-only durable queue while writes paused", (await api("/admin/lesson-remedies", operator.token)).status === 200);
  console.log(`${passed} real PostgreSQL make-up checks passed. No shared database, real payments, emails or media calls were used.`);
} catch (error) { console.error(log.slice(-5000)); throw error; }
finally {
  await stop();
  try {
    // These exact disposable fixture rows model purchased batches, not complete public
    // Program publications. Approved race-test teachers must not leave NULL publication
    // stubs at the front of the next suite's catalogue. Keep seats, cases and ledgers intact.
    if (fixtureProgramIds.length) {
      const archived = await q("UPDATE learning_programs SET status='archived',archived_at=now() WHERE id=ANY($1::int[])", [fixtureProgramIds]);
      assert.equal(archived.rowCount, fixtureProgramIds.length, "Archive only this disposable harness's exact tracked program stubs.");
    }
  } finally { await pool.end(); }
}
