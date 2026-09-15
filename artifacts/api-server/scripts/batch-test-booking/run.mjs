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
  for (let i = 0; i < 300; i++) {
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
async function inbox(a, predicate, expected = 1) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await api("/notification-events?after=0", a.token);
    if (response.status === 200 && (response.body.events ?? []).filter((row) => predicate(row.event)).length >= expected) return response.body.events;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}
async function socketAccepted(token, id) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws?sessionId=${id}&token=${encodeURIComponent(token)}&name=Test`);
    const timer = setTimeout(() => done(false), 3000);
    function done(value) { clearTimeout(timer); ws.close(); resolve(value); }
    ws.on("error", () => done(false)); ws.on("close", () => done(false)); ws.on("open", () => done(true));
  });
}
async function openUserChannel(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("user channel did not open")), 3000);
    ws.once("open", () => { clearTimeout(timer); resolve(); });
    ws.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return ws;
}
function nextSocketEvent(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("live class-conversation event did not arrive")); }, 3000);
    const onMessage = (raw) => {
      let event;
      try { event = JSON.parse(String(raw)); } catch { return; }
      if (!predicate(event)) return;
      cleanup(); resolve(event);
    };
    const cleanup = () => { clearTimeout(timer); ws.off("message", onMessage); };
    ws.on("message", onMessage);
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
  const automaticTeacher = await account("teacher", false), automaticStudent = await account("student", false);
  const automaticClass = await offer(automaticTeacher);
  const automaticQuote = await quote(automaticClass.id, automaticStudent);
  check("viewing simulated checkout needs no operator grant", automaticQuote.quote.amountNpr === 6000);
  check("viewing a price does not create beta access", Number((await q("SELECT count(*) n FROM test_teaching_grants WHERE teacher_id=$1", [automaticTeacher.user.id])).rows[0].n) === 0
    && Number((await q("SELECT count(*) n FROM test_student_grants WHERE student_id=$1", [automaticStudent.user.id])).rows[0].n) === 0);
  check("declined simulation creates no access or booking", (await book(automaticClass.id, automaticStudent, automaticQuote.quoteKey, "declined")).status === 402
    && Number((await q("SELECT count(*) n FROM test_student_grants WHERE student_id=$1", [automaticStudent.user.id])).rows[0].n) === 0
    && Number((await q("SELECT count(*) n FROM batch_test_bookings WHERE batch_id=$1", [automaticClass.id])).rows[0].n) === 0);
  const automaticBooking = await book(automaticClass.id, automaticStudent, automaticQuote.quoteKey);
  check("verified student can complete simulated checkout without an operator", automaticBooking.status === 200 && automaticBooking.body.created === true);
  const automaticTeacherGrant = (await q("SELECT granted_by,reason,valid_until FROM test_teaching_grants WHERE teacher_id=$1", [automaticTeacher.user.id])).rows;
  const automaticStudentGrant = (await q("SELECT granted_by,reason,valid_until FROM test_student_grants WHERE student_id=$1", [automaticStudent.user.id])).rows;
  check("successful simulation records bounded automatic access", automaticTeacherGrant.length === 1 && automaticStudentGrant.length === 1
    && automaticTeacherGrant[0].granted_by === null && automaticStudentGrant[0].granted_by === null
    && automaticTeacherGrant[0].reason === "Automatic private beta simulated checkout"
    && automaticStudentGrant[0].reason === "Automatic private beta simulated checkout"
    && new Date(automaticTeacherGrant[0].valid_until).toISOString() === until
    && new Date(automaticStudentGrant[0].valid_until).toISOString() === until);
  const automaticRows = (await q("SELECT e.payment_status,e.payment_method,e.payment_reference,s.price FROM session_enrollments e JOIN sessions s ON s.id=e.session_id JOIN batch_test_sessions bt ON bt.session_id=s.id WHERE bt.batch_id=$1", [automaticClass.id])).rows;
  check("automatic beta checkout remains test-only", automaticRows.length === 2 && automaticRows.every((row) => row.payment_status === "test" && row.payment_method === "test_access" && row.payment_reference === null && row.price === 0));
  const c = await offer(teacher);
  check("test button advertised only by configured server", (await api(`/programs/${c.item.batch.programId}/batches`)).body.batches[0].testPilotEndsAt === until);
  check("anonymous cannot quote", (await api(`/batch-tests/${c.id}`)).status === 401);
  check("verified student without operator grant can quote", (await api(`/batch-tests/${c.id}`, outsider.token)).status === 200);
  const proposal = await quote(c.id, a);
  check("old free-booking shortcut refused", (await api(`/batch-tests/${c.id}`, a.token, { quoteKey: proposal.quoteKey })).status === 400);
  check("declined test payment leaves no place or financial record", (await book(c.id, a, proposal.quoteKey, "declined")).status === 402 && Number((await q("SELECT count(*) n FROM batch_test_bookings WHERE batch_id=$1", [c.id])).rows[0].n) === 0);
  check("quote is a price illustration, never a receipt", proposal.testOnly && proposal.paymentCollectedNpr === 0 && proposal.quote.amountNpr === 6000 && proposal.lessons.length === 0);
  check("invented quote refused", (await book(c.id, a, "0".repeat(64))).status === 409);
  check("teacher cannot book own class", (await book(c.id, teacher, proposal.quoteKey)).status === 403);
  const replies = await Promise.all([book(c.id, a, proposal.quoteKey), book(c.id, a, proposal.quoteKey)]);
  check("concurrent retry books exactly once", replies.every((r) => r.status === 200) && replies.filter((r) => r.body.created).length === 1);
  const booked = replies[0].body;
  check("success returns the student's frozen simulated receipt", booked.receipts.length === 1 && booked.receipts[0].grossNpr === 6000 && booked.receipts[0].reference && booked.paymentCollectedNpr === 0);
  const restoredBooking = await quote(c.id, a);
  check("signing back in restores the confirmed class instead of offering checkout again", restoredBooking.booked && restoredBooking.lessons.length === 2 && restoredBooking.receipts[0].reference === booked.receipts[0].reference);
  const studentSessions = await api(`/sessions?studentId=${a.user.id}&limit=50`, a.token);
  const groupedLessons = studentSessions.body.sessions.filter((session) => session.classGroup?.batchId === c.id);
  check("generated lesson rows carry one server-owned class identity", groupedLessons.length === 2 && groupedLessons.every((session) => session.classGroup.title === c.body.title && session.classGroup.lessonCount === 2));
  check("booking response excludes teacher and platform accounting", !JSON.stringify(booked).includes("teacherNpr") && !JSON.stringify(booked).includes("fadkoNpr") && !JSON.stringify(booked).includes("heldGrossNpr") && !JSON.stringify(booked).includes("fadkoEarnedNpr"));
  check("concurrent retry creates only one capture", Number((await q("SELECT count(*) n FROM batch_test_payments p JOIN batch_test_bookings b ON b.id=p.booking_id WHERE b.batch_id=$1", [c.id])).rows[0].n) === 1);
  check("teacher can read simulated ledger for own class", (await quote(c.id, teacher)).receipts.length === 1);
  const studentMoney = await api("/batch-tests/me/payments", a.token);
  check("student money summary contains only their own receipt", studentMoney.status === 200 && studentMoney.body.role === "student" && studentMoney.body.receipts.length === 1 && studentMoney.body.receipts[0].reference === booked.receipts[0].reference);
  check("student payment response excludes teacher and platform accounting", !JSON.stringify(studentMoney.body).includes("teacherNpr") && !JSON.stringify(studentMoney.body).includes("fadkoNpr") && !JSON.stringify(studentMoney.body).includes("heldGrossNpr") && !JSON.stringify(studentMoney.body).includes("fadkoEarnedNpr"));
  const teacherMoney = await api("/batch-tests/me/payments", teacher.token);
  check("teacher money summary contains the receipt for their class", teacherMoney.status === 200 && teacherMoney.body.role === "teacher" && teacherMoney.body.receipts.length === 1 && teacherMoney.body.receipts[0].studentName === a.user.name);
  check("teacher earnings response excludes student gross and platform accounting", !JSON.stringify(teacherMoney.body).includes("grossNpr") && !JSON.stringify(teacherMoney.body).includes("fadkoNpr") && !JSON.stringify(teacherMoney.body).includes("heldGrossNpr") && !JSON.stringify(teacherMoney.body).includes("fadkoEarnedNpr"));
  check("another student cannot discover the receipt in their summary", (await api("/batch-tests/me/payments", b.token)).body.receipts.length === 0);
  check("operator cannot use a participant money summary", (await api("/batch-tests/me/payments", operatorToken)).status === 403);
  check("operator sees simulated capture", (await api("/admin/batch-test-payments", operatorToken)).body.receipts.some(r => r.reference === booked.receipts[0].reference && r.grossNpr === 6000));
  check("student cannot read operator ledger", (await api("/admin/batch-test-payments", a.token)).status === 403);
  check("teacher cannot read operator ledger", (await api("/admin/batch-test-payments", teacher.token)).status === 403);
  check("another student cannot read first student's receipt", (await quote(c.id, b)).receipts.length === 0);
  const classHome = await api(`/class-groups/${c.id}`, a.token);
  check("booked student opens the class-group home", classHome.status === 200 && !classHome.body.isTeacher && classHome.body.lessons.length === 2 && classHome.body.counts.unreadMessages === 0);
  check("unbooked student cannot open another class group", (await api(`/class-groups/${c.id}`, outsider.token)).status === 403);
  const teacherClassHome = await api(`/class-groups/${c.id}`, teacher.token);
  check("teacher opens the same class-group home", teacherClassHome.body.isTeacher === true);
  check("teacher class home counts enrolled students", teacherClassHome.body.counts.students === 1);
  const quietTeacherInbox = await api("/message-inbox", teacher.token);
  check("booked class is discoverable in teacher Messages before anybody speaks", quietTeacherInbox.status === 200
    && quietTeacherInbox.body.direct.length === 0
    && quietTeacherInbox.body.classes.some((row) => row.batchId === c.id && row.title === c.body.title && row.lastMessage === "" && row.unreadCount === 0));
  const quietStudentInbox = await api("/message-inbox", a.token);
  check("booked class is discoverable in student Messages before anybody speaks", quietStudentInbox.body.classes.some((row) => row.batchId === c.id && row.lastMessageAt === null));
  check("an unbooked student cannot discover the private class discussion", !(await api("/message-inbox", outsider.token)).body.classes.some((row) => row.batchId === c.id));
  check("student cannot open the private class roster", (await api(`/class-groups/${c.id}/students`, a.token)).status === 403);
  const rosterBeforeLesson = await api(`/class-groups/${c.id}/students`, teacher.token);
  check("teacher sees the enrolled student's name without contact details", rosterBeforeLesson.status === 200
    && rosterBeforeLesson.body.students.length === 1
    && rosterBeforeLesson.body.students[0].name === a.user.name
    && !JSON.stringify(rosterBeforeLesson.body).includes(a.user.email)
    && !JSON.stringify(rosterBeforeLesson.body).includes("studentId"));
  check("an empty readable presence ledger is not called a system failure", rosterBeforeLesson.body.attendanceKnown === true
    && rosterBeforeLesson.body.students[0].attendance.lessonsAttended === 0);
  const firstRosterSession = Number((await q("SELECT session_id FROM batch_test_sessions WHERE batch_id=$1 AND position=0", [c.id])).rows[0].session_id);
  await q("INSERT INTO session_participation (session_id,user_id,role,present_ms,join_count) VALUES ($1,$2,'student',1800000,1) ON CONFLICT (session_id,user_id) DO UPDATE SET present_ms=EXCLUDED.present_ms,join_count=EXCLUDED.join_count,last_seen_at=now()", [firstRosterSession, a.user.id]);
  const rosterAfterLesson = await api(`/class-groups/${c.id}/students`, teacher.token);
  check("teacher roster summarizes recorded lesson presence", rosterAfterLesson.body.students[0].attendance.lessonsAttended === 1
    && rosterAfterLesson.body.students[0].attendance.presentMs === 1800000
    && rosterAfterLesson.body.lessonCount === 2);
  const teacherMessageSocket = await openUserChannel(teacher.token);
  const studentMessageSocket = await openUserChannel(a.token);
  await api("/notification-preferences", teacher.token, { push: { messages: false } }, "PATCH");
  const teacherLiveUpdate = nextSocketEvent(teacherMessageSocket, (event) => event.kind === "conversation_sync" && Number(event.batchId) === c.id);
  const senderLiveUpdate = nextSocketEvent(studentMessageSocket, (event) => event.kind === "conversation_sync" && Number(event.batchId) === c.id);
  const studentMessage = await api(`/class-groups/${c.id}/messages`, a.token, { body: "Please explain question four in our next lesson." });
  check("student can post to the class conversation", studentMessage.status === 201 && studentMessage.body.senderRole === "student");
  check("teacher's open class conversation updates even when bell alerts are off", (await teacherLiveUpdate).type === "notification");
  check("another device signed in as the sender updates immediately", (await senderLiveUpdate).type === "notification");
  check("teacher sees a durable unread class-message count", (await api(`/class-groups/${c.id}`, teacher.token)).body.counts.unreadMessages === 1);
  const teacherInboxWithQuestion = await api("/message-inbox", teacher.token);
  check("teacher Messages shows the class question, sender and unread count", teacherInboxWithQuestion.body.classes.some((row) => row.batchId === c.id
    && row.lastMessage === "Please explain question four in our next lesson."
    && row.lastSenderName === a.user.name
    && row.unreadCount === 1
    && row.lastMessageFromMe === false));
  check("fetching messages alone does not fabricate a read acknowledgement", (await api(`/class-groups/${c.id}/messages`, teacher.token)).body.messages.some((m) => m.id === studentMessage.body.id) && (await api(`/class-groups/${c.id}`, teacher.token)).body.counts.unreadMessages === 1);
  check("teacher acknowledgement clears only the loaded conversation", (await api(`/class-groups/${c.id}/messages/read`, teacher.token, { lastMessageId: studentMessage.body.id })).body.unreadMessages === 0);
  check("teacher Messages clears the class badge after the discussion is read", (await api("/message-inbox", teacher.token)).body.classes.find((row) => row.batchId === c.id).unreadCount === 0);
  const studentReplyUpdate = nextSocketEvent(studentMessageSocket, (event) => event.kind === "conversation_sync" && Number(event.batchId) === c.id);
  const teacherMessage = await api(`/class-groups/${c.id}/messages`, teacher.token, { body: "I will explain it at the start of class." });
  check("teacher message creates a student unread badge", teacherMessage.status === 201 && (await api(`/class-groups/${c.id}`, a.token)).body.counts.unreadMessages === 1);
  check("teacher reply reaches the student's open class conversation live", (await studentReplyUpdate).type === "notification");
  teacherMessageSocket.close(); studentMessageSocket.close();
  check("student Messages shows the teacher reply as unread", (await api("/message-inbox", a.token)).body.classes.some((row) => row.batchId === c.id
    && row.lastMessage === "I will explain it at the start of class."
    && row.lastSenderName === teacher.user.name
    && row.unreadCount === 1));
  check("a message outside the conversation cannot clear its badge", (await api(`/class-groups/${c.id}/messages/read`, a.token, { lastMessageId: teacherMessage.body.id + 99999 })).status === 409 && (await api(`/class-groups/${c.id}`, a.token)).body.counts.unreadMessages === 1);
  check("student acknowledgement clears the loaded teacher message", (await api(`/class-groups/${c.id}/messages/read`, a.token, { lastMessageId: teacherMessage.body.id })).body.unreadMessages === 0);
  check("student cannot set class homework", (await api(`/class-groups/${c.id}/homework`, a.token, { title: "Not allowed" })).status === 403);
  const task = await api(`/class-groups/${c.id}/homework`, teacher.token, { title: "Algebra practice", instructions: "Complete questions 1 to 4." });
  check("teacher can set class homework", task.status === 201 && task.body.title === "Algebra practice");
  const studentBeforeHandIn = await api(`/class-groups/${c.id}`, a.token);
  check("student class home shows homework still to do", studentBeforeHandIn.body.counts.homework === 1 && studentBeforeHandIn.body.counts.homeworkToDo === 1 && studentBeforeHandIn.body.counts.homeworkLate === 0);
  const handedIn = await api(`/class-groups/${c.id}/homework/${task.body.id}/submit`, a.token, { note: "I completed all four questions." });
  check("student can hand in a text-first answer", handedIn.status === 200);
  check("student class home clears completed homework", (await api(`/class-groups/${c.id}`, a.token)).body.counts.homeworkToDo === 0);
  check("teacher class home shows the hand-in waiting for review", (await api(`/class-groups/${c.id}`, teacher.token)).body.counts.homeworkAwaitingReview === 1);
  check("teacher sees the student's homework submission", (await api(`/class-groups/${c.id}/homework`, teacher.token)).body.tasks[0].submissions.some((s) => s.studentId === a.user.id));
  check("another student cannot return feedback", (await api(`/class-groups/${c.id}/homework/${task.body.id}/submissions/${handedIn.body.id}/feedback`, b.token, { feedback: "Invented feedback" })).status === 403);
  const returned = await api(`/class-groups/${c.id}/homework/${task.body.id}/submissions/${handedIn.body.id}/feedback`, teacher.token, { feedback: "Good method. Check the sign in question four." });
  check("teacher can return clear individual feedback", returned.status === 200 && returned.body.status === "returned");
  const repeatedFeedback = await api(`/class-groups/${c.id}/homework/${task.body.id}/submissions/${handedIn.body.id}/feedback`, teacher.token, { feedback: "This must not replace the first review." });
  check("returned feedback is locked until the student submits a new version", repeatedFeedback.status === 409 && repeatedFeedback.body.error.includes("already been returned"));
  const feedbackInbox = await inbox(a, (event) => event.kind === "class_homework_feedback" && event.homeworkId === task.body.id);
  check("homework feedback remains in the student's notification inbox while signed out", feedbackInbox.some((row) => row.event.kind === "class_homework_feedback" && row.event.homeworkId === task.body.id));
  check("teacher class home clears reviewed hand-ins", (await api(`/class-groups/${c.id}`, teacher.token)).body.counts.homeworkAwaitingReview === 0);
  const studentHomework = await api(`/class-groups/${c.id}/homework`, a.token);
  check("student sees only their returned feedback", studentHomework.body.tasks[0].submission.feedback === "Good method. Check the sign in question four." && studentHomework.body.tasks[0].submission.studentId === a.user.id);
  const lateTask = await api(`/class-groups/${c.id}/homework`, teacher.token, { title: "Late practice", instructions: "You may still hand this in." });
  await q("UPDATE class_group_homework SET due_at=now() - interval '1 hour' WHERE id=$1", [lateTask.body.id]);
  const studentWithLateWork = await api(`/class-groups/${c.id}`, a.token);
  check("student class home identifies late unfinished work", studentWithLateWork.body.counts.homeworkLate === 1 && studentWithLateWork.body.counts.homeworkToDo === 1);
  check("student cannot add class materials", (await api(`/class-groups/${c.id}/materials`, a.token, { title: "Not allowed" })).status === 403);
  const material = await api(`/class-groups/${c.id}/materials`, teacher.token, { title: "Revision notes", note: "Read before class.", url: "https://example.com/notes" });
  check("teacher can share a safe class material link", material.status === 201 && material.body.url === "https://example.com/notes");
  check("student sees the shared class material", (await api(`/class-groups/${c.id}/materials`, a.token)).body.materials.some((m) => m.id === material.body.id));
  // Prove the conflict while the original lesson is still scheduled. Later in this
  // journey that lesson is intentionally completed, at which point it should no
  // longer block a student's timetable.
  const secondTeacher = await account("teacher");
  const clash = await offer(secondTeacher, { at: Date.parse(booked.lessons[0].startsAt) });
  const qc = await quote(clash.id, a);
  check("student timetable conflict refused atomically", (await book(clash.id, a, qc.quoteKey)).status === 409 && Number((await q("SELECT count(*) n FROM batch_test_contracts WHERE batch_id=$1", [clash.id])).rows[0].n) === 0);
  const bookingId = Number((await q("SELECT id FROM batch_test_bookings WHERE batch_id=$1 AND student_id=$2", [c.id, a.user.id])).rows[0].id);
  const decide = (position, event, note = "") => api(`/admin/batch-test-payments/${bookingId}/allocations/${position}/events`, operatorToken, { event, note });
  check("student cannot make a settlement decision", (await api(`/admin/batch-test-payments/${bookingId}/allocations/0/events`, a.token, { event: "lesson_delivered" })).status === 403);
  check("refund decision requires a reason", (await decide(1, "refund_approved")).status === 400);
  check("first lesson can be marked delivered", (await decide(0, "lesson_delivered")).status === 200);
  check("delivered lesson cannot skip the complaint window", (await decide(0, "payout_confirmed")).status === 409);
  check("complaint window can clear one delivered lesson", (await decide(0, "complaint_window_closed")).status === 200);
  check("cleared lesson can rehearse payout", (await decide(0, "payout_confirmed")).status === 200);
  check("second lesson can enter replacement decision", (await decide(1, "lesson_cancelled")).status === 200);
  check("operator can approve a reasoned lesson refund", (await decide(1, "refund_approved", "Teacher could not provide the promised lesson or replacement.")).status === 200);
  check("approved refund can be rehearsed", (await decide(1, "refund_confirmed")).status === 200);
  const settled = (await api("/admin/batch-test-payments", operatorToken)).body.receipts.find(r => r.bookingId === bookingId);
  check("lesson settlement reconciles held, teacher, Fadko and refund totals", settled.accounting.heldGrossNpr === 0 && settled.accounting.teacherPaidOutNpr === 2100 && settled.accounting.fadkoEarnedNpr === 900 && settled.accounting.refundedGrossNpr === 3000 && settled.accounting.actualMoneyMovedNpr === 0);
  check("student receipt sees the same simulated settlement", (await quote(c.id, a)).receipts[0].accounting.refundedGrossNpr === 3000);
  check("teacher receipt sees the same simulated settlement", (await quote(c.id, teacher)).receipts[0].accounting.teacherPaidOutNpr === 2100);
  await assert.rejects(q("UPDATE batch_test_payments SET receipt='{}' WHERE booking_id=(SELECT id FROM batch_test_bookings WHERE batch_id=$1 AND student_id=$2)", [c.id, a.user.id]), /SIMULATED_RECEIPT_IMMUTABLE/); passed++; console.log("PASS simulated capture cannot be rewritten");
  await assert.rejects(q("UPDATE batch_test_ledger_entries SET detail='{}' WHERE booking_id=$1", [bookingId]), /SIMULATED_LEDGER_IMMUTABLE/); passed++; console.log("PASS simulated settlement history cannot be rewritten");
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
  const secondBooking = await book(c.id, b, qb.quoteKey);
  check("second student shares the same lesson rooms", secondBooking.body.lessons[0].sessionId === sid);
  const lateJoinerInbox = await inbox(b, (event) => event.kind === "class_homework_set" && event.batchId === c.id, 2);
  check("a student joining after homework was assigned receives each open task", lateJoinerInbox.filter((row) => row.event.kind === "class_homework_set" && row.event.batchId === c.id).length === 2);
  const secondBookingId = Number((await q("SELECT id FROM batch_test_bookings WHERE batch_id=$1 AND student_id=$2", [c.id, b.user.id])).rows[0].id);
  await q("INSERT INTO session_participation (session_id,user_id,role,present_ms,join_count) VALUES ($1,$2,'teacher',60000,1)", [sid, teacher.user.id]);
  check("teacher can finish the recorded test lesson", (await api(`/sessions/${sid}`, teacher.token, { status: "completed" }, "PATCH")).status === 200);
  const automaticDelivery = await quote(c.id, b);
  check("classroom completion and teacher presence automatically start review", automaticDelivery.receipts.find(r => r.bookingId === secondBookingId).allocations[0].state === "delivered_pending");
  const complaint = await api("/disputes", b.token, { reason: "Refund Request", description: "Synthetic student asks support to review this lesson.", sessionId: sid });
  check("student opens their own class complaint", complaint.status === 201);
  const automaticComplaint = await quote(c.id, b);
  check("student case automatically freezes only its lesson", automaticComplaint.receipts.find(r => r.bookingId === secondBookingId).allocations[0].state === "disputed" && automaticComplaint.receipts.find(r => r.bookingId === secondBookingId).allocations[1].state === "future");
  check("one student's complaint does not freeze another student's settlement", (await quote(c.id, a)).receipts[0].allocations[0].state === "paid_out");
  const secondSid = booked.lessons[1].sessionId;
  check("teacher cancellation is recorded by the session, not an operator button", (await api(`/sessions/${secondSid}`, teacher.token, { status: "cancelled" }, "PATCH")).status === 200);
  const automaticCancellation = await quote(c.id, b);
  const operatorCancellation = (await api("/admin/batch-test-payments", operatorToken)).body.receipts.find(r => r.bookingId === secondBookingId);
  check("cancelled lesson automatically waits for replacement or refund", automaticCancellation.receipts.find(r => r.bookingId === secondBookingId).allocations[1].state === "replacement_pending" && operatorCancellation.allocations[1].state === "replacement_pending" && operatorCancellation.needsAttention);
  await grantAccount(outsider, "student");
  const qo = await quote(c.id, outsider);
  check("capacity remains enforced", (await book(c.id, outsider, qo.quoteKey)).status === 409);
  check("no duplicate lesson rows for second student", Number((await q("SELECT count(*) n FROM batch_test_sessions WHERE batch_id=$1", [c.id])).rows[0].n) === 2);
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
