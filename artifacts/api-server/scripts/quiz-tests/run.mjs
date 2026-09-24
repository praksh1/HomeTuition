/** Real API against a disposable local database. Refuses remote database targets. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const { Pool } = createRequire(path.join(root, "lib/db/package.json"))("pg");
const dbUrl = process.env.PGURL ?? process.env.DATABASE_URL;
assert.ok(dbUrl && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(dbUrl).hostname), "Disposable local database only");
const pool = new Pool({ connectionString: dbUrl });
const port = 8126;
let log = "", passed = 0;
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`); };
const child = spawn(process.execPath, [path.join(root, "artifacts/api-server/dist/index.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_URL: dbUrl, NODE_ENV: "test", SESSION_SECRET: "quiz-ci-synthetic-only", VIDEO_PROVIDER: "echo" }, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", x => log += x); child.stderr.on("data", x => log += x);
async function api(route, token, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") };
}
async function account(role) {
  const r = await api("/auth/register", null, { name: `Quiz ${role}`, email: `${randomUUID()}@example.invalid`, password: "Synthetic-test-123!", role, subject: "Maths", grade: "10", dateOfBirth: "2000-01-01" });
  assert.ok(r.status < 300, JSON.stringify(r)); return r.body;
}
async function fixture(teacher, student) {
  const p = await pool.query("INSERT INTO learning_programs(teacher_id,type,title) VALUES ($1,'short_course','Quiz fixture') RETURNING id", [teacher.user.id]);
  const b = await pool.query("INSERT INTO learning_program_batches(program_id) VALUES ($1) RETURNING id", [p.rows[0].id]);
  const id = b.rows[0].id;
  await pool.query("INSERT INTO batch_test_contracts(batch_id,snapshot,teacher_grant_id) VALUES ($1,'{}',0)", [id]);
  await pool.query("INSERT INTO batch_test_bookings(batch_id,student_id,student_grant_id,quote) VALUES ($1,$2,0,'{}')", [id, student.user.id]);
  return id;
}
const content = () => ({ requestKey: randomUUID(), title: "Maths practice", dueAt: null, questions: [
  { id: "q1", prompt: "2 + 2?", kind: "choice", options: ["3", "4", "5"], answer: "4", points: 2, confirmed: false },
  { id: "q2", prompt: "Capital of Nepal?", kind: "short", options: [], answer: "Kathmandu", points: 1, confirmed: false },
] });
try {
  for (let i = 0; i < 300; i++) {
    try { if ((await api("/healthz")).status === 200 && log.includes("learning program and test-booking tables are present")) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const teacher = await account("teacher"), student = await account("student"), stranger = await account("student"), other = await account("teacher");
  const batch = await fixture(teacher, student), otherBatch = await fixture(other, stranger);
  const base = `/class-groups/${batch}/quizzes`;
  check("unauthenticated reads refused", (await api(base)).status === 401);
  check("unenrolled reads refused", (await api(base, stranger.token)).status === 403);
  check("other teacher refused", (await api(base, other.token)).status === 403);
  check("students cannot create", (await api(base, student.token, content())).status === 403);
  check("invalid class ids refused", (await api("/class-groups/NaN/quizzes", teacher.token)).status === 400);
  const initial = content();
  const made = await api(base, teacher.token, initial);
  assert.equal(made.status, 201, JSON.stringify(made)); const qid = made.body.quiz.id, item = `${base}/${qid}`;
  const createRetries = await Promise.all(Array.from({ length: 6 }, () => api(base, teacher.token, initial)));
  check("lost-response draft retries do not create duplicates", createRetries.every(r => r.body.quiz.id === qid));
  check("draft remains private in list", (await api(base, student.token)).body.items.length === 0);
  check("student cannot guess draft id", (await api(item, student.token)).status === 404);
  check("teacher reads draft key privately without caching", (await api(item, teacher.token)).cache === "private, no-store");
  check("unreviewed publish refused", (await api(`${item}/publish`, teacher.token, { revision: 1 })).status === 400);
  const reviewed = content(); reviewed.questions.forEach(q => q.confirmed = true);
  check("bad correct choice refused", (await api(item, teacher.token, { ...reviewed, revision: 1, questions: [{ ...reviewed.questions[0], answer: "No" }] }, "PUT")).status === 400);
  const saved = await api(item, teacher.token, { ...reviewed, revision: 1 }, "PUT");
  check("reviewed draft saves with next revision", saved.status === 200 && saved.body.quiz.revision === 2);
  check("concurrent stale edit refused", (await api(item, teacher.token, { ...reviewed, revision: 1 }, "PUT")).status === 409);
  check("stale publication refused", (await api(`${item}/publish`, teacher.token, { revision: 1 })).status === 409);
  check("student cannot publish", (await api(`${item}/publish`, student.token, { revision: 2 })).status === 403);
  check("teacher publication succeeds", (await api(`${item}/publish`, teacher.token, { revision: 2 })).status === 200);
  for (let i = 0; i < 40; i++) {
    const delivered = await pool.query("select count(*) n from user_notification_events where user_id=$1 and event->>'kind'='class_quiz_published'", [student.user.id]);
    if (Number(delivered.rows[0].n) === 1) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const notices = await pool.query("select event from user_notification_events where user_id=$1 and event->>'kind'='class_quiz_published'", [student.user.id]);
  check("publication creates a durable enrolled-student notification", notices.rows.length === 1 && notices.rows[0].event.batchId === batch);
  check("notification contains no questions or answers", !JSON.stringify(notices.rows).includes("Kathmandu"));
  check("published content cannot change", (await api(item, teacher.token, { ...reviewed, revision: 2 }, "PUT")).status === 409);
  check("published quiz cannot be deleted", (await api(item, teacher.token, undefined, "DELETE")).status === 409);
  const publicQuiz = await api(item, student.token);
  check("questions never leak the key or confirmation metadata", publicQuiz.status === 200 && publicQuiz.body.quiz.questions.every(q => !("answer" in q) && !("confirmed" in q)));
  check("list never includes questions or answers", (await api(base, student.token)).body.items.every(q => !("questions" in q) && !("answer" in q)));
  check("path cannot borrow another class permission", (await api(`/class-groups/${otherBatch}/quizzes/${qid}`, other.token)).status === 404);
  check("teacher cannot submit as student", (await api(`${item}/submit`, teacher.token, { answers: { q1: "4", q2: "Kathmandu" } })).status === 403);
  check("missing question refused", (await api(`${item}/submit`, student.token, { answers: { q1: "4" } })).status === 400);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => api(`${item}/submit`, student.token, { answers: { q1: "4", q2: " kathmandu  " }, score: 999 })));
  check("eight submissions have one immutable result", concurrent.every(r => r.status === 200 && r.body.attempt.id === concurrent[0].body.attempt.id));
  check("server grades rather than trusting supplied score", concurrent.every(r => r.body.attempt.score === 3 && r.body.attempt.possible === 3));
  check("no extra attempt is stored", Number((await pool.query("select count(*) n from class_quiz_attempts where quiz_id=$1", [qid])).rows[0].n) === 1);
  check("resubmit cannot change original answers", (await api(`${item}/submit`, student.token, { answers: { q1: "3", q2: "wrong" } })).body.attempt.score === 3);
  check("own saved attempt survives revisit", (await api(item, student.token)).body.attempt.score === 3);
  check("submitted student still cannot fetch open key", !("answer" in (await api(item, student.token)).body.quiz.questions[0]));
  check("student cannot read classmates results", (await api(`${item}/results`, student.token)).status === 403);
  check("teacher sees named result", (await api(`${item}/results`, teacher.token)).body.items[0].score === 3);
  const registered = await pool.query("INSERT INTO users(email,name,password_hash,role) SELECT 'quiz-' || $1 || '-' || n || '@example.invalid','Student ' || n,'unused','student' FROM generate_series(1,45) n RETURNING id", [randomUUID()]);
  for (const row of registered.rows) await pool.query("INSERT INTO class_quiz_attempts(quiz_id,student_id,revision,answers,score,possible) VALUES ($1,$2,2,'{}',0,3)", [qid, row.id]);
  const first = await api(`${item}/results`, teacher.token), second = await api(`${item}/results?before=${first.body.nextCursor}`, teacher.token);
  check("large class results paginate in bounded groups", first.body.items.length === 20 && second.body.items.length === 20 && first.body.nextCursor);
  check("result pages do not repeat students", second.body.items.every(s => !first.body.items.some(r => r.id === s.id)));
  check("student cannot close quiz", (await api(`${item}/close`, student.token, {})).status === 403);
  check("teacher can close submissions", (await api(`${item}/close`, teacher.token, {})).status === 200);
  check("closed quiz reveals key", (await api(item, student.token)).body.quiz.questions[0].answer === "4");
  check("retry after close still recovers saved submission", (await api(`${item}/submit`, student.token, { answers: {} })).body.attempt.score === 3);
  const extra = await account("student");
  await pool.query("INSERT INTO batch_test_bookings(batch_id,student_id,student_grant_id,quote) VALUES ($1,$2,0,'{}')", [batch, extra.user.id]);
  check("first submission after close refused", (await api(`${item}/submit`, extra.token, { answers: { q1: "4", q2: "Kathmandu" } })).status === 409);
  const timed = await api(base, teacher.token, { ...reviewed, requestKey: randomUUID(), dueAt: "2000-01-01T00:00:00Z" });
  check("past deadline cannot be published", (await api(`${base}/${timed.body.quiz.id}/publish`, teacher.token, { revision: 1 })).status === 400);
  check("draft can be removed", (await api(`${base}/${timed.body.quiz.id}`, teacher.token, undefined, "DELETE")).status === 200);
  const deadlineQuiz = await api(base, teacher.token, { ...reviewed, requestKey: randomUUID(), dueAt: new Date(Date.now() + 60000).toISOString() });
  const deadlineItem = `${base}/${deadlineQuiz.body.quiz.id}`;
  await api(`${deadlineItem}/publish`, teacher.token, { revision: 1 });
  await pool.query("UPDATE class_quizzes SET due_at=now()-interval '1 second' WHERE id=$1", [deadlineQuiz.body.quiz.id]);
  check("server deadline prevents late first attempts", (await api(`${deadlineItem}/submit`, extra.token, { answers: { q1: "4", q2: "Kathmandu" } })).status === 409);
  check("deadline reveals answers in detail", (await api(deadlineItem, extra.token)).body.quiz.questions[0].answer === "4");
  await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1", [student.user.id]);
  check("suspended account with existing token is refused", (await api(item, student.token)).status === 403);
  console.log(`\n${passed} quiz integration checks passed`);
} catch (error) { console.error(log.slice(-3500)); throw error; }
finally { child.kill(); await pool.end(); }
