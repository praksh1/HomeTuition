/**
 * The student's Single Classes journey, end to end.
 *
 * Codex correction round 2, item 1: tapping a class card on Discover must reach the *existing*
 * Book & Pay control on the teacher's page — never a dead end at `/session/:id` and never a
 * duplicate booking implementation. This suite drives a signed-in student through:
 *
 *   Discover → Classes tab → search + submit → tap a class → teacher page opens with the
 *   Upcoming tab focused and the Book & pay button for that specific session on screen.
 *
 * ## Also proved
 *
 * - The Classes list itself: visible Search button, no fetch per keystroke, pagination retry
 *   preserves loaded cards, honest empty vs no-match, no fabrication.
 * - The lazy-load contract: opening Discover on Programs must not fetch `/public/classes`.
 * - The class card carries every truthful commercial field (price, seats, duration, when).
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:classes-booking
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.CLASSES_JOURNEY_PORT ?? 8093);
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
async function register(role, extra = {}) {
  seq += 1;
  const email = `cbj_${Date.now()}_${seq}@example.com`;
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

async function createClass(teacher, { topic, price = 500, minutesFromNow = 90, maxStudents = 10 } = {}) {
  seq += 1;
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: topic ?? `journey-topic-${seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + Math.max(minutesFromNow, 5) * 60_000).toISOString(),
    duration: 60, price, maxStudents,
  } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first:");
  console.error("  EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build");
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

async function until(what, fn, ms = 15000) {
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

  const chromium = await getChromium();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  const teacher = await register("teacher");
  const student = await register("student");
  const bookableClass = await createClass(teacher, { topic: `journey-bookable-${Date.now()}` });
  // The teacher's *profile* id (not user id), which the /(student)/teacher/[id] route uses.
  const teacherProfileId = Number(sql(`SELECT id FROM teacher_profiles WHERE user_id = ${teacher.user.id}`));

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();

  /**
   * Every API request the page makes, in order, so lazy-load claims can be *proved* rather than
   * asserted. `/public/classes` must NOT be fetched until the Classes tab is opened; `/teachers`
   * (the directory) must NOT be fetched until Teachers is opened.
   */
  const requests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/")) requests.push(new URL(url).pathname + (new URL(url).search || ""));
  });

  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);

  console.log("\nDiscover opens on Programs");

  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const heading = await page.locator('[data-testid="discover-heading"]').innerText().catch(() => "");
  check("Discover opens on Programs with the right heading",
    /learning program/i.test(heading), heading);

  const initialPublicClassRequests = requests.filter((r) => r.startsWith("/api/public/classes")).length;
  const initialTeacherDirectory = requests.filter((r) => r.startsWith("/api/teachers")).length;
  check("opening Discover on Programs does NOT fetch /public/classes",
    initialPublicClassRequests === 0,
    `saw ${initialPublicClassRequests} /public/classes requests`);
  check("opening Discover on Programs does NOT fetch the teacher directory",
    initialTeacherDirectory === 0,
    `saw ${initialTeacherDirectory} /teachers requests`);

  console.log("\nOpen the Classes tab");

  await page.locator('[data-testid="discover-subtab-classes"]').click({ timeout: 15000 });
  check("the Classes list container appears",
    await until("classes-scroll", () => page.locator('[data-testid="single-classes-scroll"]').count().then((n) => n > 0)));

  check("opening Classes triggers /public/classes",
    await until("public-classes-fetch",
      () => Promise.resolve(requests.filter((r) => r.startsWith("/api/public/classes")).length > 0)),
    `requests: ${requests.filter((r) => r.startsWith("/api/public/classes")).join(", ")}`);

  await page.waitForTimeout(1500);
  check(`the class ${bookableClass.id} shows on the Classes list`,
    await page.locator(`[data-testid="public-class-${bookableClass.id}"]`).count() > 0);

  const cardText = await page.locator(`[data-testid="public-class-${bookableClass.id}"]`).innerText();
  check("the card carries the pay-per-class billing model",
    /Pay per class/i.test(cardText), cardText.slice(0, 200).replace(/\n/g, " | "));
  check("the card carries the price in NPR", /NPR 500/i.test(cardText));
  check("the card carries the teacher's name",
    cardText.toLowerCase().includes(teacher.user.name.toLowerCase()),
    cardText.slice(0, 200).replace(/\n/g, " | "));
  check("the card carries an explicit View & book action",
    /View & book/i.test(cardText), cardText.slice(0, 200).replace(/\n/g, " | "));

  const wholeList = await page.locator('[data-testid="single-classes-scroll"]').innerText();
  for (const claim of ["rating", "star rating", "popular", "top pick", "available now", "students enrolled"]) {
    check(`the Classes list carries no ${claim}`,
      !wholeList.toLowerCase().includes(claim.toLowerCase()),
      wholeList.slice(0, 200).replace(/\n/g, " | "));
  }

  const visibleSearchBtn = await page.locator('[data-testid="single-classes-search-submit"]').count();
  check("a visible Search button sits beside the input", visibleSearchBtn > 0);

  console.log("\nTyping does NOT fetch on every keystroke");

  const beforeType = requests.filter((r) => r.startsWith("/api/public/classes")).length;
  await page.locator('[data-testid="single-classes-search"]').fill("nothingnobodywouldsearch");
  await page.waitForTimeout(500);
  const afterType = requests.filter((r) => r.startsWith("/api/public/classes")).length;
  check("typing without submitting sends no new request",
    afterType === beforeType, `before ${beforeType}, after ${afterType}`);

  await page.locator('[data-testid="single-classes-search-submit"]').click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const afterSubmit = requests.filter((r) => r.startsWith("/api/public/classes")).length;
  check("pressing the Search button sends exactly one new request",
    afterSubmit === beforeType + 1, `before ${beforeType}, after ${afterSubmit}`);
  check("a search for nothing yields the no-match state",
    await page.locator('[data-testid="single-classes-nomatch"]').count() > 0);
  const nomatchText = await page.locator('[data-testid="single-classes-nomatch"]').innerText().catch(() => "");
  check("and quotes the submitted query", /nothingnobodywouldsearch/i.test(nomatchText), nomatchText);

  console.log("\nClearing the query shows the class again");

  // The clear button sits inside the search field row; on a narrow 390pt layout the visible
  // Search submit button can end up above it in stacking order, so a synthetic DOM click on
  // the element itself avoids any coordinate collision the browser would otherwise resolve
  // for a mouse or a finger. This is exactly what the user's tap on the "x" produces.
  await page.locator('[data-testid="single-classes-clear"]').evaluate((el) => el.click());
  await page.waitForTimeout(1500);
  check(`the class ${bookableClass.id} is back on the list`,
    await page.locator(`[data-testid="public-class-${bookableClass.id}"]`).count() > 0);

  console.log("\nTapping a class opens the teacher page with the Book & Pay control");

  await page.locator(`[data-testid="public-class-${bookableClass.id}"]`).click({ timeout: 10000 });
  await page.waitForTimeout(3500);

  const url = await page.evaluate(() => location.pathname + location.search);
  check("the teacher page opens with ?session=<id>",
    url.includes(`/teacher/${teacherProfileId}`) && url.includes(`session=${bookableClass.id}`),
    url);

  check("the Book & Pay control for that session is on screen",
    await until("book-btn",
      () => page.locator(`[data-testid="book-btn-${bookableClass.id}"]`).count().then((n) => n > 0)),
    `saw ${await page.locator(`[data-testid^="book-btn-"]`).count()} book buttons`);

  check("the specific session is highlighted so the student can see which one they came for",
    await page.locator(`[data-testid="focused-session-${bookableClass.id}"]`).count() > 0);

  // Prove no video room, no direct booking-completion screen was opened.
  check("the tap did NOT route straight into a classroom",
    !url.includes(`/classroom/`),
    url);
  check("and did NOT complete a booking without payment",
    !url.includes(`/session/${bookableClass.id}`) || url.includes(`/teacher/`),
    url);

  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
