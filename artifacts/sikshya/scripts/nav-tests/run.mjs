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
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

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
  // The address is returned too: register does not echo it, and half this suite signs people
  // back in. Without it every login here sent `undefined` and came back "email and password
  // are required" — which looks exactly like a broken login rather than a broken test.
  const email = `nav_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`,
    email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
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
  /*
   * Matched on the form itself, not on its heading.
   *
   * This asked for the words "Customer Support" and went red when the screen was renamed to
   * "Support" — a test failing for a change that was correct, which blocked the deploy of
   * everything behind it. A heading is copy and will be rewritten again; the field somebody
   * types their problem into is the screen. Matching the word "Support" instead would have
   * been worse than either: the tab bar says Support on every screen, so the check would pass
   * without going anywhere.
   */
  const supportText = await page.evaluate(() => document.body.innerText);
  check("the Support tab opens the report form",
    (await page.locator('[data-testid="dispute-description-input"]').count()) > 0,
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
    (await coldPage.locator('[data-testid="dispute-description-input"]').count()) > 0,
    (await coldPage.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n/g, " | "));
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
    (await page2.locator('[data-testid="dispute-description-input"]').count()) > 0,
    (await page2.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n/g, " | "));

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
  // By testID, not by placeholder copy: selecting on wording makes a rewrite of the
  // placeholder look like a navigation failure.
  const searchBox = '[data-testid="discover-search"]';
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
   * An account with no messages shows one empty list whatever the rule is, so an assertion
   * here passes just as happily with folders as without them. The last message is deliberately
   * the student's own: under Inbox/Sent that moved the conversation out of the Inbox the
   * moment they replied, which is the behaviour the owner asked to be rid of — the same thread
   * moving between tabs as it goes on.
   */
  await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: { body: "Hello" } });
  await api(`/messages/${student.user.id}`, { method: "POST", token: teacher.token, body: { body: "Hi there" } });
  await api(`/messages/${student.user.id}`, { method: "POST", token: teacher.token, body: { body: "And again" } });
  await api(`/messages/${teacher.user.id}`, { method: "POST", token: student.token, body: { body: "Thank you sir" } });

  /*
   * And one conversation the student started and nobody has answered.
   *
   * This is the case the folders actually lost. The conversation above still has unread
   * messages in it, so the old Inbox showed it anyway — a check against that one would have
   * passed under both designs and proved nothing. A conversation you spoke last in with
   * nothing unread was the one that vanished from Inbox and could only be found under Sent.
   */
  const quietTeacher = await register("teacher");
  await api(`/messages/${quietTeacher.user.id}`, { method: "POST", token: student.token, body: {
    body: "Sir, are you taking new students?" } });

  await page3.goto(`${siteUrl}/messages`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(3500);
  const messages = await page3.evaluate(() => document.body.innerText);
  check("the conversation is actually there, so these checks mean something",
    /Teacher|Thank you sir/.test(messages), messages.slice(0, 260).replace(/\n/g, " | "));
  check("Messages has no folders to file a conversation into",
    !/\bInbox\b/.test(messages) && !/\bDrafts\b/.test(messages),
    messages.slice(0, 260).replace(/\n/g, " | "));
  /*
   * One row each, both present. Two rows for one person would mean the conversation had been
   * split; a missing quiet one means speaking last had filed it out of sight again.
   */
  check("a conversation the student answered stays in the one list",
    (await page3.locator(`[data-testid="conversation-row-${teacher.user.id}"]`).count()) === 1,
    messages.slice(0, 260).replace(/\n/g, " | "));
  check("and so does one nobody has answered yet",
    (await page3.locator(`[data-testid="conversation-row-${quietTeacher.user.id}"]`).count()) === 1,
    messages.slice(0, 260).replace(/\n/g, " | "));
  check("still carrying what has not been read",
    /\b2\b/.test(messages), messages.slice(0, 260).replace(/\n/g, " | "));

  await ctx3.close();

  await ctx2.close();
  console.log("\nThe support desk");

  /**
   * An agent's screens, and the fact that nobody else can reach them.
   *
   * The server refuses every /admin route to anyone who is not an agent, re-reading the role
   * on each request — that half is covered in the API's own suite. What only a browser can
   * show is whether the screens exist, whether the evidence an agent decides on is actually on
   * them, and whether a teacher who types the address gets bounced.
   */
  const agentAccount = await register("student");
  sql(`update users set role = 'admin' where id = ${agentAccount.user.id}`);
  const agentLogin = await api("/auth/login", { method: "POST", body: {
    email: agentAccount.email, password: "password123" } });
  const agentToken = agentLogin.body?.token;
  check("an agent can sign in", !!agentToken, `status ${agentLogin.status}`);

  /**
   * Through the real login screen, not just the endpoint.
   *
   * The endpoint always worked; the *screen* refused. It checks that the account's role
   * matches the door it came through — right for a teacher at the student login, and fatal for
   * an agent, because there is no agent door. Both doors logged them out again and the support
   * desk could not be reached at all. Only driving the screen shows that.
   */
  const doorCtx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const doorPage = await doorCtx.newPage();
  const doorDialogs = [];
  doorPage.on("dialog", async (d) => { doorDialogs.push(d.message()); await d.dismiss(); });
  await doorPage.goto(`${siteUrl}/login?role=student`, { waitUntil: "networkidle" });
  await doorPage.waitForTimeout(3000);
  await doorPage.locator('input[type="email"], input[inputmode="email"]').first().fill(agentAccount.email);
  await doorPage.locator('input[type="password"]').first().fill("password123");
  await doorPage.locator('text=/^(Log In|Sign In|Login)$/i').first().click({ timeout: 10000 });
  await doorPage.waitForTimeout(5000);

  const landed = await doorPage.evaluate(() => ({ url: location.pathname, text: document.body.innerText }));
  check("signing in through the student door does not throw an agent out",
    !/registered as a/i.test(doorDialogs.join(" ")) && !/registered as a/i.test(landed.text),
    `${JSON.stringify(doorDialogs)} ${landed.text.slice(0, 160).replace(/\n/g, " | ")}`);
  check("and they land on the support desk", /Support|Tickets/i.test(landed.text),
    `${landed.url} ${landed.text.slice(0, 200).replace(/\n/g, " | ")}`);
  await doorCtx.close();

  // Something for them to look at.
  const reporter = await register("student");
  const subject = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved', subscription_active = true where user_id = ${subject.user.id}`);
  const klass = await api("/sessions", { method: "POST", token: subject.token, body: {
    topic: "Disputed Class", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 5 * 60_000).toISOString(), duration: 60, price: 500, maxStudents: 10 } });
  await api(`/sessions/${klass.body.id}/book`, { method: "POST", token: reporter.token, body: { paymentMethod: "esewa" } });
  await api(`/sessions/${klass.body.id}/messages`, { method: "POST", token: subject.token,
    body: { body: "Sorry, I am running late." } });
  const ticket = await api("/disputes", { method: "POST", token: reporter.token, body: {
    reason: "Refund Request", description: "Nobody taught me anything.", sessionId: klass.body.id } });

  const agentCtx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const agentPage = await agentCtx.newPage();
  /**
   * Suspending an account asks "are you sure?" first, and Playwright dismisses dialogs unless
   * something says otherwise — so without this the suspension silently never happened and the
   * failure looked like a broken route rather than an unanswered question.
   */
  agentPage.on("dialog", async (d) => { await d.accept(); });
  await agentPage.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), agentToken);
  await agentPage.goto(siteUrl, { waitUntil: "networkidle" });
  await agentPage.waitForTimeout(4000);

  const agentTabs = await tabLabels(agentPage);
  check("an agent lands on the support desk, not a dashboard",
    agentTabs.includes("Tickets") && agentTabs.includes("People") && agentTabs.includes("Activity"),
    JSON.stringify(agentTabs));
  check("and gets none of the teaching or learning tabs",
    !agentTabs.includes("Discover") && !agentTabs.includes("Sessions") && !agentTabs.includes("Dashboard"),
    JSON.stringify(agentTabs));

  const queue = await agentPage.evaluate(() => document.body.innerText);
  check("the queue shows the open ticket", /Refund Request/i.test(queue),
    queue.slice(0, 240).replace(/\n/g, " | "));

  await agentPage.locator(`[data-testid="admin-ticket-${ticket.body.id}"]`).click({ timeout: 15000 });
  await agentPage.waitForTimeout(3000);
  const detail = await agentPage.evaluate(() => document.body.innerText);
  check("opening it shows what was reported", /Nobody taught me anything/i.test(detail),
    detail.slice(0, 240).replace(/\n/g, " | "));
  check("and the class it is about", /Disputed Class/i.test(detail));
  check("and the class's messages, as evidence", /running late/i.test(detail),
    detail.slice(0, 400).replace(/\n/g, " | "));
  check("and says plainly that the decision is the agent's",
    /not a decision/i.test(detail), detail.slice(0, 400).replace(/\n/g, " | "));

  /*
   * The buttons are drawn from what the server says the ticket may become, so the one that
   * closes it is named after the state rather than after the act. See lib/tickets.ts.
   */
  await agentPage.locator('[data-testid="admin-move-resolved"]').click({ timeout: 10000 });
  await agentPage.waitForTimeout(2500);
  /*
   * Still "opened", not "open": reading it at the desk is itself a step and is recorded as one.
   * What matters here is that the refused close left the ticket exactly where it was.
   */
  check("closing it without a decision written is refused",
    sql(`select status from disputes where id = ${ticket.body.id}`) === "opened",
    sql(`select status from disputes where id = ${ticket.body.id}`));

  await agentPage.locator('[data-testid="admin-resolution"]').fill("Refunded; teacher warned.");
  await agentPage.locator('[data-testid="admin-move-resolved"]').click({ timeout: 10000 });
  await agentPage.waitForTimeout(3000);
  check("with one, it closes", sql(`select status from disputes where id = ${ticket.body.id}`) === "resolved",
    sql(`select status from disputes where id = ${ticket.body.id}`));
  check("and the decision is kept",
    /Refunded/.test(sql(`select coalesce(resolution,'') from disputes where id = ${ticket.body.id}`)));

  // Suspending, and the code that resets a password without an agent learning it.
  await agentPage.goto(`${siteUrl}/person/${subject.user.id}`, { waitUntil: "networkidle" });
  await agentPage.waitForTimeout(3000);
  await agentPage.locator('[data-testid="admin-issue-reset"]').click({ timeout: 10000 });
  await agentPage.waitForTimeout(2000);
  const shownCode = await agentPage.locator('[data-testid="admin-reset-code"]').innerText().catch(() => "");
  check("an agent can issue a reset code", /^\d{6}$/.test(shownCode.trim()), shownCode);
  check("and only its hash is stored",
    sql(`select code_hash from password_resets where user_id=${subject.user.id} order by id desc limit 1`) !== shownCode.trim());

  await agentPage.locator('[data-testid="admin-suspend-reason"]').fill("Did not turn up twice.");
  await agentPage.locator('[data-testid="admin-suspend"]').click({ timeout: 10000 });
  await agentPage.waitForTimeout(3000);
  check("an account can be suspended from the screen",
    sql(`select suspended_at is not null from users where id=${subject.user.id}`) === "t",
    sql(`select coalesce(suspended_reason,'') from users where id=${subject.user.id}`));

  const lockedOut = await api("/auth/login", { method: "POST", body: {
    email: subject.email, password: "password123" } });
  check("and they can no longer sign in", lockedOut.status === 403, `status ${lockedOut.status}`);

  await agentCtx.close();

  // A teacher who types the address is sent back where they belong.
  const nosyCtx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const nosyPage = await nosyCtx.newPage();
  await nosyPage.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);
  await nosyPage.goto(`${siteUrl}/activity`, { waitUntil: "networkidle" });
  await nosyPage.waitForTimeout(4000);
  const nosyText = await nosyPage.evaluate(() => document.body.innerText);
  check("a teacher typing the support desk's address is bounced out of it",
    !/admin\.|Filter by action/i.test(nosyText), nosyText.slice(0, 200).replace(/\n/g, " | "));
  await nosyCtx.close();

  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
