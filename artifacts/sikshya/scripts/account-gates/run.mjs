/**
 * The gates in front of money, and the words an operator reads, in a real browser.
 *
 * Two things here can only be checked by rendering. The subscription screen's lock is a *visual*
 * contract — the tiers have to look unavailable and the payment sheet must not open — and the
 * operator's confirmation is a `window.alert`, which no server test can see.
 *
 * Both were shipped once with "not verified in a browser" against them, on the belief that this
 * container had no Chromium. It has one; the pinned Playwright build simply did not match, and
 * `board-tests/harness.mjs` now falls back to whatever browser is on the machine.
 *
 * Rendering earned its place immediately: it found that a teacher passes **two** gates before the
 * subscription screen — email verification, then profile onboarding — so the lock this suite
 * exists to test is only reachable by a teacher who is verified and onboarded but still waiting on
 * an operator. No server test would have noticed; both earlier attempts here landed on an
 * onboarding screen and reported a missing lock that was simply never rendered.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   PGURL=... API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:gates
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PG = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/shots";

const sql = (s) => execFileSync("psql", [PG, "-tAc", s], { encoding: "utf8" }).trim();
mkdirSync(SHOTS, { recursive: true });

const serve = spawn("npx", ["-y", "serve", "-s", "web-build", "-l", "4173"], {
  cwd: appRoot,
  stdio: "ignore",
});
process.on("exit", () => serve.kill("SIGKILL"));

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * Past both onboarding gates — verified email and a completed profile — but nothing more.
 *
 * Without this the app redirects to "Verify your email", then to "Complete your profile", and the
 * screen under test never renders.
 */
function clearOnboarding(userId) {
  sql(`update account_security set email_verified_at = now() where user_id = ${userId}`);
  sql(`insert into user_onboarding (user_id, phone, province, district, local_level, completed_at)
       values (${userId}, '9800000000', 'Bagmati', 'Kathmandu', 'Kathmandu', now())
       on conflict (user_id) do update set completed_at = now(), phone = '9800000000',
         province = 'Bagmati', district = 'Kathmandu', local_level = 'Kathmandu'`);
}

let seq = 0;
async function makeTeacher(name) {
  seq += 1;
  const email = `gate_${Date.now()}_${seq}@example.com`;
  const r = await api("/auth/register", { method: "POST", body: {
    name, email, password: "password123", role: "teacher", subject: "Maths", bio: "x" } });
  if (r.status > 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.body)}`);
  return { ...r.body, email, id: Number(sql(`select id from users where email='${email}'`)) };
}

for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch("http://127.0.0.1:4173/")).ok) break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 500));
}

const chromium = await getChromium();
const browser = await chromium.launch();

async function signedInPage(token, user, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("@sikshya_token", t);
    localStorage.setItem("@sikshya_user", JSON.stringify(u));
  }, [token, user]);
  const page = await ctx.newPage();
  // `notify()` is a window.alert on web. Playwright dismisses dialogs by default and the text
  // never reaches the DOM, so the operator's confirmation is invisible unless it is captured here.
  page.alerts = [];
  page.on("dialog", async (d) => { page.alerts.push(d.message()); await d.accept(); });
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 140)));
  return page;
}

console.log("\nA pending teacher cannot reach payment\n");
{
  const t = await makeTeacher("Pending Prakash");
  // Verified and onboarded, but still awaiting operator approval: the case the lock exists for.
  clearOnboarding(t.id);
  const page = await signedInPage(t.token, { ...t.user, emailVerified: true });
  await page.goto("http://127.0.0.1:4173/(teacher)/subscription", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const body = await page.locator("body").innerText();
  check("the lock notice is shown to a pending teacher",
    /must approve your teacher account/i.test(body), body.slice(0, 160).replace(/\n/g, " "));
  check("it names the account decision, not the documents",
    /teacher account/i.test(body) && !/documents must be approved/i.test(body));
  check("the pay button reads as locked", /Payment locked/i.test(body));

  // The contract that matters: tapping through must not open the sheet that asks for a PIN.
  await page.getByText("Tier 2", { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
  await page.getByText(/Payment locked/i).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const sheet = await page.getByText(/eSewa ID|Khalti ID|MPIN/i).count();
  check("tapping a locked tier and pay does not open the payment sheet", sheet === 0, `matches=${sheet}`);

  await page.screenshot({ path: `${SHOTS}/pending-locked.png`, fullPage: true });
  await page.close();
}

console.log("\nAn approved, verified teacher can choose a tier\n");
{
  const t = await makeTeacher("Approved Anita");
  clearOnboarding(t.id);
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${t.id}`);
  const page = await signedInPage(t.token, { ...t.user, approvalStatus: "approved", emailVerified: true });
  await page.goto("http://127.0.0.1:4173/(teacher)/subscription", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const body = await page.locator("body").innerText();
  check("the pay button is live", /Pay NPR/i.test(body) && !/Payment locked/i.test(body));
  check("and no lock notice is shown", !/must approve your teacher account/i.test(body));
  await page.screenshot({ path: `${SHOTS}/approved-unlocked.png`, fullPage: true });
  await page.close();
}

console.log("\nThe operator confirmation tells the truth\n");
{
  const teacher = await makeTeacher("Reviewed Rita");
  sql(`update account_security set email_verified_at = now() where user_id = ${teacher.id}`);
  sql(`insert into teacher_credentials (teacher_id, document_type, file_key, original_name, content_type, status)
       values (${teacher.id}, 'citizenship', 'k', 'citizenship.jpg', 'image/jpeg', 'submitted')`);

  // An agent is made in the database, never through the app. The role travels in the token, so
  // the promotion has to be followed by a fresh sign-in.
  const agentEmail = `gate_agent_${Date.now()}@example.com`;
  await api("/auth/register", { method: "POST", body: {
    name: "Agent A", email: agentEmail, password: "password123", role: "student",
    grade: "10", dateOfBirth: "2000-01-01" } });
  sql(`update users set role='admin' where email='${agentEmail}'`);
  const login = await api("/auth/login", { method: "POST", body: { email: agentEmail, password: "password123" } });

  const page = await signedInPage(login.body.token, login.body.user, 1280);
  await page.goto(`http://127.0.0.1:4173/(admin)/person/${teacher.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByText("Approve document", { exact: false }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  const alert = page.alerts[0] ?? "";
  console.log(`    operator saw: ${JSON.stringify(alert)}`);
  check("it says document review, not approval of the person", /Document review saved/i.test(alert), alert);
  check("it does not say 'They have been told'", !/They have been told/i.test(alert));
  check("it states plainly that the teacher was not notified", /has NOT been notified/i.test(alert), alert);
  check("and never promises a notification on next open", !/next open|will see it/i.test(alert), alert);

  await page.screenshot({ path: `${SHOTS}/operator-decision.png`, fullPage: true });
  await page.close();
}

await browser.close();
serve.kill("SIGKILL");
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
