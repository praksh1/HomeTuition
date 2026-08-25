/**
 * The monthly portal, end to end: one conversation, pinning, and homework that comes back marked.
 *
 * Starts its own API with the file store pointed at the same stand-in the upload suite uses, so
 * homework files are really signed, really uploaded and really read back — a portal tested
 * against a mock file store would prove nothing about the one feature it exists for.
 *
 * Usage: node scripts/portal-tests/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeR2 } from "../upload-tests/fake-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

const R2_PORT = Number(process.env.FAKE_R2_PORT ?? 9403);
const API_PORT = Number(process.env.PORTAL_API_PORT ?? 8094);
const API = `http://127.0.0.1:${API_PORT}`;
const BUCKET = "hometuition-test";
const KEY_ID = "test-access-key";
const SECRET = "test-secret-key-not-a-real-one";
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, {
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
  const email = `po_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

/** A real PNG — small, and genuinely a PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Signs, uploads and returns the key — the real round trip a phone would make. */
async function upload(token, name = "work.png") {
  const signed = await api("/storage/uploads/request-url", { method: "POST", token, body: {
    name, size: PNG.length, contentType: "image/png" } });
  if (signed.status !== 200) throw new Error(`sign: ${signed.status} ${JSON.stringify(signed.body)}`);
  const { uploadURL, objectPath } = signed.body ?? {};
  if (!uploadURL || !objectPath) throw new Error(`sign returned no link: ${JSON.stringify(signed.body)}`);
  const put = await fetch(uploadURL, {
    method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG,
  });
  if (!put.ok) throw new Error(`upload: ${put.status} ${await put.text()}`);
  return objectPath;
}

async function teacherWithClass() {
  const teacher = await register("teacher");
  await api("/monthly/plan", { method: "POST", token: teacher.token, body: {} });
  const made = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "Algebra", startMinute: 9 * 60, monthlyPrice: 3000 } });
  if (made.status > 201) throw new Error(`class: ${made.status} ${JSON.stringify(made.body)}`);
  return { teacher, klass: made.body.class };
}

async function joinAs(klassId) {
  const student = await register("student");
  const res = await api(`/monthly/classes/${klassId}/join`, { method: "POST", token: student.token, body: {} });
  if (res.status !== 201) throw new Error(`join: ${res.status} ${JSON.stringify(res.body)}`);
  return student;
}

/* ------------------------------------------------------------------ the thread */

async function threadTests() {
  console.log("\nOne conversation for the whole month");

  const { teacher, klass } = await teacherWithClass();
  const alice = await joinAs(klass.id);
  const bob = await joinAs(klass.id);
  const stranger = await register("student");

  const posted = await api(`/monthly/classes/${klass.id}/messages`, { method: "POST", token: teacher.token, body: { body: "Bring your compass tomorrow." } });
  check("the teacher can post", posted.status === 201, `status ${posted.status} ${JSON.stringify(posted.body)?.slice(0, 120)}`);
  check("and is badged as the teacher", posted.body?.senderRole === "teacher", `role ${posted.body?.senderRole}`);

  const fromAlice = await api(`/monthly/classes/${klass.id}/messages`, { method: "POST", token: alice.token, body: { body: "Will do." } });
  check("a student in the month can post", fromAlice.status === 201, `status ${fromAlice.status}`);

  const seen = await api(`/monthly/classes/${klass.id}/messages`, { token: bob.token });
  check("another student sees both messages", (seen.body?.messages ?? []).length === 2, `${(seen.body?.messages ?? []).length} messages`);
  check("and is not offered a pin button", seen.body?.canPin === false, `canPin ${seen.body?.canPin}`);
  check("and can write", seen.body?.readOnly === false, `readOnly ${seen.body?.readOnly}`);

  const outside = await api(`/monthly/classes/${klass.id}/messages`, { token: stranger.token });
  check("somebody with no place cannot read it", outside.status === 403, `status ${outside.status}`);
  const outsidePost = await api(`/monthly/classes/${klass.id}/messages`, { method: "POST", token: stranger.token, body: { body: "hello" } });
  check("nor post to it", outsidePost.status === 403, `status ${outsidePost.status}`);

  const empty = await api(`/monthly/classes/${klass.id}/messages`, { method: "POST", token: alice.token, body: { body: "   " } });
  check("an empty message is refused", empty.status === 400, `status ${empty.status}`);

  const huge = await api(`/monthly/classes/${klass.id}/messages`, { method: "POST", token: alice.token, body: { body: "x".repeat(2100) } });
  check("an essay is refused", huge.status === 400, `status ${huge.status}`);

  // One conversation, not thirty: it hangs off the course, never off a class-day.
  const onDays = Number(sql(`select count(*) from session_messages where recurring_id = ${klass.id} and session_id is not null`));
  check("no message is pinned to a single class-day", onDays === 0, `${onDays} are`);
  const total = Number(sql(`select count(*) from session_messages where recurring_id = ${klass.id}`));
  check("all of them belong to the course", total === 2, `${total} messages`);

  return { teacher, klass, alice, bob, firstMessageId: posted.body.id };
}

async function pinningTests(ctx) {
  console.log("\nPinning, so the thing that matters does not scroll away");

  const { teacher, klass, alice, firstMessageId } = ctx;

  const byStudent = await api(`/monthly/messages/${firstMessageId}/pin`, { method: "PATCH", token: alice.token, body: { pinned: true } });
  check("a student cannot pin", byStudent.status === 403, `status ${byStudent.status}`);

  const pinned = await api(`/monthly/messages/${firstMessageId}/pin`, { method: "PATCH", token: teacher.token, body: { pinned: true } });
  check("the teacher can pin", pinned.status === 200, `status ${pinned.status}`);
  check("and it is recorded as pinned", Boolean(pinned.body?.message?.pinnedAt), JSON.stringify(pinned.body?.message)?.slice(0, 120));

  const seen = await api(`/monthly/classes/${klass.id}/messages`, { token: alice.token });
  check("everyone sees the pinned message separately", (seen.body?.pinned ?? []).length === 1, `${(seen.body?.pinned ?? []).length} pinned`);
  check("and it is the right one", seen.body?.pinned?.[0]?.id === firstMessageId, `${seen.body?.pinned?.[0]?.id}`);

  /*
   * The point of returning it separately: it has to still be there when the thread has moved on.
   *
   * The read returns one page, so a pin from three weeks ago is not in `messages` at all. Two
   * hundred messages is a page, so pushing it past that proves the pin survives being scrolled
   * out of reach rather than merely being duplicated on the same page.
   */
  sql(`insert into session_messages (recurring_id, sender_id, sender_name, sender_role, body)
       select ${klass.id}, ${teacher.user.id}, 'Teacher', 'teacher', 'filler ' || g
         from generate_series(1, 210) g`);
  const later = await api(`/monthly/classes/${klass.id}/messages`, { token: alice.token });
  const inPage = (later.body?.messages ?? []).some((m) => m.id === firstMessageId);
  check("setup: the pinned message has scrolled off the page", inPage === false, "it is still on the page");
  check("but it still comes back pinned", (later.body?.pinned ?? []).some((m) => m.id === firstMessageId), `${(later.body?.pinned ?? []).length} pinned`);

  /*
   * And the page you land on is the end of the conversation, not the start of it.
   *
   * Reading the oldest two hundred of a month-long thread opens the chat four weeks in the past
   * and hides everything said today — backwards for the thing a student checks to find out
   * where their class is.
   */
  const last = later.body?.messages?.[later.body.messages.length - 1];
  const newest = Number(sql(`select max(id) from session_messages where recurring_id = ${klass.id}`));
  check("the page opens on the newest messages", last?.id === newest, `page ends at ${last?.id}, newest is ${newest}`);
  check("in the order they were said", (later.body?.messages ?? []).every((m, i, all) => i === 0 || all[i - 1].id < m.id), "out of order");
  check("and it says how much came before", (later.body?.earlier ?? 0) > 0, `earlier ${later.body?.earlier}`);

  const unpinned = await api(`/monthly/messages/${firstMessageId}/pin`, { method: "PATCH", token: teacher.token, body: { pinned: false } });
  check("the teacher can unpin", unpinned.status === 200 && unpinned.body?.message?.pinnedAt === null, JSON.stringify(unpinned.body?.message?.pinnedAt));
  const after = await api(`/monthly/classes/${klass.id}/messages`, { token: alice.token });
  check("and it stops being pinned for everyone", (after.body?.pinned ?? []).length === 0, `${(after.body?.pinned ?? []).length} still pinned`);
}

/* ---------------------------------------------------------------- homework */

async function homeworkTests() {
  console.log("\nHomework: out, in, and back marked");

  const { teacher, klass } = await teacherWithClass();
  const alice = await joinAs(klass.id);
  const bob = await joinAs(klass.id);

  const sheetKey = await upload(teacher.token, "questions.png");
  const set = await api(`/monthly/classes/${klass.id}/homework`, { method: "POST", token: teacher.token, body: {
    title: "Algebra sheet 3", instructions: "Questions 1 to 10.", fileKey: sheetKey, fileType: "image/png" } });
  check("the teacher can set homework", set.status === 201, `status ${set.status} ${JSON.stringify(set.body)?.slice(0, 140)}`);
  check("and the class is told", set.body?.studentsTold === 2, `told ${set.body?.studentsTold}`);
  const hwId = set.body?.homework?.id;

  const noFile = await api(`/monthly/classes/${klass.id}/homework`, { method: "POST", token: teacher.token, body: {
    title: "Read chapter 4" } });
  check("homework without a file is allowed", noFile.status === 201, `status ${noFile.status}`);

  const noTitle = await api(`/monthly/classes/${klass.id}/homework`, { method: "POST", token: teacher.token, body: { instructions: "x" } });
  check("homework without a title is refused", noTitle.status === 400, `status ${noTitle.status}`);

  const byStudent = await api(`/monthly/classes/${klass.id}/homework`, { method: "POST", token: alice.token, body: { title: "x" } });
  check("a student cannot set homework", byStudent.status === 403, `status ${byStudent.status}`);

  // The student can open the question sheet, although they did not upload it.
  const opened = await api(`/storage/file?key=${encodeURIComponent(sheetKey)}`, { token: alice.token });
  check("a student can open the question sheet", opened.status === 200 && Boolean(opened.body?.url), `status ${opened.status}`);
  const outsider = await register("student");
  const refused = await api(`/storage/file?key=${encodeURIComponent(sheetKey)}`, { token: outsider.token });
  check("somebody outside the class cannot", refused.status === 403, `status ${refused.status}`);

  // Handing in.
  const aliceKey = await upload(alice.token, "alice.png");
  const handedIn = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: {
    fileKey: aliceKey, fileType: "image/png", note: "Q7 was hard" } });
  check("a student can hand work in", handedIn.status === 201, `status ${handedIn.status} ${JSON.stringify(handedIn.body)?.slice(0, 140)}`);
  const subId = handedIn.body?.submission?.id;

  const bobKey = await upload(bob.token, "bob.png");
  await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: bob.token, body: { fileKey: bobKey, fileType: "image/png" } });

  // Handing in again replaces, never adds.
  const aliceAgain = await upload(alice.token, "alice-better.png");
  const replaced = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: {
    fileKey: aliceAgain, fileType: "image/png" } });
  check("handing in again is allowed", replaced.status === 201, `status ${replaced.status}`);
  const rows = Number(sql(`select count(*) from homework_submissions where homework_id = ${hwId} and student_id = ${alice.user.id}`));
  check("and replaces the answer rather than adding one", rows === 1, `${rows} answers`);
  const currentKey = sql(`select file_key from homework_submissions where homework_id = ${hwId} and student_id = ${alice.user.id}`);
  check("the newer file is the one that counts", currentKey === aliceAgain, `stored ${currentKey}`);

  // Nobody reads anybody else's work.
  const nosy = await api(`/storage/file?key=${encodeURIComponent(bobKey)}`, { token: alice.token });
  check("a student cannot open another student's work", nosy.status === 403, `status ${nosy.status}`);
  const byTeacher = await api(`/storage/file?key=${encodeURIComponent(bobKey)}`, { token: teacher.token });
  check("but the teacher can", byTeacher.status === 200, `status ${byTeacher.status}`);

  const mine = await api(`/monthly/classes/${klass.id}/homework`, { token: alice.token });
  const hers = (mine.body?.homework ?? []).find((h) => h.id === hwId);
  check("a student sees their own answer", Boolean(hers?.submission), JSON.stringify(hers)?.slice(0, 140));
  const anyOther = JSON.stringify(mine.body).includes(bobKey);
  check("and nobody else's", anyOther === false, "another student's file appeared in the response");

  const asTeacher = await api(`/monthly/classes/${klass.id}/homework`, { token: teacher.token });
  const counted = (asTeacher.body?.homework ?? []).find((h) => h.id === hwId);
  check("the teacher sees how many handed in", counted?.handedIn === 2, `${counted?.handedIn} handed in`);
  check("and how many are still to mark", counted?.marked === 0, `${counted?.marked} marked`);

  const submissions = await api(`/monthly/homework/${hwId}/submissions`, { token: teacher.token });
  check("the teacher can list what came in", (submissions.body?.submissions ?? []).length === 2, `${(submissions.body?.submissions ?? []).length}`);
  check("with names attached", Boolean(submissions.body?.submissions?.[0]?.studentName), JSON.stringify(submissions.body?.submissions?.[0])?.slice(0, 120));
  const studentList = await api(`/monthly/homework/${hwId}/submissions`, { token: alice.token });
  check("a student cannot list the class's work", studentList.status === 403, `status ${studentList.status}`);

  return { teacher, klass, alice, bob, hwId, subId: Number(sql(`select id from homework_submissions where homework_id = ${hwId} and student_id = ${alice.user.id}`)) };
}

async function markingTests(ctx) {
  console.log("\nMarking it, three ways");

  const { teacher, alice, hwId, subId } = ctx;

  const nothing = await api(`/monthly/submissions/${subId}/return`, { method: "POST", token: teacher.token, body: {} });
  check("work cannot be handed back with nothing on it", nothing.status === 400, `status ${nothing.status}`);
  check("and the refusal says why", /comment|marking|file/i.test(nothing.body?.error ?? ""), nothing.body?.error);

  const byStudent = await api(`/monthly/submissions/${subId}/return`, { method: "POST", token: alice.token, body: { feedback: "A+" } });
  check("a student cannot mark their own work", byStudent.status === 403, `status ${byStudent.status}`);

  const markedKey = await upload(teacher.token, "marked.png");
  const returned = await api(`/monthly/submissions/${subId}/return`, { method: "POST", token: teacher.token, body: {
    feedback: "Good, but check question 7.",
    annotatedKey: markedKey,
    annotatedType: "image/png",
    annotation: JSON.stringify({ elements: [{ type: "freedraw", points: [[0, 0], [10, 10]] }] }),
  } });
  check("the teacher can hand it back marked", returned.status === 200, `status ${returned.status} ${JSON.stringify(returned.body)?.slice(0, 140)}`);
  check("with words", returned.body?.submission?.feedback?.includes("question 7"), returned.body?.submission?.feedback);
  check("with a marked-up file", returned.body?.submission?.annotatedKey === markedKey, returned.body?.submission?.annotatedKey);
  check("and with marking drawn in the app", Boolean(returned.body?.submission?.annotation), "no annotation stored");
  check("it is recorded as returned", returned.body?.submission?.status === "returned", `status ${returned.body?.submission?.status}`);

  /*
   * The student's own file is untouched by the marking.
   *
   * This is the reason the marking is kept as data rather than painted onto the image: a
   * disagreement about what was actually handed in can always be settled by the original.
   */
  const original = sql(`select file_key from homework_submissions where id = ${subId}`);
  check("the student's own file is not overwritten", original !== markedKey && original.length > 0, `file_key ${original}`);

  const canOpen = await api(`/storage/file?key=${encodeURIComponent(markedKey)}`, { token: alice.token });
  check("the student can open the marked-up copy", canOpen.status === 200, `status ${canOpen.status}`);
  const stranger = await register("student");
  const cannot = await api(`/storage/file?key=${encodeURIComponent(markedKey)}`, { token: stranger.token });
  check("and nobody else can", cannot.status === 403, `status ${cannot.status}`);

  const counted = await api(`/monthly/classes/${ctx.klass.id}/homework`, { token: teacher.token });
  const row = (counted.body?.homework ?? []).find((h) => h.id === hwId);
  check("the teacher's list shows one marked", row?.marked === 1, `${row?.marked} marked`);

  /*
   * And handing in again after marking clears the marking.
   *
   * Marking that refers to a page nobody can see any more is worse than no marking: the student
   * would read "check question 7" against a different photograph.
   */
  const fresh = await upload(alice.token, "alice-again.png");
  await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: { fileKey: fresh, fileType: "image/png" } });
  const cleared = sql(`select coalesce(feedback,''), coalesce(annotated_key,''), status from homework_submissions where id = ${subId}`).split("|");
  check("replacing the work clears the old marking", cleared[0] === "" && cleared[1] === "", `feedback "${cleared[0]}", file "${cleared[1]}"`);
  check("and it needs marking again", cleared[2] === "submitted", `status "${cleared[2]}"`);
}

async function closingTests() {
  console.log("\nClosing homework, and life after a month ends");

  const { teacher, klass } = await teacherWithClass();
  const alice = await joinAs(klass.id);

  const set = await api(`/monthly/classes/${klass.id}/homework`, { method: "POST", token: teacher.token, body: { title: "Sheet 4" } });
  const hwId = set.body?.homework?.id;

  const closed = await api(`/monthly/homework/${hwId}`, { method: "PATCH", token: teacher.token, body: { status: "closed" } });
  check("the teacher can close homework", closed.status === 200 && closed.body?.homework?.status === "closed", `status ${closed.body?.homework?.status}`);

  const key = await upload(alice.token);
  const late = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: { fileKey: key, fileType: "image/png" } });
  check("closed homework cannot be handed in", late.status === 409, `status ${late.status}`);
  const rows = Number(sql(`select count(*) from homework_submissions where homework_id = ${hwId}`));
  check("and nothing was written", rows === 0, `${rows} rows`);

  await api(`/monthly/homework/${hwId}`, { method: "PATCH", token: teacher.token, body: { status: "open" } });
  const reopened = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: { fileKey: key, fileType: "image/png" } });
  check("reopening lets it in again", reopened.status === 201, `status ${reopened.status}`);

  /*
   * A student whose month has ended keeps the record, read-only.
   *
   * That is when a refund is argued, so it is exactly the wrong moment to take away what was
   * said and what they handed in.
   */
  sql(`update recurring_enrollments set status = 'ended', ended_at = now()
       where recurring_id = ${klass.id} and student_id = ${alice.user.id}`);

  const stillReads = await api(`/monthly/classes/${klass.id}/messages`, { token: alice.token });
  check("they can still read the conversation", stillReads.status === 200, `status ${stillReads.status}`);
  check("but not write to it", stillReads.body?.readOnly === true, `readOnly ${stillReads.body?.readOnly}`);
  const posting = await api(`/monthly/classes/${klass.id}/messages`, { method: "POST", token: alice.token, body: { body: "hello" } });
  check("and posting is refused", posting.status === 403, `status ${posting.status}`);

  const homework = await api(`/monthly/classes/${klass.id}/homework`, { token: alice.token });
  check("they can still see their homework", homework.status === 200, `status ${homework.status}`);
  check("but cannot hand more in", homework.body?.canSubmit === false, `canSubmit ${homework.body?.canSubmit}`);
  const key2 = await upload(alice.token);
  const blocked = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: { fileKey: key2, fileType: "image/png" } });
  check("handing in after the month is refused", blocked.status === 403, `status ${blocked.status}`);
}

async function fileRuleTests() {
  console.log("\nWhose file is it");

  const { teacher, klass } = await teacherWithClass();
  const alice = await joinAs(klass.id);

  // A key that belongs to somebody else cannot be passed off as your own work.
  const otherKey = await upload(teacher.token, "not-mine.png");
  const set = await api(`/monthly/classes/${klass.id}/homework`, { method: "POST", token: teacher.token, body: { title: "Sheet 5" } });
  const hwId = set.body?.homework?.id;

  const stolen = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: {
    fileKey: otherKey, fileType: "image/png" } });
  check("a student cannot hand in somebody else's file", stolen.status === 400, `status ${stolen.status}`);
  check("and is told why", /does not belong/i.test(stolen.body?.error ?? ""), stolen.body?.error);

  const invented = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: {
    fileKey: `evidence/${alice.user.id}/made-up.png`, fileType: "image/png" } });
  check("nor a file that was never uploaded", invented.status === 400, `status ${invented.status}`);

  const empty = await api(`/monthly/homework/${hwId}/submit`, { method: "POST", token: alice.token, body: {} });
  check("nor nothing at all", empty.status === 400, `status ${empty.status}`);
}

async function main() {
  const r2 = await startFakeR2({ port: R2_PORT, bucket: BUCKET, secret: SECRET });
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "portal-test-secret",
      R2_ACCESS_KEY_ID: KEY_ID,
      R2_SECRET_ACCESS_KEY: SECRET,
      R2_BUCKET: BUCKET,
      R2_ENDPOINT: `http://127.0.0.1:${R2_PORT}`,
    },
    stdio: "ignore",
  });
  const stop = async () => { try { server.kill("SIGKILL"); } catch { /* gone */ } await r2.close(); };
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch { /* gone */ } });

  let up = false;
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) { console.error("the API never came up"); await stop(); process.exit(1); }

  try {
    const ctx = await threadTests();
    await pinningTests(ctx);
    const hw = await homeworkTests();
    await markingTests(hw);
    await closingTests();
    await fileRuleTests();
  } catch (err) {
    console.error(err);
    failed += 1;
    failures.push(`the suite stopped early: ${err.message}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  await stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => { console.error(err); process.exit(1); });
