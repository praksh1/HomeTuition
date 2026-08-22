/**
 * The tabs each role actually sees, in a real browser.
 *
 * The owner asked for two moves: "the 'Plan' tab can be integrated inside the 'Profile' tab,
 * and maybe the Customer Service can be a separate tab for teachers - same for students - the
 * Customer Service needs to have a separate Tab!"
 *
 * Worth a test rather than a look, because moving a screen out of a tab bar is exactly the
 * change that leaves it unreachable: the route still exists, everything compiles, and the only
 * way to notice is to open the app and try to get to it. So this checks both halves — that the
 * tab is gone, and that the screen it held is still one tap from Profile.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:nav
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.NAV_TEST_PORT ?? 8089);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const sql = (statement) => execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" }).trim();

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
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`,
    email: `nav_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  return res.body;
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

/**
 * The labels in the tab bar, read off the rendered page.
 *
 * The icon is a glyph from the Feather font, so each label's text content really begins with a
 * couple of private-use codepoints — invisible in a terminal, and enough to make "Dashboard"
 * fail to start with "Dashboard". They are stripped, or every assertion here would be a
 * substring match pretending to be an exact one.
 */
async function tabLabels(page) {
  return page.$$eval('a[role="tab"]', (nodes) =>
    nodes.map((n) => n.textContent.replace(/[\uE000-\uF8FF]/g, "").trim()),
  );
}

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const chromium = await getChromium();
  const browser = await chromium.launch();

  console.log("\nA teacher's tabs");

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);
  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  const teacherTabs = await tabLabels(page);
  check("Support is a tab of its own", teacherTabs.some((t) => /support/i.test(t)), teacherTabs.join(" | "));
  check("Plan is no longer a tab", !teacherTabs.some((t) => /^plan$/i.test(t)), teacherTabs.join(" | "));
  check("nothing else was lost on the way",
    ["Dashboard", "Sessions", "Students", "Messages", "Profile"].every((want) => teacherTabs.includes(want)),
    JSON.stringify(teacherTabs));

  // The half that a compile cannot catch: the screen that left the tab bar is still reachable.
  await page.click('a[role="tab"][href="/profile"]', { timeout: 15000 });
  await page.waitForTimeout(2500);
  check("Profile offers the plan instead", await page.locator('[data-testid="subscription-link"]').count() > 0);
  await page.locator('[data-testid="subscription-link"]').click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  check("and it opens the subscription screen",
    /subscription/.test(await page.evaluate(() => location.pathname)),
    await page.evaluate(() => location.pathname));

  await page.click('a[role="tab"][href="/support"]', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const supportText = await page.evaluate(() => document.body.innerText);
  check("the Support tab opens the report form", /Customer Support/i.test(supportText),
    supportText.slice(0, 160).replace(/\n/g, " | "));
  await ctx.close();

  /**
   * Opened cold, as a tab, with nothing behind it.
   *
   * The back arrow is fine when there is somewhere to go — arriving here from a class that
   * went wrong, say. It is only a dead control when the tab is the first thing on screen, and
   * that is the case a separate page load reproduces.
   */
  const coldCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const coldPage = await coldCtx.newPage();
  await coldPage.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);
  await coldPage.goto(`${siteUrl}/support`, { waitUntil: "networkidle" });
  await coldPage.waitForTimeout(3000);
  check("opened cold as a tab, there is no back arrow to go nowhere",
    (await coldPage.locator('[data-testid="support-back-btn"]').count()) === 0);
  check("and the form is there all the same",
    /Customer Support/i.test(await coldPage.evaluate(() => document.body.innerText)));
  await coldCtx.close();

  console.log("\nA student's tabs");

  const student = await register("student");
  const ctx2 = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page2 = await ctx2.newPage();
  await page2.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);
  await page2.goto(siteUrl, { waitUntil: "networkidle" });
  await page2.waitForTimeout(3500);

  const studentTabs = await tabLabels(page2);
  check("students get a Support tab too", studentTabs.some((t) => /support/i.test(t)), studentTabs.join(" | "));
  check("their other tabs are untouched",
    ["Discover", "Sessions", "Messages", "Profile"].every((want) => studentTabs.includes(want)),
    JSON.stringify(studentTabs));

  await page2.click('a[role="tab"][href="/support"]', { timeout: 15000 });
  await page2.waitForTimeout(2500);
  check("and it opens the same report form",
    /Customer Support/i.test(await page2.evaluate(() => document.body.innerText)));

  console.log("\nWhat the cleanup moved");

  /**
   * Three small changes the owner asked for, each of which is invisible to a typecheck and
   * would be found only by opening the app: a link removed from Profile, a set of invented
   * numbers removed from Messages, and a list moved from Profile into Discover.
   */
  const ctx3 = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page3 = await ctx3.newPage();
  await page3.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), student.token);

  await page3.goto(`${siteUrl}/profile`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(3000);
  const profile = await page3.evaluate(() => document.body.innerText);
  check("Support is gone from the student's Profile", !/Customer Support/i.test(profile),
    profile.slice(0, 200).replace(/\n/g, " | "));
  check("and so is the list of teachers they follow", !/Teachers you follow/i.test(profile),
    profile.slice(0, 200).replace(/\n/g, " | "));

  await page3.goto(`${siteUrl}/`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(3500);
  check("Discover has a Following sub-tab", (await page3.locator('[data-testid="discover-subtab-following"]').count()) > 0);
  // Looked for as an element, not as text: a placeholder is an attribute, so it never appears
  // in innerText and an assertion against the page's text could not have passed.
  const searchBox = 'input[placeholder*="Search name"]';
  check("and Discover is what it opens on", (await page3.locator(searchBox).count()) > 0);

  await page3.locator('[data-testid="discover-subtab-following"]').click({ timeout: 10000 });
  await page3.waitForTimeout(2500);
  const following = await page3.evaluate(() => document.body.innerText);
  check("tapping Following shows the follow list instead of the search",
    /not following anyone yet/i.test(following) || (await page3.locator('[data-testid="followed-teachers"]').count()) > 0,
    following.slice(0, 220).replace(/\n/g, " | "));
  check("and the search box is out of the way while it is showing",
    (await page3.locator(searchBox).count()) === 0, following.slice(0, 220).replace(/\n/g, " | "));

  await page3.locator('[data-testid="discover-subtab-discover"]').click({ timeout: 10000 });
  await page3.waitForTimeout(2000);
  check("and going back to Discover brings the search box back",
    (await page3.locator(searchBox).count()) > 0);

  /**
   * Real conversations first, or this proves nothing.
   *
   * An account with no messages shows no numbers whatever the rule is, so an assertion against
   * an empty inbox passes just as happily with the old behaviour as with the new one. The
   * student sends one message (filling Sent) and receives two (filling Inbox with genuine
   * unread), which is exactly the shape that used to read "Inbox (1) · Sent (1)".
   */
  await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: { body: "Hello" } });
  await api(`/messages/${student.user.id}`, { method: "POST", token: teacher.token, body: { body: "Hi there" } });
  await api(`/messages/${student.user.id}`, { method: "POST", token: teacher.token, body: { body: "And again" } });

  await page3.goto(`${siteUrl}/messages`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(3500);
  const messages = await page3.evaluate(() => document.body.innerText);
  check("the conversation is actually there, so these checks mean something",
    /Teacher|Hi there|And again/.test(messages), messages.slice(0, 260).replace(/\n/g, " | "));
  check("Messages shows no invented count beside Sent",
    !/Sent \(\d+\)/.test(messages), messages.slice(0, 260).replace(/\n/g, " | "));
  check("nor beside Drafts",
    !/Drafts \(\d+\)/.test(messages), messages.slice(0, 260).replace(/\n/g, " | "));
  check("and Inbox counts unread messages, not conversations",
    /Inbox \(2\)/.test(messages), messages.slice(0, 260).replace(/\n/g, " | "));

  await ctx3.close();

  await ctx2.close();
  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
