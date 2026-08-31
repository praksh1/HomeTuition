/**
 * Attaching a file, end to end, against a stand-in that checks the signature itself.
 *
 * This is the feature that has **never worked**: the app was born on Replit and its storage
 * code asked a credential sidecar on 127.0.0.1:1106 for a token, which does not exist on
 * Railway. Every attachment failed before a byte left the phone, and nothing said so.
 *
 * The stand-in (fake-r2.mjs) verifies AWS SigV4 with an implementation written from the spec,
 * not from the SDK that produced the signature — so a pass means two independent
 * implementations agree on the signature over the same canonical request.
 *
 * Usage: node scripts/upload-tests/run.mjs
 *   Starts its own API server with R2 pointed at the stand-in.
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeR2 } from "./fake-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

const R2_PORT = Number(process.env.FAKE_R2_PORT ?? 9401);
const API_PORT = Number(process.env.UPLOAD_API_PORT ?? 8092);
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

async function api(p, { method = "GET", token, body, redirect = "follow" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, {
    method, headers, redirect,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed, headers: res.headers };
}

let seq = 0;
async function register(role, name) {
  seq += 1;
  const email = `up_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

/** A real PNG, small enough to be an obvious test file and valid enough to be a real one. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const r2 = await startFakeR2({ port: R2_PORT, bucket: BUCKET, secret: SECRET });

  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "upload-test-secret",
      R2_ACCESS_KEY_ID: KEY_ID,
      R2_SECRET_ACCESS_KEY: SECRET,
      R2_BUCKET: BUCKET,
      R2_ENDPOINT: `http://127.0.0.1:${R2_PORT}`,
    },
    stdio: "ignore",
  });
  const stop = async () => { try { server.kill("SIGKILL"); } catch { /* gone */ } await r2.close(); };
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch { /* gone */ } });

  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  try {
    console.log("\nAsking for somewhere to put a file\n");

    const student = await register("student", "Uploading Usha");
    const other = await register("student", "Nosy Nabin");

    const anon = await api("/storage/uploads/request-url", { method: "POST", body: {
      name: "x.png", size: 100, contentType: "image/png" } });
    check("signed out, there is no upload link", anon.status === 401, `status=${anon.status}`);

    const wrongType = await api("/storage/uploads/request-url", { method: "POST", token: student.token,
      body: { name: "run.exe", size: 100, contentType: "application/x-msdownload" } });
    check("an executable is refused outright", wrongType.status === 400, `status=${wrongType.status}`);
    check("and the refusal names what is allowed",
      /photos and PDFs/i.test(String(wrongType.body?.error)), String(wrongType.body?.error));

    const tooBig = await api("/storage/uploads/request-url", { method: "POST", token: student.token,
      body: { name: "huge.png", size: 40 * 1024 * 1024, contentType: "image/png" } });
    check("something far too big is refused before it is uploaded", tooBig.status === 400, `status=${tooBig.status}`);

    const signed = await api("/storage/uploads/request-url", { method: "POST", token: student.token,
      body: { name: "my exam paper.png", size: PNG.length, contentType: "image/png" } });
    check("a photo gets a link", signed.status === 200, `status=${signed.status} ${JSON.stringify(signed.body)}`);

    const uploadURL = signed.body?.uploadURL ?? "";
    const key = signed.body?.objectPath ?? "";
    check("the link points at the bucket", uploadURL.includes(`/${BUCKET}/`), uploadURL.slice(0, 120));
    check("and is signed", /X-Amz-Signature=/.test(uploadURL));
    check("with an expiry rather than forever", /X-Amz-Expires=\d+/.test(uploadURL), uploadURL.slice(0, 200));

    /**
     * The original filename must not survive into the key. People attach things called
     * `passport-scan.jpg`, and a name that travels into a URL is a name that leaks.
     */
    check("the key does not carry the file's name", !/exam|paper/i.test(key), key);
    check("the key says who it belongs to", key.startsWith(`evidence/${student.user.id}/`), key);

    console.log("\nUploading it, to a server that checks the signature itself\n");

    const put = await fetch(uploadURL, {
      method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG,
    });
    check("the stand-in accepts our signature", put.status === 200,
      `status=${put.status} ${(await put.text().catch(() => "")).slice(0, 400)}`);
    check("nothing was rejected as badly signed", r2.rejected.length === 0,
      JSON.stringify(r2.rejected.slice(0, 1)));
    check("and the bytes arrived intact",
      r2.objects.get(key)?.body.equals(PNG) === true, `stored=${r2.objects.get(key)?.body.length}`);
    check("with the type we signed for",
      r2.objects.get(key)?.contentType === "image/png", r2.objects.get(key)?.contentType);

    /**
     * The signature covers the content type, so a link issued for a PNG cannot be reused to
     * put something else in the bucket.
     */
    const wrongContentType = await fetch(uploadURL, {
      method: "PUT", headers: { "Content-Type": "application/x-msdownload" }, body: PNG,
    });
    check("the same link cannot be used for a different type", wrongContentType.status === 403,
      `status=${wrongContentType.status}`);

    const tampered = uploadURL.replace(/(evidence%2F|evidence\/)\d+/, "$1999999");
    const tamperedPut = await fetch(tampered, { method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG });
    check("and a link edited to point somewhere else is refused", tamperedPut.status === 403,
      `status=${tamperedPut.status}`);

    console.log("\nAttaching it to a report\n");

    const filed = await api("/disputes", { method: "POST", token: student.token, body: {
      reason: "Technical Failure", description: "The board never loaded for me.", evidenceUrl: key } });
    check("the report is filed", filed.status === 201, `status=${filed.status} ${JSON.stringify(filed.body)}`);
    check("with the attachment kept", filed.body?.evidenceUrl === key, JSON.stringify(filed.body?.evidenceUrl));
    check("and nothing to complain about", filed.body?.attachmentProblem === null,
      JSON.stringify(filed.body?.attachmentProblem));

    /**
     * Somebody else's key must not become their evidence. The owner is read out of the key
     * itself, so this cannot be fixed up by editing a request.
     */
    const stolen = await api("/disputes", { method: "POST", token: other.token, body: {
      reason: "Technical Failure", description: "Not mine.", evidenceUrl: key } });
    check("another person cannot attach that file to their own report", stolen.status === 201);
    check("their report is filed anyway, without it", stolen.body?.evidenceUrl === null,
      JSON.stringify(stolen.body?.evidenceUrl));
    check("and they are told why", /does not belong to you/i.test(String(stolen.body?.attachmentProblem)),
      String(stolen.body?.attachmentProblem));

    const invented = await api("/disputes", { method: "POST", token: student.token, body: {
      reason: "Technical Failure", description: "Made up key.",
      evidenceUrl: `evidence/${student.user.id}/00000000-0000-0000-0000-000000000000.png` } });
    check("a key for a file that was never uploaded is refused",
      invented.body?.evidenceUrl === null, JSON.stringify(invented.body?.evidenceUrl));
    check("and the report still goes through", invented.status === 201);

    console.log("\nA file that is too big is caught after it lands, and deleted\n");

    {
      /**
       * Its own reporter, because a person may only file three requests a day.
       *
       * That limit is real and deliberate — see lib/tickets.ts — and this suite is about what
       * happens to an attachment, not about the limit. Sharing one account across every block
       * here would mean a later block failing for a reason that has nothing to do with files,
       * which is exactly how a suite starts lying about what it covers.
       */
      const bigReporter = await register("student", "Oversized Om");
      const big = await api("/storage/uploads/request-url", { method: "POST", token: bigReporter.token,
        body: { name: "big.png", size: 1000, contentType: "image/png" } });
      const bigKey = big.body?.objectPath;
      // Eleven megabytes: the claim said 1000 bytes, so only reading the real object catches it.
      await fetch(big.body.uploadURL, {
        method: "PUT", headers: { "Content-Type": "image/png" }, body: Buffer.alloc(11 * 1024 * 1024, 1),
      });
      check("the oversized file did upload, because the claim was a lie", r2.objects.has(bigKey));

      const filedBig = await api("/disputes", { method: "POST", token: bigReporter.token, body: {
        reason: "Technical Failure", description: "Too big.", evidenceUrl: bigKey } });
      check("it is refused as evidence", filedBig.body?.evidenceUrl === null);
      check("with the size given as the reason",
        /larger than 10 MB/i.test(String(filedBig.body?.attachmentProblem)),
        String(filedBig.body?.attachmentProblem));
      check("and it is deleted rather than left costing money", !r2.objects.has(bigKey));
    }

    console.log("\nUploading through the server, the way a blocked browser has to\n");

    {
      /**
       * The live-site failure this exists for: a browser will not PUT to R2 unless the bucket
       * names its origin in a CORS rule, and Safari reports the refusal as "Load failed" and
       * nothing more. This path goes through our own API, which no browser rule can block.
       */
      const slowReporter = await register("student", "Slow-path Sarita");
      const viaServer = await fetch(`${API}/api/storage/upload`, {
        method: "PUT",
        headers: { "Content-Type": "image/png", Authorization: `Bearer ${slowReporter.token}` },
        body: PNG,
      });
      const body = await viaServer.json().catch(() => ({}));
      check("a file sent through the server is stored", viaServer.status === 201,
        `status=${viaServer.status} ${JSON.stringify(body)}`);
      const serverKey = body?.objectPath ?? "";
      check("under a key that belongs to the uploader",
        serverKey.startsWith(`evidence/${slowReporter.user.id}/`), serverKey);
      check("and the bytes really are in the bucket",
        r2.objects.get(serverKey)?.body.equals(PNG) === true);

      const filedViaServer = await api("/disputes", { method: "POST", token: slowReporter.token, body: {
        reason: "Technical Failure", description: "Uploaded the slow way.", evidenceUrl: serverKey } });
      check("and it can be attached to a report like any other",
        filedViaServer.body?.evidenceUrl === serverKey, JSON.stringify(filedViaServer.body?.evidenceUrl));

      const wrongType = await fetch(`${API}/api/storage/upload`, {
        method: "PUT",
        headers: { "Content-Type": "application/x-msdownload", Authorization: `Bearer ${slowReporter.token}` },
        body: PNG,
      });
      check("the same rules apply — an executable is refused", wrongType.status === 400,
        `status=${wrongType.status}`);

      const anonPut = await fetch(`${API}/api/storage/upload`, {
        method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG,
      });
      check("and it is not an open door", anonPut.status === 401, `status=${anonPut.status}`);

      const huge = await fetch(`${API}/api/storage/upload`, {
        method: "PUT",
        headers: { "Content-Type": "image/png", Authorization: `Bearer ${student.token}` },
        body: Buffer.alloc(11 * 1024 * 1024, 1),
      });
      check("something over the cap does not get through", huge.status >= 400, `status=${huge.status}`);
    }

    console.log("\nWho may look at it afterwards\n");

    {
      const mine = await api(`/storage/file?key=${encodeURIComponent(key)}`, { token: student.token });
      check("the person who uploaded it can", mine.status === 200, `status=${mine.status}`);
      const target = mine.body?.url ?? "";
      /**
       * A link in the body, not a 302.
       *
       * A redirect is unreadable to a browser: `fetch` with `redirect: "manual"` returns an
       * opaque response with no Location. Node exposes it, so a 302 passed here and would have
       * failed on the web — a test green in the wrong environment.
       */
      check("and is given a signed link it can actually read", /X-Amz-Signature=/.test(target), target.slice(0, 120));
      check("that dies within the hour", /X-Amz-Expires=([1-9]\d{0,3})(&|$)/.test(target),
        (target.match(/X-Amz-Expires=\d+/) ?? [""])[0]);

      const view = await fetch(target);
      check("the link actually opens the file", view.status === 200, `status=${view.status}`);
      check("and it is the file that was uploaded",
        Buffer.from(await view.arrayBuffer()).equals(PNG));

      const nosy = await api(`/storage/file?key=${encodeURIComponent(key)}`, { token: other.token });
      check("somebody else cannot", nosy.status === 403, `status=${nosy.status}`);

      const signedOut = await api(`/storage/file?key=${encodeURIComponent(key)}`);
      check("nor can somebody signed out", signedOut.status === 401, `status=${signedOut.status}`);

      const agentAccount = await register("student", "Support Agent");
      sql(`update users set role = 'admin' where id = ${agentAccount.user.id}`);
      const agentLogin = await api("/auth/login", { method: "POST", body: { email: agentAccount.email, password: "password123" } });
      const asAgent = await api(`/storage/file?key=${encodeURIComponent(key)}`, {
        token: agentLogin.body?.token });
      check("a support agent can, which is the point of an attachment", asAgent.status === 200,
        `status=${asAgent.status}`);

      const madeUp = await api(`/storage/file?key=${encodeURIComponent("../../etc/passwd")}`, {
        token: student.token });
      check("and a key that is not one of ours is refused", madeUp.status === 400, `status=${madeUp.status}`);
    }

    /*
     * A file over the cap, sent through our own server.
     *
     * This is the failure a teacher actually hit. The body parser refuses an oversized body
     * before any route runs, so the upload route's own polite message never got a chance — and
     * with no error handler on the app, Express answered with an HTML page. The app asked for
     * JSON, could not read a reason, and said "Load failed. We also could not send it through
     * our server", which names neither the size nor the limit nor anything to do about it.
     */
    {
      console.log("\nA file too big to accept, sent through our own server\n");
      const oversized = Buffer.alloc(12 * 1024 * 1024, 7);
      const res = await fetch(`${API}/api/storage/upload`, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf", Authorization: `Bearer ${student.token}` },
        body: oversized,
      });
      check("it is refused", res.status === 413, `status=${res.status}`);
      check("the answer is JSON, not an HTML error page",
        (res.headers.get("content-type") ?? "").includes("application/json"),
        res.headers.get("content-type") ?? "none");

      const text = await res.text();
      check("nothing leaks a stack trace", !/\bat \w+ \(|PayloadTooLargeError/.test(text), text.slice(0, 160));

      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      check("and it says how big a file may be", /larger than 10 MB/i.test(parsed?.error ?? ""),
        JSON.stringify(parsed) ?? text.slice(0, 160));
    }

    console.log("\nWith no bucket configured, it says so instead of failing strangely\n");

    {
      // A second server with the R2 settings absent, which is the state on Railway right now.
      const bare = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
        cwd: repoRoot,
        env: {
          ...process.env, PORT: String(API_PORT + 1), DATABASE_URL: PGURL,
          SESSION_SECRET: process.env.SESSION_SECRET ?? "upload-test-secret",
          R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "", R2_ENDPOINT: "", R2_ACCOUNT_ID: "",
        },
        stdio: "ignore",
      });
      for (let i = 0; i < 60; i += 1) {
        try { if ((await fetch(`http://127.0.0.1:${API_PORT + 1}/api/healthz`)).ok) break; } catch { /* not up */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      const res = await fetch(`http://127.0.0.1:${API_PORT + 1}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${student.token}` },
        body: JSON.stringify({ name: "x.png", size: 100, contentType: "image/png" }),
      });
      const body = await res.json().catch(() => ({}));
      check("it answers 503, not 500 — nothing is broken, it is just not set up",
        res.status === 503, `status=${res.status}`);
      check("and says so in words a person can act on",
        /not set up/i.test(String(body?.error)), String(body?.error));
      check("with a flag the app can branch on", body?.unavailable === true, JSON.stringify(body));
      try { bare.kill("SIGKILL"); } catch { /* gone */ }
    }
  } finally {
    await stop();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => { console.error(err); process.exit(1); });
