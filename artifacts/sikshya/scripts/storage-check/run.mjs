/**
 * The file-storage check, on the screen an owner can actually reach.
 *
 * This exists because of a mistake worth not repeating. Uploads were failing on the live site,
 * a check was written to say why, and the owner was told to open the endpoint in their phone's
 * browser. It answered `{"error":"Missing or invalid Authorization header"}` — the only thing
 * it could ever have said, because this API takes a Bearer token the app holds and a browser
 * tab has none. A diagnostic nobody can run is not a diagnostic.
 *
 * So the check lives on a button in the support desk, and this drives that button in a real
 * browser against a bucket that refuses writes — which is what a read-only R2 API token does,
 * and the likeliest cause of what the owner saw.
 *
 * Usage: PGURL=... node scripts/storage-check/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PORT = Number(process.env.CHECK_SITE_PORT ?? 8096);
const siteUrl = `http://localhost:${PORT}`;
const API_PORT = Number(process.env.CHECK_API_PORT ?? 8094);
const API = `http://127.0.0.1:${API_PORT}`;
const R2_PORT = Number(process.env.CHECK_R2_PORT ?? 9496);
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const serverRoot = path.resolve(appRoot, "..", "api-server");
const repoRoot = path.resolve(appRoot, "..", "..");

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`   PASS  ${n}`); } else { failed++; failures.push(`${n} — ${d}`); console.log(`   FAIL  ${n} — ${d}`); } };
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  const r = await fetch(`${API}/api${p}`, { method: o.method ?? "GET", headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t }; }
  return { status: r.status, body: b };
}

/**
 * This suite starts its own API and its own bucket.
 *
 * It used to drive whichever API happened to be running, with whatever R2 settings were in the
 * developer's `.env`. That passed on a machine where R2 was pointed at a stand-in and would
 * have failed everywhere else — including CI, which configures no R2 at all, so the check
 * would report "not configured" and every assertion about a *refusal* would be wrong. The
 * upload suite learned this the hard way and its header says so; this is the same lesson.
 *
 * The bucket here refuses writes and answers everything else, which is what a read-only R2 API
 * token does — the failure this whole screen was built to explain.
 */
const readOnlyBucket = http.createServer((req, res) => {
  if (req.method === "PUT") {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(403, { "Content-Type": "application/xml" });
      res.end('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>');
    });
    return;
  }
  res.writeHead(200).end();
});
await new Promise((r) => readOnlyBucket.listen(R2_PORT, "127.0.0.1", r));

const apiProcess = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATABASE_URL: PGURL,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "storage-check-test-secret",
    // Every setting present, as it is in production — so a failure here can only be the token
    // or the bucket, which is the distinction the screen exists to draw.
    R2_ACCOUNT_ID: "abc123def456abc123def456abc123de",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key-not-a-real-one",
    R2_BUCKET: "hometuition-test",
    R2_ENDPOINT: `http://127.0.0.1:${R2_PORT}`,
  },
  stdio: "ignore",
});

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], { cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const stop = () => {
  try { server.kill(); } catch {}
  try { apiProcess.kill(); } catch {}
  try { readOnlyBucket.close(); } catch {}
};
process.on("exit", stop);
for (let i = 0; i < 40; i++) { try { if ((await fetch(siteUrl)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${API}/api/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }

const stamp = Date.now();
const account = (await api("/auth/register", { method: "POST", body: {
  name: "Owner", email: `chk_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(account.user.id);
sql(`update users set role = 'admin' where id = ${account.user.id}`);
const agent = (await api("/auth/login", { method: "POST", body: {
  email: `chk_${stamp}@example.com`, password: "password123",
} })).body;

/*
 * The mistake itself, pinned down: the endpoint with no token is not a way in.
 */
const anonymous = await api("/admin/storage/check");
check("the endpoint alone tells a browser nothing", anonymous.status === 401, `status=${anonymous.status}`);
check("which is exactly what the owner saw", /Authorization header/i.test(String(anonymous.body?.error)),
  JSON.stringify(anonymous.body));

const chromium = await getChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("dialog", async (d) => { await d.accept(); });
const builtApi = (process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
if (builtApi !== API) {
  await page.route(`${builtApi}/**`, async (route) => {
    await route.continue({ url: route.request().url().replace(builtApi, API) });
  });
}
await page.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), agent.token);
await page.goto(`${siteUrl}/(admin)`, { waitUntil: "networkidle" });
await page.waitForTimeout(4500);

const button = page.locator('[data-testid="admin-storage-check"]');
check("the support desk offers the check", await button.count() > 0);
await button.first().click();
await page.waitForTimeout(3500);

const body = await page.evaluate(() => document.body.innerText);
check("it reports the bucket is not working", /Not working/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and says where it stopped", /failed at "write"/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
/*
 * The sentence that matters: a read-only token is the likeliest cause, and "try again" is the
 * one thing that will never fix it.
 */
check("and names what to change", /Object Read & Write/i.test(body), body.slice(0, 600).replace(/\n/g, " | "));
check("with the code storage actually returned", /AccessDenied/.test(body), body.slice(0, 600).replace(/\n/g, " | "));
check("and confirms the settings are all present, so they are not the fault",
  /All storage settings are present/i.test(body), body.slice(0, 700).replace(/\n/g, " | "));

/*
 * A screen that shows configuration must never become a place to read a secret.
 */
check("no secret is anywhere on the screen",
  !/testsecret/i.test(body) && !/TESTKEYID/i.test(body), body.slice(0, 700).replace(/\n/g, " | "));

/* And an ordinary user cannot reach any of it. */
const student = (await api("/auth/register", { method: "POST", body: {
  name: "Student", email: `chks_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(student.user.id);
const asStudent = await api("/admin/storage/check", { token: student.token });
check("a student cannot run the check", asStudent.status === 403, `status=${asStudent.status}`);

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
