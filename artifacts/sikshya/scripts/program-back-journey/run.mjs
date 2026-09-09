/**
 * The student's Programs Back-navigation journey.
 *
 * Codex correction round 2, item 5: the `canGoBack() ? back() : replace()` implementation is
 * reasonable but must be proved to actually preserve context on the way back.
 *
 * ## What this proves
 *
 * (a) Discover → Programs → search+chip filter → tap into a Program → in-app Back returns to
 *     the Programs list with the search box still populated and the type filter still active.
 * (b) A direct URL to `/(student)/program/<id>` with *no* prior app history → the in-app Back
 *     control lands on Discover instead of dropping the student on a blank browser tab.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:back-journey
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.BACK_JOURNEY_PORT ?? 8094);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const sql = (statement) => {
  const out = execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" });
  const line = out.split(/\r?\n/).find((l) => l.length > 0 && !/^(INSERT|UPDATE|DELETE|SELECT)\s/.test(l));
  return (line ?? "").trim();
};

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const email = `bj_${Date.now()}_${seq}@example.com`;
  const body = { name: `${role} ${seq}`, email, password: "password123", role };
  if (role === "teacher") Object.assign(body, { subject: "Maths", bio: "x" });
  else Object.assign(body, { grade: "10", dateOfBirth: "2000-01-01" });
  const res = await api("/auth/register", { method: "POST", body });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  prepareBrowserAccount(res.body.user.id);
  if (role === "teacher") {
    sql(`UPDATE teacher_profiles SET approval_status = 'approved', subscription_active = true WHERE user_id = ${res.body.user.id};`);
  }
  return { ...res.body, email };
}

/**
 * Publish a Learning Program via the real API. The client-side journey depends on it being on
 * the public `/programs` list, so this uses the same routes the studio uses.
 */
async function publishProgram(teacher, { title, summary, outcome, intendedLearner, type = "school_subject" }) {
  const created = await api("/learning-programs", { method: "POST", token: teacher.token, body: { type } });
  if (created.status > 201) throw new Error(`create program: ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.program.id;
  const saved = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: {
    title, summary, outcome, intendedLearner,
    startingLevel: "The student is ready to begin from where you set the class up.",
    teachingLanguage: "Nepali and English",
    prerequisites: null, equipment: null,
    referenceName: null, referenceSource: "none",
    modules: [
      { title: "Where we start", outcome: "The student knows what the first lesson covers.",
        description: null, practicePrompt: null },
      { title: "Working steadily", outcome: "The student can do the work end to end.",
        description: null, practicePrompt: null },
    ],
  } });
  if (saved.status > 200) throw new Error(`save program: ${saved.status} ${JSON.stringify(saved.body)}`);
  const published = await api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
  if (published.status > 200) throw new Error(`publish program: ${published.status} ${JSON.stringify(published.body)}`);
  return id;
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first.");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stopServer);

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(siteUrl)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the static server never came up on ${siteUrl}`);
}

async function until(fn, ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const teacher = await register("teacher");
  const student = await register("student");

  // Two publishable programs — one specific enough to search for, one that stays out of the
  // way. The Grade 10 Mathematics title contains a distinctive word ("mathematics") that only
  // this run creates, so the "search still applied on the way back" check can find it
  // reliably even against accumulated fixture data.
  const tag = `back_${Date.now()}`;
  const specificId = await publishProgram(teacher, {
    title: `${tag} Grade 10 Mathematics`,
    summary: "A term of Grade 10 mathematics, worked through week by week together.",
    outcome: "Work through a whole past paper with support from the teacher.",
    intendedLearner: "Grade 10 students preparing for the board examination.",
    type: "school_subject",
  });
  await publishProgram(teacher, {
    title: `${tag} Beginner guitar`,
    summary: "Six weeks of playing songs on acoustic guitar with the teacher.",
    outcome: "Play three songs from memory with clean chord changes.",
    intendedLearner: "New musicians of any age, with no prior experience needed.",
    type: "practical_skill",
  });

  const chromium = await getChromium();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  /* ------------------------------------------------------------------ 1: preserved context */

  console.log("\n[1] Search + filter → open a program → Back preserves both");

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);
  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  // Constrain to the specific program via a search + a chip so both need preserving.
  await page.locator('[data-testid="program-discover-search"]').fill(`${tag} Grade 10`);
  await page.locator('[data-testid="program-discover-search-submit"]').click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="program-discover-chip-school_subject"]').click({ timeout: 10000 });
  await page.waitForTimeout(1500);

  const preText = await page.locator('[data-testid="program-discover-list"]').innerText();
  check("the search + chip narrowed the list to the specific program",
    preText.includes(`${tag} Grade 10 Mathematics`) && !preText.includes(`${tag} Beginner guitar`),
    preText.slice(0, 200).replace(/\n/g, " | "));

  const beforeOpenUrl = await page.evaluate(() => location.pathname);
  check("Discover is on the Discover route before opening a program",
    beforeOpenUrl === "/" || beforeOpenUrl.endsWith("/(student)") || beforeOpenUrl === "/discover" || beforeOpenUrl === "",
    beforeOpenUrl);

  await page.locator(`[data-testid="program-card-${specificId}"]`).click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  const openUrl = await page.evaluate(() => location.pathname);
  check("the program details page opened",
    openUrl.includes(`/program/${specificId}`), openUrl);

  await page.locator('[data-testid="program-view-back"]').click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  const backUrl = await page.evaluate(() => location.pathname);
  check("Back returned to the Discover route",
    backUrl === beforeOpenUrl || backUrl === "/" || backUrl.endsWith("/(student)"),
    `expected ${beforeOpenUrl}, got ${backUrl}`);

  const searchAfter = await page.locator('[data-testid="program-discover-search"]').inputValue().catch(() => "");
  check("the search box is still populated after Back",
    searchAfter === `${tag} Grade 10`, `got "${searchAfter}"`);

  const filteredAfter = await page.locator('[data-testid="program-discover-list"]').innerText();
  check("the filtered list is still on screen after Back",
    filteredAfter.includes(`${tag} Grade 10 Mathematics`) && !filteredAfter.includes(`${tag} Beginner guitar`),
    filteredAfter.slice(0, 200).replace(/\n/g, " | "));

  await ctx.close();

  /* ------------------------------------------------------------------ 2: deep link fallback */

  console.log("\n[2] Deep link → Back safely reaches Discover");

  const deepCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const deepPage = await deepCtx.newPage();
  await deepPage.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);

  // Land directly on the program details page with nothing behind it in the browser history.
  await deepPage.goto(`${siteUrl}/program/${specificId}`, { waitUntil: "networkidle" });
  await deepPage.waitForTimeout(3000);
  check("the program details opened from a cold deep link",
    await until(() => deepPage.locator('[data-testid="program-view-back"]').count().then((n) => n > 0)),
    "program-view-back never rendered");

  await deepPage.locator('[data-testid="program-view-back"]').click({ timeout: 10000 });
  await deepPage.waitForTimeout(2500);
  const deepBackUrl = await deepPage.evaluate(() => location.pathname);
  check("Back from a deep link lands on Discover",
    !deepBackUrl.includes(`/program/${specificId}`),
    `still on ${deepBackUrl}`);
  // The Discover page mounts its Programs sub-tab, so we should see the Programs sub-tab pill.
  check("Discover is what appears after the fallback Back",
    await until(() => deepPage.locator('[data-testid="discover-subtab-programs"]').count().then((n) => n > 0)),
    "discover-subtab-programs never rendered");

  await deepCtx.close();

  /* ------------------------------------------------------------------ 3: invalid id */

  console.log("\n[3] An invalid or missing id ends loading with an honest not-found");

  const badCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const badPage = await badCtx.newPage();
  await badPage.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);

  await badPage.goto(`${siteUrl}/program/abc`, { waitUntil: "networkidle" });
  await badPage.waitForTimeout(2500);
  check("an invalid id ends loading and shows the not-found state",
    await until(() => badPage.locator('[data-testid="program-view-gone"]').count().then((n) => n > 0), 5000),
    "program-view-gone never appeared for id=abc");
  check("and never leaves the spinner up",
    (await badPage.locator('[data-testid="program-view-loading"]').count()) === 0);

  await badCtx.close();

  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
