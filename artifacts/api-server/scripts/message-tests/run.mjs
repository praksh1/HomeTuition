/**
 * Messages as a conversation: files, reactions, and one list.
 *
 * The owner's ask, in their words: *"I didn't mean completely like it, but a conversation
 * style set up where users can send attachments as well."* Three things have to be true for
 * that, and only the first is obvious:
 *
 * 1. A file can be sent in a message at all.
 * 2. **The person it was sent to can open it.** This is the one that would have shipped
 *    broken: `GET /storage/file` let in the uploader, an agent, a dispute's reporter and the
 *    people a homework belongs to — and a recipient is none of those. The sender's own screen
 *    works perfectly either way, because the sender *is* the uploader, which is exactly how a
 *    fault like this survives being tried out by whoever built it. So the check below signs in
 *    as the recipient.
 * 3. A file that fails does not take the words with it.
 *
 * Reactions are checked for the thing that makes them a reaction rather than a pile: one per
 * person, replaced by a different one, removed by the same one again.
 *
 * The bucket is a stand-in that verifies AWS SigV4 from the spec
 * (scripts/upload-tests/fake-r2.mjs), so an upload that passes here passed a real signature
 * check written independently of the SDK that produced the signature.
 *
 * Usage: node scripts/message-tests/run.mjs
 *   Starts its own API server with R2 pointed at the stand-in.
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeR2 } from "../upload-tests/fake-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

const R2_PORT = Number(process.env.FAKE_R2_PORT ?? 9411);
const API_PORT = Number(process.env.MESSAGE_API_PORT ?? 8093);
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
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role, name) {
  seq += 1;
  const email = `msg_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

/** A real PNG — one pixel, and a valid file rather than bytes that merely claim to be one. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Do what the phone does: ask for a link, then put the bytes on the end of it.
 *
 * `claimedSize` exists so a test can lie the way a client can. The size sent when asking for
 * the link is only ever a claim — the server refuses an obviously huge one early as a courtesy
 * to somebody on a slow connection, but the real check has to happen once the bytes have
 * landed. Passing a small claim with large bytes is how that second check gets exercised.
 */
async function upload(token, bytes = PNG, contentType = "image/png", claimedSize = bytes.length) {
  const signed = await api("/storage/uploads/request-url", { method: "POST", token, body: {
    name: "homework.png", size: claimedSize, contentType } });
  if (signed.status !== 200) throw new Error(`no upload link: ${signed.status} ${JSON.stringify(signed.body)}`);
  const put = await fetch(signed.body.uploadURL, {
    method: "PUT", headers: { "Content-Type": contentType }, body: bytes,
  });
  if (put.status !== 200) throw new Error(`upload refused: ${put.status}`);
  return signed.body.objectPath;
}

async function main() {
  const r2 = await startFakeR2({ port: R2_PORT, bucket: BUCKET, secret: SECRET });

  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "message-test-secret",
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
    const student = await register("student", "Sending Sita");
    const teacher = await register("teacher", "Receiving Ram");
    const stranger = await register("student", "Nosy Nabin");

    console.log("\nWhat counts as a message\n");

    const empty = await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: { body: "   " } });
    check("nothing at all is refused", empty.status === 400, `status=${empty.status}`);
    check("and the refusal offers both ways of saying something",
      /write something/i.test(String(empty.body?.error)) && /attach/i.test(String(empty.body?.error)),
      String(empty.body?.error));

    const words = await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: {
      body: "Sir, I could not finish question four." } });
    check("words alone still send", words.status === 201, `status=${words.status} ${JSON.stringify(words.body)}`);

    console.log("\nSending a photo\n");

    const key = await upload(student.token);
    const sent = await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: {
      fileKey: key, fileType: "image/png", fileName: "question four.png" } });
    check("a photo with no caption is a message", sent.status === 201, `status=${sent.status} ${JSON.stringify(sent.body)}`);
    check("with nothing to complain about", sent.body?.attachmentProblem === null, JSON.stringify(sent.body?.attachmentProblem));
    check("and the file travels back with it", sent.body?.attachments?.[0]?.fileKey === key,
      JSON.stringify(sent.body?.attachments));
    /*
     * The type comes from the bucket, not from the phone. What the app said when it asked for
     * the link was a claim, and a claim is what a renamed executable would have made.
     */
    check("typed by what actually landed, not by what was claimed",
      sent.body?.attachments?.[0]?.fileType === "image/png", JSON.stringify(sent.body?.attachments?.[0]));
    check("the name it had on the phone is kept",
      sent.body?.attachments?.[0]?.fileName === "question four.png", JSON.stringify(sent.body?.attachments?.[0]));

    const messageId = sent.body?.id;
    check("it is a real message row", Number.isInteger(messageId), String(messageId));

    console.log("\nReading it at the other end\n");

    const thread = await api(`/messages/${student.user.id}`, { token: teacher.token });
    const bubble = (thread.body ?? []).find((m) => m.id === messageId);
    check("the teacher sees the message", !!bubble, JSON.stringify(thread.body).slice(0, 200));
    check("with the file on it", bubble?.attachments?.[0]?.fileKey === key, JSON.stringify(bubble?.attachments));

    /*
     * The whole reason this suite exists. Before lib/messageAccess.ts this was a 403: the
     * route let in the uploader, an agent, a dispute's reporter and the people a homework
     * belongs to, and a person you send a photo to is none of them.
     */
    const opened = await api(`/storage/file?key=${encodeURIComponent(key)}`, { token: teacher.token });
    check("and can open it", opened.status === 200, `status=${opened.status} ${JSON.stringify(opened.body)}`);
    check("by way of a link that dies", /X-Amz-Expires=\d+/.test(String(opened.body?.url)),
      String(opened.body?.url).slice(0, 120));
    /*
     * Guarded, because a refusal above leaves no link — and a suite that throws here stops
     * reporting, so one red check hides every check after it.
     */
    let sameBytes = false, fetchStatus = "no link came back";
    if (opened.body?.url) {
      const fetched = await fetch(String(opened.body.url));
      fetchStatus = String(fetched.status);
      sameBytes = fetched.status === 200 && Buffer.from(await fetched.arrayBuffer()).equals(PNG);
    }
    check("the link really opens the photo that was sent", sameBytes, `status=${fetchStatus}`);

    const senderOpens = await api(`/storage/file?key=${encodeURIComponent(key)}`, { token: student.token });
    check("the sender can still open their own", senderOpens.status === 200, `status=${senderOpens.status}`);

    const nosy = await api(`/storage/file?key=${encodeURIComponent(key)}`, { token: stranger.token });
    check("somebody not in the conversation cannot", nosy.status === 403, `status=${nosy.status}`);

    console.log("\nWhen the file does not make it\n");

    {
      const theirs = await upload(stranger.token);
      const stolen = await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: {
        body: "Here is my work.", fileKey: theirs } });
      check("somebody else's file cannot be sent as yours", stolen.status === 201, `status=${stolen.status}`);
      check("the words go anyway", stolen.body?.body === "Here is my work.", JSON.stringify(stolen.body?.body));
      check("without the file", (stolen.body?.attachments ?? []).length === 0, JSON.stringify(stolen.body?.attachments));
      check("and the sender is told why",
        /does not belong to you/i.test(String(stolen.body?.attachmentProblem)), String(stolen.body?.attachmentProblem));
      const orphans = sql(`select count(*) from message_attachments where file_key = '${theirs}'`);
      check("a refused file leaves no attachment row behind", orphans === "0", `rows=${orphans}`);

      const invented = await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: {
        body: "And this one.", fileKey: `evidence/${student.user.id}/00000000-0000-0000-0000-000000000000.png` } });
      check("a key for a file that never arrived is refused",
        (invented.body?.attachments ?? []).length === 0, JSON.stringify(invented.body?.attachments));
      check("and that message still sends", invented.status === 201, `status=${invented.status}`);
      check("with the reason given",
        /did not finish uploading/i.test(String(invented.body?.attachmentProblem)), String(invented.body?.attachmentProblem));

      /*
       * The size claim is only a claim, so this asks for a link for a small file and then puts
       * eleven megabytes on the end of it. Only reading the real object catches that.
       */
      const bigKey = await upload(student.token, Buffer.alloc(11 * 1024 * 1024, 1), "image/png", 1000);
      check("the oversized file did land, because the claim was a lie", r2.objects.has(bigKey));
      const big = await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: {
        body: "Big one.", fileKey: bigKey } });
      check("it is refused as an attachment",
        (big.body?.attachments ?? []).length === 0, JSON.stringify(big.body?.attachments));
      check("with the size given as the reason",
        /larger than 10 MB/i.test(String(big.body?.attachmentProblem)), String(big.body?.attachmentProblem));
      check("and it is deleted rather than left costing money", !r2.objects.has(bigKey));
    }

    console.log("\nReacting\n");

    {
      const first = await api(`/messages/${messageId}/reaction`, { method: "POST", token: teacher.token, body: { emoji: "👍" } });
      check("the teacher can react", first.status === 200 && first.body?.emoji === "👍", JSON.stringify(first.body));

      const seen = await api(`/messages/${student.user.id}`, { token: teacher.token });
      const withReaction = (seen.body ?? []).find((m) => m.id === messageId);
      check("it is counted on the bubble",
        withReaction?.reactions?.[0]?.emoji === "👍" && withReaction?.reactions?.[0]?.count === 1,
        JSON.stringify(withReaction?.reactions));
      check("and marked as theirs", withReaction?.reactions?.[0]?.mine === true, JSON.stringify(withReaction?.reactions));

      const asSender = await api(`/messages/${teacher.user.id}`, { token: student.token });
      const sendersView = (asSender.body ?? []).find((m) => m.id === messageId);
      check("the sender sees the same count", sendersView?.reactions?.[0]?.count === 1, JSON.stringify(sendersView?.reactions));
      check("but not as their own", sendersView?.reactions?.[0]?.mine === false, JSON.stringify(sendersView?.reactions));

      /* Both of them on the same emoji is two, not two rows belonging to one person. */
      await api(`/messages/${messageId}/reaction`, { method: "POST", token: student.token, body: { emoji: "👍" } });
      const both = await api(`/messages/${teacher.user.id}`, { token: student.token });
      const twoUp = (both.body ?? []).find((m) => m.id === messageId);
      check("two people reacting the same way counts two",
        twoUp?.reactions?.find((r) => r.emoji === "👍")?.count === 2, JSON.stringify(twoUp?.reactions));

      /*
       * A different emoji replaces, it does not stack. Otherwise one person can leave six
       * reactions on one message, which is noise rather than a feature.
       */
      await api(`/messages/${messageId}/reaction`, { method: "POST", token: student.token, body: { emoji: "🎉" } });
      /*
       * Both halves of "replaces", because either alone is satisfied by something else.
       *
       * Counting rows proves only that nothing stacked — and the unique index guarantees that
       * on its own, so a route that stopped replacing entirely would still leave one row and
       * still pass. Reading the emoji back is what proves it is the *new* one.
       */
      const mine = sql(`select emoji from message_reactions where message_id = ${messageId} and user_id = ${student.user.id}`);
      const rows = sql(`select count(*) from message_reactions where message_id = ${messageId} and user_id = ${student.user.id}`);
      check("changing your mind replaces your reaction", mine === "🎉" && rows === "1", `emoji=${mine} rows=${rows}`);
      const swapped = await api(`/messages/${teacher.user.id}`, { token: student.token });
      const after = (swapped.body ?? []).find((m) => m.id === messageId);
      check("so the old one is no longer counted for them",
        after?.reactions?.find((r) => r.emoji === "👍")?.count === 1, JSON.stringify(after?.reactions));
      check("and the new one is", after?.reactions?.find((r) => r.emoji === "🎉")?.count === 1, JSON.stringify(after?.reactions));

      /* The same one again takes it back, which is what a second tap means everywhere else. */
      const undo = await api(`/messages/${messageId}/reaction`, { method: "POST", token: student.token, body: { emoji: "🎉" } });
      check("tapping the same one again removes it", undo.body?.emoji === null, JSON.stringify(undo.body));
      const gone = sql(`select count(*) from message_reactions where message_id = ${messageId} and user_id = ${student.user.id}`);
      check("and the row goes with it", gone === "0", `rows=${gone}`);

      const outsider = await api(`/messages/${messageId}/reaction`, { method: "POST", token: stranger.token, body: { emoji: "😂" } });
      check("somebody not in the conversation cannot react", outsider.status === 404, `status=${outsider.status}`);
      const outsiderRows = sql(`select count(*) from message_reactions where message_id = ${messageId} and user_id = ${stranger.user.id}`);
      check("and leaves nothing behind when they try", outsiderRows === "0", `rows=${outsiderRows}`);

      const essay = await api(`/messages/${messageId}/reaction`, { method: "POST", token: teacher.token, body: {
        emoji: "this is not an emoji, it is a paragraph" } });
      check("a reaction is not a second message", essay.status === 400, `status=${essay.status}`);

      const blank = await api(`/messages/${messageId}/reaction`, { method: "POST", token: teacher.token, body: { emoji: "  " } });
      check("nor is it nothing", blank.status === 400, `status=${blank.status}`);

      const nowhere = await api(`/messages/99999999/reaction`, { method: "POST", token: teacher.token, body: { emoji: "👍" } });
      check("reacting to a message that does not exist is refused", nowhere.status === 404, `status=${nowhere.status}`);
    }

    console.log("\nOne list, not three folders\n");

    {
      /*
       * The owner's ask was to stop splitting a conversation by who spoke last. A thread the
       * teacher answered used to move from Inbox to Sent; what is checked here is that the
       * server gives back one row per person either way, newest first.
       */
      await api(`/messages/${student.user.id}`, { method: "POST", token: teacher.token, body: {
        body: "Bring it tomorrow and we will go through it." } });

      const list = await api("/conversations", { token: student.token });
      const withTeacher = (list.body ?? []).filter((c) => c.otherUserId === teacher.user.id);
      check("a conversation appears once, however it was answered", withTeacher.length === 1,
        `rows=${withTeacher.length}`);
      check("showing the latest thing said in it",
        withTeacher[0]?.lastMessage === "Bring it tomorrow and we will go through it.",
        JSON.stringify(withTeacher[0]?.lastMessage));
      check("and who said it", withTeacher[0]?.lastMessageFromMe === false, JSON.stringify(withTeacher[0]?.lastMessageFromMe));
      check("unread, because the student has not opened it", withTeacher[0]?.unreadCount >= 1,
        String(withTeacher[0]?.unreadCount));

      const teachersList = await api("/conversations", { token: teacher.token });
      const theirRow = (teachersList.body ?? []).find((c) => c.otherUserId === student.user.id);
      check("the teacher's own last word shows on their side too", theirRow?.lastMessageFromMe === true,
        JSON.stringify(theirRow?.lastMessageFromMe));

      const chatter = await register("teacher", "Chatty Chandra");
      await api(`/messages/${student.user.id}`, { method: "POST", token: chatter.token, body: { body: "Newest." } });
      const ordered = await api("/conversations", { token: student.token });
      check("the newest conversation is at the top",
        ordered.body?.[0]?.otherUserId === chatter.user.id, JSON.stringify(ordered.body?.[0]));

      const badge = await api("/messages/unread-count", { token: student.token });
      check("the badge counts what has not been read", (badge.body?.unread ?? 0) >= 2, JSON.stringify(badge.body));

      await api(`/messages/${teacher.user.id}`, { token: student.token });
      const afterReading = await api("/conversations", { token: student.token });
      const read = (afterReading.body ?? []).find((c) => c.otherUserId === teacher.user.id);
      check("opening a conversation clears its unread count", read?.unreadCount === 0, String(read?.unreadCount));
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed) failures.forEach((f) => console.log(`  - ${f}`));
  } finally {
    await stop();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
