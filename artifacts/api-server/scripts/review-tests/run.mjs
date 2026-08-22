/**
 * What a review says, and who it says it about.
 *
 * Two things are being pinned down here, and both were reported by the owner:
 *
 * 1. A review is the student's own words. The app used to invent them — every review in the
 *    database read "Great teacher! Rated 4 stars." under a real student's name, whatever that
 *    student actually thought.
 * 2. Nobody is told who wrote it. "When a student reviews a teacher and the teacher sees it,
 *    it should be shown as anonymous." The list is public, so this has to hold for a signed
 *    out reader, for another student, and for the teacher — anonymity that only covers the
 *    teacher's own screen is not anonymity, because the teacher can use any of the other
 *    doors.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/review-tests/run.mjs
 * Needs PGURL to finish a class without waiting for it to run.
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

const sql = (statement) => execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" }).trim();

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
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email: `rv_${Date.now()}_${seq}@example.com`,
    password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A class in the past that has finished, which is what earns a student the right to review. */
async function finishedClassWith(teacher, student) {
  seq += 1;
  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Review ${seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + 60_000).toISOString(),
    duration: 60, price: 500, maxStudents: 10,
  } });
  if (created.status > 201) throw new Error(`create: ${created.status} ${JSON.stringify(created.body)}`);
  const booked = await api(`/sessions/${created.body.id}/book`, {
    method: "POST", token: student.token, body: { paymentMethod: "esewa" },
  });
  if (booked.status > 201) throw new Error(`book: ${booked.status} ${JSON.stringify(booked.body)}`);
  // Yesterday, and over: inside the seven-day window and past its end.
  sql(`update sessions set status='completed', date = now() - interval '1 day' where id = ${created.body.id}`);
  return created.body.id;
}

/** The teacher's public profile id, which is what the reviews list is keyed on. */
function profileIdFor(teacherUserId) {
  return sql(`select id from teacher_profiles where user_id = ${teacherUserId}`);
}

async function run() {
  console.log("\nA review is the student's own words\n");

  const teacher = await register("teacher", "Ram Prasad");
  const student = await register("student", "Sita Sharma");
  await finishedClassWith(teacher, student);
  const profileId = profileIdFor(teacher.user.id);

  const written = await api("/reviews", { method: "POST", token: student.token, body: {
    teacherId: teacher.user.id, rating: 4, comment: "Explained fractions really clearly.",
  } });
  check("a student can leave a written review", written.status === 201, `status=${written.status}`);
  check("their words are stored as written",
    written.body?.comment === "Explained fractions really clearly.", written.body?.comment);

  const second = await register("student", "Bikash Thapa");
  await finishedClassWith(teacher, second);
  const starsOnly = await api("/reviews", { method: "POST", token: second.token, body: {
    teacherId: teacher.user.id, rating: 5,
  } });
  check("a rating with nothing written is still accepted", starsOnly.status === 201, `status=${starsOnly.status}`);
  check("and no sentence is invented on their behalf", starsOnly.body?.comment === "", JSON.stringify(starsOnly.body?.comment));

  const third = await register("student", "Gita Rai");
  await finishedClassWith(teacher, third);
  const tooLong = await api("/reviews", { method: "POST", token: third.token, body: {
    teacherId: teacher.user.id, rating: 3, comment: "x".repeat(1001),
  } });
  check("an essay is refused rather than truncated", tooLong.status === 400, `status=${tooLong.status}`);

  console.log("\nNobody is told who wrote it\n");

  const asTeacher = await api(`/teachers/${profileId}/reviews?limit=10`, { token: teacher.token });
  check("the teacher can read their reviews", asTeacher.status === 200, `status=${asTeacher.status}`);
  const teacherText = JSON.stringify(asTeacher.body);
  check("the teacher is not shown the reviewer's name",
    !teacherText.includes("Sita Sharma") && !teacherText.includes("Bikash Thapa"), teacherText.slice(0, 240));
  check("nor an id they could match against their own class list",
    !("studentId" in (asTeacher.body?.reviews?.[0] ?? {})), Object.keys(asTeacher.body?.reviews?.[0] ?? {}).join(","));
  check("nor a studentName field left empty for the app to fill in",
    !("studentName" in (asTeacher.body?.reviews?.[0] ?? {})), Object.keys(asTeacher.body?.reviews?.[0] ?? {}).join(","));
  check("none of them are marked as the teacher's own",
    (asTeacher.body?.reviews ?? []).every((r) => r.mine === false));

  // The door a teacher would actually use to get round a screen that hides names.
  const signedOut = await api(`/teachers/${profileId}/reviews?limit=10`);
  check("a signed-out reader is not shown names either",
    !JSON.stringify(signedOut.body).includes("Sita Sharma"), JSON.stringify(signedOut.body).slice(0, 240));

  const otherStudent = await register("student", "Uninvolved");
  const asOther = await api(`/teachers/${profileId}/reviews?limit=10`, { token: otherStudent.token });
  check("another student is not shown names either",
    !JSON.stringify(asOther.body).includes("Sita Sharma"), JSON.stringify(asOther.body).slice(0, 240));
  check("and none of the reviews are marked as theirs",
    (asOther.body?.reviews ?? []).every((r) => r.mine === false));

  const asAuthor = await api(`/teachers/${profileId}/reviews?limit=10`, { token: student.token });
  const mine = (asAuthor.body?.reviews ?? []).filter((r) => r.mine);
  check("the person who wrote one can recognise it", mine.length === 1, `${mine.length} marked as mine`);
  check("and it is the right one", mine[0]?.comment === "Explained fractions really clearly.", mine[0]?.comment);
  check("without the others becoming theirs too",
    (asAuthor.body?.reviews ?? []).filter((r) => !r.mine).length >= 1);

  console.log("\nThe name is still written down, it just never leaves\n");

  const storedName = sql(`select student_name from reviews where id = ${written.body.id}`);
  check("the reviewer is still recorded, for investigating an abusive review",
    storedName === "Sita Sharma", storedName);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
