/**
 * Starting a conversation, in the real app, against a real server.
 *
 * Reported from a real account: "Teacher cannot start a message! Teacher should be able to
 * message to Students who have subscribed to him/her." The Messages screen listed conversations
 * and offered no way to begin one, so a teacher could only ever reply to a student who had
 * written first — and the owner's case for wanting it is the obvious one: a teacher who
 * schedules a class wants to tell the students most likely to take it.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:messaging
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.MESSAGING_TEST_PORT ?? 8091);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";
const sql = (statement) => execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" }).trim();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

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
async function register(role, name) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name, email: `msg_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
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

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const teacher = await register("teacher", "Ram Prasad Sharma");
  const follower = await register("student", "Sita Gurung");
  const stranger = await register("student", "Nobody Unrelated");

  // The relationship the owner named: a student who subscribed to this teacher. Follow takes
  // the teacher *profile* id, which is not the same number as their user id — the two coincide
  // only for the first teacher ever registered, which is exactly long enough to mislead you.
  // Read from the database rather than the browse list, which shows approved teachers only.
  const profileId = sql(`select id from teacher_profiles where user_id = ${teacher.user.id}`);
  const follow = await api(`/teachers/${profileId}/follow`, { method: "POST", token: follower.token });
  if (follow.status > 201) throw new Error(`follow failed: ${follow.status} ${JSON.stringify(follow.body)}`);

  console.log("\nWho a teacher may write to");
  const list = await api("/message-recipients", { token: teacher.token });
  const names = (list.body ?? []).map((p) => p.name);
  check("the student who follows them is on the list", names.includes("Sita Gurung"), JSON.stringify(names));
  check("an unrelated student is not", !names.includes("Nobody Unrelated"), JSON.stringify(names));

  // The student's own view of the same relationship, since one screen serves both.
  const back = await api("/message-recipients", { token: follower.token });
  check("and the student can write to the teacher they follow",
    (back.body ?? []).some((p) => p.name === "Ram Prasad Sharma"),
    JSON.stringify((back.body ?? []).map((p) => p.name)));

  const browser = await (await getChromium()).launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);

  console.log("\nA teacher writes to a student who has never written to them");
  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.click('a[role="tab"][href="/messages"]', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const newButton = page.getByTestId("new-message-button").first();
  check("there is a way to start one at all", (await newButton.count()) > 0);
  await newButton.click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  check("it opens the picker", (await page.evaluate(() => location.pathname)) === "/new-message",
    await page.evaluate(() => location.pathname));

  const row = page.getByTestId(`recipient-${follower.user.id}`).first();
  check("the student is offered", (await row.count()) > 0,
    await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, " | ")));

  // The search the rest of the app uses: spacing carries no meaning in a name.
  await page.getByTestId("recipient-search").fill("si ta");
  await page.waitForTimeout(600);
  check("searching finds them however the name is spaced",
    (await page.getByTestId(`recipient-${follower.user.id}`).count()) > 0);
  await page.getByTestId("recipient-search").fill("");
  await page.waitForTimeout(400);

  await row.click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  check("tapping them opens the conversation",
    /\/conversation\//.test(await page.evaluate(() => location.pathname)),
    await page.evaluate(() => location.pathname));

  await page.getByTestId("conversation-input").fill("I have scheduled a new class on Friday. Please join.");
  await page.waitForTimeout(300);
  await page.getByTestId("conversation-send-btn").click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  const received = await api(`/messages/${teacher.user.id}`, { token: follower.token });
  const bodies = (received.body ?? []).map((m) => m.body);
  check("the message reaches the student", bodies.some((b) => /scheduled a new class/.test(b)),
    JSON.stringify(bodies));
  check("no errors were thrown", errors.length === 0, errors[0] ?? "");

  await ctx.close();
  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
