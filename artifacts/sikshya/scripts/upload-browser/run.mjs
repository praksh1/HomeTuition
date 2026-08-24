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
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/upload-browser/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.UPLOAD_SITE_PORT ?? 8095);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

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
    name: `Student ${seq}`, email, password: "password123", role, grade: "10" } });
  if (res.status > 201) throw new Error(`register: ${res.status}`);
  return { ...res.body, email };
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first.");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
const stopServer = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stopServer);

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(siteUrl)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the static server never came up");
}

async function main() {
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
  await page.route("**/127.0.0.1:9401/**", async (route) => {
    directAttempts += 1;
    await route.abort("failed");
  });

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
  await browser.close();
  stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
