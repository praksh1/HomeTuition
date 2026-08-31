/**
 * The class chat, working like the Messages tab.
 *
 * The owner's requirement: *"The Sikshya's chat features everywhere in the app must have similar
 * features — the chat within the Monthly Sessions/Regular Session should also have the same
 * features as in the Messages Tab."* A student photographing their working and sending it to
 * their teacher is the most useful thing a chat can do in a tuition app, and it worked in one of
 * the two places chat exists.
 *
 * There are two class conversations to cover, not one: a single class hangs off `sessionId` and
 * a monthly course off `recurringId`, served by different routes with different rules about who
 * may read. Both are checked here, because "similar features" that only reached one of them is
 * exactly the half-finished state this suite exists to catch.
 *
 * And, as with private messages, the check that matters most signs in as **somebody else** —
 * the person who did not upload the file. A sender can always open their own upload, so a suite
 * that only ever checks the sender proves nothing about whether a class can see it.
 *
 * Usage: node scripts/class-chat/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeR2 } from "../upload-tests/fake-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

const R2_PORT = Number(process.env.FAKE_R2_PORT ?? 9441);
const API_PORT = Number(process.env.CLASS_CHAT_PORT ?? 8098);
const API = `http://127.0.0.1:${API_PORT}`;
const BUCKET = "hometuition-test";
const KEY_ID = "test-access-key";
const SECRET = "test-secret-key-not-a-real-one";
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0;
const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};
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
  const email = `cc_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Ask for a link and put bytes on the end of it, the way the phone does. */
async function upload(token, bytes = PNG, contentType = "image/png", claimedSize = bytes.length) {
  const signed = await api("/storage/uploads/request-url", { method: "POST", token, body: {
    name: "working.png", size: claimedSize, contentType } });
  if (signed.status !== 200) throw new Error(`no upload link: ${signed.status} ${JSON.stringify(signed.body)}`);
  const put = await fetch(signed.body.uploadURL, {
    method: "PUT", headers: { "Content-Type": contentType }, body: bytes,
  });
  if (put.status !== 200) throw new Error(`upload refused: ${put.status}`);
  return signed.body.objectPath;
}

const openFile = (key, token) => api(`/storage/file?key=${encodeURIComponent(key)}`, { token });

async function main() {
  const r2 = await startFakeR2({ port: R2_PORT, bucket: BUCKET, secret: SECRET });
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "class-chat-test-secret",
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
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) { up = true; break; } } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) { await stop(); throw new Error("the server never came up"); }

  try {
    const teacher = await register("teacher", "Teacher Thapa");
    sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
    const student = await register("student", "Sita Student");
    const stranger = await register("student", "Nosy Nabin");

    console.log("\nA single class\n");

    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const made = await api("/sessions", { method: "POST", token: teacher.token, body: {
      subject: "Maths", topic: "Algebra", date: soon, duration: 60, maxStudents: 20, price: 500 } });
    const sessionId = made.body.id;
    const booked = await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: {
      paymentMethod: "esewa" } });
    check("a student is in the class", booked.status === 201, `status=${booked.status}`);

    const empty = await api(`/sessions/${sessionId}/messages`, { method: "POST", token: student.token, body: {
      body: "   " } });
    check("an empty message is refused", empty.status === 400, `status=${empty.status}`);
    check("and the refusal offers both ways of saying something",
      /write something/i.test(String(empty.body?.error)) && /attach/i.test(String(empty.body?.error)),
      String(empty.body?.error));

    const key = await upload(student.token);
    const sent = await api(`/sessions/${sessionId}/messages`, { method: "POST", token: student.token, body: {
      fileKey: key, fileType: "image/png", fileName: "my working.png" } });
    check("a photo with no caption is a message", sent.status === 201, `status=${sent.status} ${JSON.stringify(sent.body).slice(0, 160)}`);
    check("with nothing to complain about", sent.body?.attachmentProblem === null, JSON.stringify(sent.body?.attachmentProblem));
    check("and the file comes back on it", sent.body?.attachments?.[0]?.fileKey === key, JSON.stringify(sent.body?.attachments));
    check("typed by what landed, not by what was claimed",
      sent.body?.attachments?.[0]?.fileType === "image/png", JSON.stringify(sent.body?.attachments?.[0]));

    const messageId = sent.body?.id;
    const thread = await api(`/sessions/${sessionId}/messages`, { token: teacher.token });
    const seen = (thread.body?.messages ?? []).find((m) => m.id === messageId);
    check("the teacher sees it in the thread", !!seen, JSON.stringify(thread.body).slice(0, 200));
    check("with the file on it", seen?.attachments?.[0]?.fileKey === key, JSON.stringify(seen?.attachments));

    /*
     * The check this suite exists for. The sender is the uploader and can always open their
     * own file; the teacher is not, and before `lib/classMessageAccess.ts` this was a 403.
     */
    const teacherOpens = await openFile(key, teacher.token);
    check("and the teacher can actually open it", teacherOpens.status === 200,
      `status=${teacherOpens.status} ${JSON.stringify(teacherOpens.body).slice(0, 120)}`);
    const fetched = teacherOpens.body?.url ? await fetch(String(teacherOpens.body.url)) : null;
    check("the link opens the photo that was sent",
      !!fetched && fetched.status === 200 && Buffer.from(await fetched.arrayBuffer()).equals(PNG),
      `status=${fetched?.status}`);

    const nosy = await openFile(key, stranger.token);
    check("somebody not in the class cannot", nosy.status === 403, `status=${nosy.status}`);

    console.log("\nReacting in a class\n");

    const react = await api(`/sessions/${sessionId}/messages/${messageId}/reaction`, {
      method: "POST", token: teacher.token, body: { emoji: "👍" } });
    check("the teacher can react", react.status === 200 && react.body?.emoji === "👍", JSON.stringify(react.body));

    const withReaction = await api(`/sessions/${sessionId}/messages`, { token: student.token });
    const bubble = (withReaction.body?.messages ?? []).find((m) => m.id === messageId);
    check("the student sees it counted", bubble?.reactions?.[0]?.count === 1, JSON.stringify(bubble?.reactions));
    check("but not as their own", bubble?.reactions?.[0]?.mine === false, JSON.stringify(bubble?.reactions));

    const undo = await api(`/sessions/${sessionId}/messages/${messageId}/reaction`, {
      method: "POST", token: teacher.token, body: { emoji: "👍" } });
    check("tapping the same one again takes it back", undo.body?.emoji === null, JSON.stringify(undo.body));

    const outsider = await api(`/sessions/${sessionId}/messages/${messageId}/reaction`, {
      method: "POST", token: stranger.token, body: { emoji: "😂" } });
    check("somebody not in the class cannot react", outsider.status === 403, `status=${outsider.status}`);

    const essay = await api(`/sessions/${sessionId}/messages/${messageId}/reaction`, {
      method: "POST", token: teacher.token, body: { emoji: "this is a paragraph, not an emoji" } });
    check("a reaction is not a second message", essay.status === 400, `status=${essay.status}`);

    console.log("\nA monthly course\n");

    await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
    const klass = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
      subject: "Maths", topic: "Daily algebra", startMinute: 17 * 60, durationMinutes: 60,
      timeZone: "Asia/Kathmandu", monthlyPrice: 2000, maxStudents: 20 } });
    const classId = klass.body?.id ?? klass.body?.class?.id;
    const joined = await api(`/monthly/classes/${classId}/join`, { method: "POST", token: student.token, body: {
      paymentMethod: "esewa" } });
    check("a student holds a place in the course", joined.status === 201, `status=${joined.status}`);

    const courseKey = await upload(student.token);
    const posted = await api(`/monthly/classes/${classId}/messages`, { method: "POST", token: student.token, body: {
      body: "Sir, is this right?", fileKey: courseKey, fileType: "image/png", fileName: "q4.png" } });
    check("a file can be sent in the course conversation too", posted.status === 201,
      `status=${posted.status} ${JSON.stringify(posted.body).slice(0, 160)}`);
    check("and comes back on the message", posted.body?.attachments?.[0]?.fileKey === courseKey,
      JSON.stringify(posted.body?.attachments));

    const courseThread = await api(`/monthly/classes/${classId}/messages`, { token: teacher.token });
    const courseBubble = (courseThread.body?.messages ?? []).find((m) => m.id === posted.body?.id);
    check("the teacher sees it in the course thread", !!courseBubble, JSON.stringify(courseThread.body).slice(0, 200));
    check("with the file on it", courseBubble?.attachments?.[0]?.fileKey === courseKey,
      JSON.stringify(courseBubble?.attachments));
    const courseOpen = await openFile(courseKey, teacher.token);
    check("and can open it", courseOpen.status === 200, `status=${courseOpen.status}`);
    const courseNosy = await openFile(courseKey, stranger.token);
    check("somebody not in the course cannot", courseNosy.status === 403, `status=${courseNosy.status}`);

    const courseReact = await api(`/monthly/classes/${classId}/messages/${posted.body?.id}/reaction`, {
      method: "POST", token: teacher.token, body: { emoji: "🎉" } });
    check("reacting works in the course conversation", courseReact.body?.emoji === "🎉", JSON.stringify(courseReact.body));

    /*
     * A pinned message is the same row read a second way. A pinned photo of the timetable is
     * exactly the thing that must keep its file, and it is served by a different query.
     */
    await api(`/monthly/messages/${posted.body?.id}/pin`, { method: "PATCH", token: teacher.token, body: { pinned: true } });
    const pinnedThread = await api(`/monthly/classes/${classId}/messages`, { token: student.token });
    const pin = (pinnedThread.body?.pinned ?? [])[0];
    check("a pinned message keeps its file", pin?.attachments?.[0]?.fileKey === courseKey,
      JSON.stringify(pinnedThread.body?.pinned).slice(0, 200));

    console.log("\nWhen the file does not make it\n");

    const theirs = await upload(stranger.token);
    const stolen = await api(`/sessions/${sessionId}/messages`, { method: "POST", token: student.token, body: {
      body: "Here it is.", fileKey: theirs } });
    check("somebody else's file cannot be sent as yours", stolen.status === 201, `status=${stolen.status}`);
    check("the words go anyway", stolen.body?.body === "Here it is.", JSON.stringify(stolen.body?.body));
    check("without the file", (stolen.body?.attachments ?? []).length === 0, JSON.stringify(stolen.body?.attachments));
    check("and the sender is told why",
      /does not belong to you/i.test(String(stolen.body?.attachmentProblem)), String(stolen.body?.attachmentProblem));
    const orphans = sql(`select count(*) from session_message_attachments where file_key = '${theirs}'`);
    check("a refused file leaves no attachment row behind", orphans === "0", `rows=${orphans}`);

    const bigKey = await upload(student.token, Buffer.alloc(11 * 1024 * 1024, 1), "image/png", 1000);
    const big = await api(`/sessions/${sessionId}/messages`, { method: "POST", token: student.token, body: {
      body: "Big one.", fileKey: bigKey } });
    check("an oversized file is refused after it lands",
      (big.body?.attachments ?? []).length === 0, JSON.stringify(big.body?.attachments));
    check("with the size given as the reason",
      /larger than 10 MB/i.test(String(big.body?.attachmentProblem)), String(big.body?.attachmentProblem));
    check("and it is deleted rather than left costing money", !r2.objects.has(bigKey));

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed) failures.forEach((f) => console.log(`  - ${f}`));
  } finally {
    await stop();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
