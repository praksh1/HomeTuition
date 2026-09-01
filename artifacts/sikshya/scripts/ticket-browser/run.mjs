/**
 * Following a request, in a real browser, on a phone-sized screen.
 *
 * The server suite (api-server/scripts/ticket-tests) proves the rules. This proves the screens
 * a person actually touches: that "My Requests" is reachable at all, that a status and a
 * ticket number appear on it, that an agent's decision arrives on the reporter's screen, and
 * that a note meant for other agents does not.
 *
 * Reachability is not a small thing to check. app/_layout.tsx bounces a signed-in student off
 * any screen that is not registered as shared, so a perfectly correct screen can be
 * unreachable — which is what happened to these two before this suite caught it.
 *
 * Usage: PGURL=... node scripts/ticket-browser/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PORT = Number(process.env.TICKET_SITE_PORT ?? 8098);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

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

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], { cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 40; i++) { try { if ((await fetch(siteUrl)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }

const stamp = Date.now();
const student = (await api("/auth/register", { method: "POST", body: {
  name: "Sita Sharma", email: `tkb_s_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(student.user.id);

const agentAccount = (await api("/auth/register", { method: "POST", body: {
  name: "Bina Karki", email: `tkb_a_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(agentAccount.user.id);
sql(`update users set role = 'admin' where id = ${agentAccount.user.id}`);
const agent = (await api("/auth/login", { method: "POST", body: { email: `tkb_a_${stamp}@example.com`, password: "password123" } })).body;

const filed = await api("/disputes", { method: "POST", token: student.token, body: {
  reason: "Payment Issue", description: "I paid for Tuesday's algebra class and it never showed up.",
} });
const ref = filed.body.ref;

const chromium = await getChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("dialog", async (d) => { await d.accept(); });
await page.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), student.token);

/*
 * Reached the way a person reaches it: from the Support tab, not by typing a URL.
 * A screen only a deep link can open is a screen nobody will find.
 */
await page.goto(`${siteUrl}/support`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
const supportBtn = page.locator('[data-testid="support-my-requests-btn"]');
check("Support has a way through to what you already sent", await supportBtn.count() > 0);
if (await supportBtn.count() > 0) { await supportBtn.first().click(); await page.waitForTimeout(3000); }

let body = await page.evaluate(() => document.body.innerText);
check("a student can open My Requests at all", /My Requests/i.test(body), body.slice(0, 300).replace(/\n/g, " | "));
check("the request is listed with its number", body.includes(ref), `ref=${ref} :: ${body.slice(0, 300).replace(/\n/g, " | ")}`);
check("and says where it has got to", /Request Created/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and how many more may be sent today", /2 more requests today/i.test(body), body.slice(0, 500).replace(/\n/g, " | "));

/* The trail. */
await page.locator(`[data-testid="request-row-${filed.body.id}"]`).first().click();
await page.waitForTimeout(3000);
body = await page.evaluate(() => document.body.innerText);
check("opening it shows the whole request", body.includes(ref) && /never showed up/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("with a line saying what the status means",
  /Nobody has picked it up yet/i.test(body), body.slice(0, 500).replace(/\n/g, " | "));
check("and the moment it was sent, in Bikram Sambat",
  /Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/.test(body),
  body.slice(0, 500).replace(/\n/g, " | "));

/*
 * Now the agent works it, through the same screens.
 */
const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const desk = await deskCtx.newPage();
desk.on("dialog", async (d) => { await d.accept(); });
await desk.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), agent.token);
/*
 * Checked by what is on the screen, not by the address.
 *
 * A route group is invisible in an expo-router URL — "/(admin)" *is* "/" — so an address
 * assertion here would be checking nothing. The queue's own filter chips are the honest test,
 * and they are absent from the welcome page an agent used to land on.
 */
await desk.goto(`${siteUrl}/desk`, { waitUntil: "networkidle" });
await desk.waitForTimeout(4000);
let deskBody = await desk.evaluate(() => document.body.innerText);
check("an agent bookmarking /desk lands on the queue",
  await desk.locator('[data-testid="admin-filter-active"]').count() > 0,
  deskBody.slice(0, 300).replace(/\n/g, " | "));
check("and not on the page for somebody with no account",
  !/Get started|Sign up|Find a teacher/i.test(deskBody), deskBody.slice(0, 300).replace(/\n/g, " | "));
check("the queue shows the request by its number", deskBody.includes(ref), deskBody.slice(0, 400).replace(/\n/g, " | "));

/*
 * And the bare address, which used to drop an agent on the marketing page while signed in.
 */
await desk.goto(`${siteUrl}/`, { waitUntil: "networkidle" });
await desk.waitForTimeout(4000);
const rootBody = await desk.evaluate(() => document.body.innerText);
check("and so does the bare address",
  await desk.locator('[data-testid="admin-filter-active"]').count() > 0,
  rootBody.slice(0, 300).replace(/\n/g, " | "));

/* The queue narrows, which is what the owner asked for on every crowded list in this app. */
await desk.locator('[data-testid="admin-whose-unassigned"]').first().click();
await desk.waitForTimeout(2500);
check("and it can be narrowed to what nobody has picked up",
  (await desk.evaluate(() => document.body.innerText)).includes(ref),
  (await desk.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | "));
await desk.locator('[data-testid="admin-whose-all"]').first().click();
await desk.waitForTimeout(2000);

await desk.goto(`${siteUrl}/(admin)/ticket/${filed.body.id}`, { waitUntil: "networkidle" });
await desk.waitForTimeout(3500);
deskBody = await desk.evaluate(() => document.body.innerText);
check("opening it at the desk records that a human looked",
  /Opened by an agent/i.test(deskBody), deskBody.slice(0, 400).replace(/\n/g, " | "));

// A note for other agents, then the decision for the reporter.
await desk.locator('[data-testid="admin-internal-toggle"]').first().click();
await desk.locator('[data-testid="admin-resolution"]').first().fill("Checked the ledger, this one is genuine.");
await desk.locator('[data-testid="admin-note"]').first().click();
await desk.waitForTimeout(2500);

await desk.locator('[data-testid="admin-resolution"]').first().fill("Refunded in full. It will reach you in 5-7 days.");
const resolveBtn = desk.locator('[data-testid="admin-move-resolved"]');
check("the desk offers the endings the rules allow", await resolveBtn.count() > 0);
await resolveBtn.first().click();
await desk.waitForTimeout(3000);

/*
 * Back to the reporter's screen. This is the whole point of the feature.
 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3500);
body = await page.evaluate(() => document.body.innerText);
check("the reporter sees the decision", /Refunded in full/.test(body), body.slice(0, 600).replace(/\n/g, " | "));
check("and that an agent read it before deciding", /Opened by an agent/i.test(body), body.slice(0, 600).replace(/\n/g, " | "));
/*
 * A human read it, but not which human: the team here is small enough that a full name is
 * enough to find somebody, and this person has just been told about money.
 */
check("without being handed the agent's name",
  !/Bina Karki/.test(body), body.slice(0, 700).replace(/\n/g, " | "));
check("but never the note the agents wrote to each other",
  !/Checked the ledger/.test(body), body.slice(0, 600).replace(/\n/g, " | "));
check("and can no longer withdraw it",
  await page.locator('[data-testid="request-withdraw-btn"]').count() === 0);

/*
 * The limit, met the way a person meets it.
 */
for (let i = 0; i < 2; i++) {
  await api("/disputes", { method: "POST", token: student.token, body: { reason: "Other", description: `Another thing ${i}` } });
}
const refused = await api("/disputes", { method: "POST", token: student.token, body: { reason: "Other", description: "One too many" } });
check("the fourth request of the day is refused", refused.status === 429, `status=${refused.status}`);

await page.goto(`${siteUrl}/requests`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
body = await page.evaluate(() => document.body.innerText);
check("and the list says so in words rather than a number",
  /24 hours|another in about|used all/i.test(body), body.slice(0, 700).replace(/\n/g, " | "));

/* A teacher is not an agent, and is told so rather than bounced. */
const teacher = (await api("/auth/register", { method: "POST", body: {
  name: "Ram Prasad", email: `tkb_t_${stamp}@example.com`, password: "password123", role: "teacher", subject: "Maths", bio: "x",
} })).body;
prepareBrowserAccount(teacher.user.id);
const tCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const tPage = await tCtx.newPage();
await tPage.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), teacher.token);
await tPage.goto(`${siteUrl}/desk`, { waitUntil: "networkidle" });
await tPage.waitForTimeout(3500);
const tBody = await tPage.evaluate(() => document.body.innerText);
check("a teacher who opens the desk is told why it is not for them",
  /customer-care agents/i.test(tBody), tBody.slice(0, 400).replace(/\n/g, " | "));

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
