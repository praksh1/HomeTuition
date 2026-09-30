import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Explicitly staging-only. Secrets remain in Railway's child-process environment, never stdout.
const origin = "https://hometuition-api-staging-production.up.railway.app";
assert.equal(process.env.RAILWAY_SERVICE_NAME, "hometuition-api-staging");
assert.equal(process.env.PUBLIC_APP_URL, "https://hometuition-preview.praksh-dhakal.workers.dev");
assert(process.env.DATABASE_URL && process.env.SESSION_SECRET, "Staging credentials unavailable");
assert(!process.env.ESEWA_MERCHANT_ID && !process.env.KHALTI_SECRET_KEY && !process.env.PAYMENT_WEBHOOK_SECRET,
  "This check must not run in a live-payment environment");
const { Client } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
const jwt = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("jsonwebtoken");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
let fixtures;
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  fixtures = (await client.query(`SELECT id, email, role FROM users
    WHERE email LIKE $1 AND name IN ($2, $3) AND role IN ('teacher', 'student')
      AND suspended_at IS NULL ORDER BY id`,
  ["staging.%@example.com", "Staging Review Teacher", "Staging Review Student"])).rows;
  assert(fixtures.some(row => row.role === "student") && fixtures.some(row => row.role === "teacher"),
    "The named synthetic teacher/student fixtures are not available");
  await client.query("ROLLBACK");
} finally {
  await client.end();
}

async function get(path, token) {
  const response = await fetch(`${origin}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  assert.equal(response.status, 200, `Read-only request failed: ${path.split("?")[0]} HTTP ${response.status}`);
  return { body: await response.json(), headers: response.headers };
}
const student = fixtures.find(row => row.role === "student");
const teacher = fixtures.find(row => row.role === "teacher");
const tokenFor = row => jwt.sign({ userId: row.id, email: row.email, role: row.role }, process.env.SESSION_SECRET,
  { expiresIn: "2m" });
const studentToken = tokenFor(student);
const teacherToken = tokenFor(teacher);
const catalogue = await get("/programs?limit=50&presentation=class&personalized=1", studentToken);
assert.match(catalogue.headers.get("cache-control") ?? "", /private/);
assert.match(catalogue.headers.get("vary") ?? "", /authorization/i);
assert(Array.isArray(catalogue.body.programs), "Catalogue unavailable");
const enrolled = catalogue.body.programs.filter(row => Number.isSafeInteger(row.myClass?.batchId));
assert(enrolled.length > 0, "No existing synthetic purchased class available for this check");
for (const card of enrolled.slice(0, 3)) {
  const detail = await get(`/programs/${card.id}?personalized=1`, studentToken);
  assert.equal(detail.body.program.myClass.batchId, card.myClass.batchId, "Catalogue/detail purchased batch mismatch");
  const home = await get(`/class-groups/${card.myClass.batchId}`, studentToken);
  assert.equal(home.body.isTeacher, false);
  assert(home.body.lessons.length > 0);
  assert(home.body.lessons.every(lesson => ["joined", "not_recorded", "not_enrolled", "unavailable"].includes(lesson.attendance)),
    "A lesson lacks an explicit viewer-only attendance state");
  assert(home.body.lessons.every(lesson => !Object.hasOwn(lesson, "email") && !Object.hasOwn(lesson, "userId")),
    "History must not expose another participant's account");
  const anonymous = await get(`/programs/${card.id}?personalized=1`);
  assert(!Object.hasOwn(anonymous.body.program, "myClass"), "Anonymous visitor received a student's enrollment");
  const teacherView = await get(`/class-groups/${card.myClass.batchId}`, teacherToken);
  assert.equal(teacherView.body.isTeacher, true, "The named fixture teacher does not own this test class");
  assert(teacherView.body.lessons.every(lesson => !Object.hasOwn(lesson, "attendance")),
    "Teacher response must not contain viewer-student attendance");
}
console.log(`PASS: real Preview SQL and authenticated catalogue/detail/history reads for ${Math.min(enrolled.length, 3)} synthetic classes; no database writes, payments, emails or classroom joins.`);
