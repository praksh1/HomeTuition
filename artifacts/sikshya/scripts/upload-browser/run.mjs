/**
 * Attaching a photo from a real browser, with the bucket refusing the direct upload.
 *
 * This is the live-site failure: R2 with no CORS rule will not accept a cross-origin PUT, and
 * Safari reports it as "Load failed" and nothing more. The app is supposed to notice and send
 * the file through our own API instead.
 *
 * Chromium is made to refuse the direct PUT the same way, by failing the request to the bucket
 * host outright. If the fallback works, the report still carries its attachment.
 *
 * It starts **its own API**, with the file store pointed at the same stand-in bucket the
 * server-side upload suite uses. It used to talk to whatever API was already running, and in CI
 * that one has no file store configured — so every request for an upload link came back "not
 * set up", the browser never reached the bucket at all, and this suite failed on every push.
 * It had never once passed there. Because it is one of the steps the deploy waits on, the site
 * stopped being deployed and nobody was told why.
 *
 * Usage: node scripts/upload-browser/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";
import { startFakeR2 } from "../../../api-server/scripts/upload-tests/fake-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const serverRoot = path.resolve(repoRoot, "artifacts", "api-server");
const PORT = Number(process.env.UPLOAD_SITE_PORT ?? 8095);
const siteUrl = `http://localhost:${PORT}`;
const R2_PORT = Number(process.env.UPLOAD_R2_PORT ?? 9401);
const API_PORT = Number(process.env.UPLOAD_API_PORT ?? 8097);
const API = `http://127.0.0.1:${API_PORT}`;
const BUCKET = "hometuition-test";
const KEY_ID = "test-access-key";
const SECRET = "test-secret-key-not-a-real-one";
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const email = `ub_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: role === "teacher" ? `Teacher ${seq}` : `Student ${seq}`,
    email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register: ${res.status}`);
  prepareBrowserAccount(res.body.user.id);
  return { ...res.body, email };
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first.");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});

let apiProcess = null;
let r2 = null;
const stopServer = () => {
  try { server.kill(); } catch { /* gone */ }
  try { apiProcess?.kill("SIGKILL"); } catch { /* gone */ }
  try { r2?.close(); } catch { /* gone */ }
};
process.on("exit", stopServer);

/** The API this suite drives, with a file store that really signs and really stores. */
async function startApi() {
  r2 = await startFakeR2({ port: R2_PORT, bucket: BUCKET, secret: SECRET });
  apiProcess = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "upload-browser-test-secret",
      R2_ACCESS_KEY_ID: KEY_ID,
      R2_SECRET_ACCESS_KEY: SECRET,
      R2_BUCKET: BUCKET,
      R2_ENDPOINT: `http://127.0.0.1:${R2_PORT}`,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the API never came up");
}

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(siteUrl)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the static server never came up");
}

async function main() {
  await startApi();
  await waitForSite();
  const chromium = await getChromium();
  const browser = await chromium.launch();
  const student = await register("student");

  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();

  /**
   * Every request to the bucket host is failed, which is what a browser does on its own when a
   * bucket has no CORS rule naming this origin.
   */
  let directAttempts = 0;
  await page.route("**/*r2.cloudflarestorage.com/**", async (route) => {
    directAttempts += 1;
    await route.abort("failed");
  });
  // The local stand-in stands in for the bucket in this environment.
  await page.route(`**/127.0.0.1:${R2_PORT}/**`, async (route) => {
    directAttempts += 1;
    await route.abort("failed");
  });

  /*
   * The bundle was built against whatever API the build used, which is not the one this suite
   * just started. Rather than rebuild for one port, every call to that origin is sent here.
   */
  const builtApi = (process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
  if (builtApi !== API) {
    await page.route(`${builtApi}/**`, async (route) => {
      const url = route.request().url().replace(builtApi, API);
      await route.continue({ url });
    });
  }

  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);
  await page.goto(`${siteUrl}/support`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  /**
   * The highest id before, so the row this run creates can be identified exactly.
   *
   * Counting was not enough: when the submit silently failed, "the file went with it" read the
   * newest row from an *earlier* run and passed. An assertion that can be satisfied by
   * somebody else's data is not an assertion.
   */
  const before = Number(sql("select coalesce(max(id), 0) from disputes"));

  // A real PNG, handed to the file input the picker renders on web.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  // Through the real controls, by their testIDs — the reason lives behind a select, so clicking
  // the words on the page does not choose it and the form stays unsubmittable.
  await page.locator('[data-testid="dispute-reason-select"]').click({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="dispute-reason-option-Technical Failure"]').click({ timeout: 15000 });
  await page.waitForTimeout(600);

  const box = page.locator("textarea").first();
  await box.fill("The board never loaded and I could not see anything.");

  /**
   * The picker builds its file input on demand, so there is nothing in the DOM to fill until
   * the button is pressed. Playwright's file chooser event is the way in.
   */
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 20000 }).catch(() => null),
    page.locator('[data-testid="dispute-upload-btn"]').click({ timeout: 15000 }),
  ]);
  check("the attach button opens a file picker", chooser !== null);
  if (chooser) {
    await chooser.setFiles({ name: "IMG_4531.png", mimeType: "image/png", buffer: png });
    await page.waitForTimeout(2000);
    check("the chosen file is shown", /IMG_4531\.png/.test(await page.evaluate(() => document.body.innerText)));

    const submit = page.locator('text=/Submit Report/i').last();
    await submit.click({ timeout: 15000 });
    await page.waitForTimeout(9000);

    check("the browser tried the bucket directly first", directAttempts > 0, `attempts=${directAttempts}`);

    const after = Number(sql("select coalesce(max(id), 0) from disputes"));
    check("the report was filed", after > before, `before=${before} after=${after}`);

    const evidence = after > before
      ? sql(`select coalesce(evidence_url, '') from disputes where id = ${after}`)
      : "";
    check("and the file went with it, through the server",
      evidence.startsWith("evidence/"),
      evidence ? `evidence=${evidence}` : "the report was filed with no attachment at all");
    check("nothing told the person their file was lost",
      !dialogs.some((d) => /did not go with it/i.test(d)), JSON.stringify(dialogs));
  }

  await ctx.close();

  /**
   * Homework, which is where the owner actually met this.
   *
   * It goes through the same `utils/uploadFile.ts` as a support report, but not through the
   * same screen: the report has its own upload button and homework has a `FilePickerRow`. A
   * shared function is not a shared control, and the control is where the last one broke — so
   * this drives the real one, with the bucket refusing direct uploads exactly as before.
   */
  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
  const plan = await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  check("the homework teacher has a monthly plan", plan.status <= 201,
    `status=${plan.status} ${JSON.stringify(plan.body).slice(0, 160)}`);
  const made = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "Daily algebra hour", startMinute: 17 * 60, durationMinutes: 60,
    timeZone: "Asia/Kathmandu", monthlyPrice: 2000, maxStudents: 20,
  } });
  const classId = made.body?.id ?? made.body?.class?.id;
  check("a monthly class exists to set homework on", !!classId,
    `status=${made.status} ${JSON.stringify(made.body).slice(0, 160)}`);

  if (classId) {
    const hwCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    const hw = await hwCtx.newPage();
    let hwDirect = 0;
    await hw.route("**/*r2.cloudflarestorage.com/**", async (route) => { hwDirect += 1; await route.abort("failed"); });
    await hw.route(`**/127.0.0.1:${R2_PORT}/**`, async (route) => { hwDirect += 1; await route.abort("failed"); });
    if (builtApi !== API) {
      await hw.route(`${builtApi}/**`, async (route) => {
        await route.continue({ url: route.request().url().replace(builtApi, API) });
      });
    }
    const hwDialogs = [];
    hw.on("dialog", async (d) => { hwDialogs.push(d.message()); await d.accept(); });
    await hw.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);
    await hw.goto(`${siteUrl}/monthly-homework?id=${classId}`, { waitUntil: "networkidle" });
    await hw.waitForTimeout(4000);

    // The form is behind a "new homework" toggle when the list is on screen.
    const newBtn = hw.locator('[data-testid="homework-new"]');
    if (await newBtn.count() > 0) { await newBtn.first().click(); await hw.waitForTimeout(1200); }

    await hw.locator('[data-testid="homework-title"]').fill("Chapter 3");
    await hw.locator('[data-testid="homework-instructions"]').fill("Questions 1 to 10 on page 62.");

    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    const [hwChooser] = await Promise.all([
      hw.waitForEvent("filechooser", { timeout: 20000 }).catch(() => null),
      hw.locator('[data-testid="homework-file"]').click({ timeout: 15000 }),
    ]);
    check("the homework form opens a file picker", hwChooser !== null);

    if (hwChooser) {
      // A PDF, because that is what the owner was attaching when it failed.
      await hwChooser.setFiles({ name: "worksheet.pdf", mimeType: "application/pdf", buffer: pdf });
      await hw.waitForTimeout(1500);
      check("the chosen worksheet is shown", /worksheet\.pdf/.test(await hw.evaluate(() => document.body.innerText)));

      const beforeHw = Number(sql("select coalesce(max(id), 0) from homework"));
      await hw.locator('[data-testid="homework-set"]').click({ timeout: 15000 });
      await hw.waitForTimeout(9000);

      check("the browser tried the bucket directly for homework too", hwDirect > 0, `attempts=${hwDirect}`);
      const afterHw = Number(sql("select coalesce(max(id), 0) from homework"));
      check("the homework was set", afterHw > beforeHw, `before=${beforeHw} after=${afterHw}`);

      const key = afterHw > beforeHw
        ? sql(`select coalesce(file_key, '') from homework where id = ${afterHw}`)
        : "";
      check("and the worksheet went with it, through the server",
        key.startsWith("evidence/"),
        key ? `file_key=${key}` : "the homework was set with no file at all");
      check("nothing told the teacher their file was lost",
        !hwDialogs.some((d) => /could not store|did not go with it/i.test(d)), JSON.stringify(hwDialogs));
    }
    await hwCtx.close();
  }

  await browser.close();
  stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
