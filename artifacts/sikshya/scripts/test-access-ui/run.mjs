/**
 * The three places a person is told nobody paid, rendered.
 *
 * A test enrolment that is invisible is worse than none: a teacher sees a class with a price on
 * it and a student sitting in it, and has every reason to believe they were paid. So the label is
 * checked where somebody would actually read it —
 *
 *   1. the operator's own screen, where a grant is given and ended;
 *   2. the class card in the student's list, beside the price it contradicts;
 *   3. the classroom itself, for the whole lesson, for both people in it.
 *
 * Needs a built app pointed at a running API with `ALLOW_TEST_STUDENT_ACCESS` on:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:test-access-ui
 *
 * A browser is not a phone. Everything here renders in headless Chromium; nothing in it is
 * evidence about iOS or Android hardware.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.TEST_ACCESS_UI_PORT ?? 8088);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

const VIEWPORTS = [
  { name: "laptop", width: 1280, height: 800 },
  { name: "narrow", width: 360, height: 740 },
];

let passed = 0, failed = 0;
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
async function register(role, name) {
  seq += 1;
  const email = `tui_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  prepareBrowserAccount(res.body.user.id);
  return { ...res.body, email, id: res.body.user.id };
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first:\n  pnpm --filter @workspace/sikshya run build");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
process.on("exit", () => { try { server.kill(); } catch { /* gone */ } });

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(siteUrl)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the static server never came up on ${siteUrl}`);
}

async function open(context, token, route, settleMs = 5000) {
  const page = await context.newPage();
  const crashes = [];
  const isCrash = (t) => /Minified React error|Something went wrong|is not a function|Cannot read (properties|property)/i.test(t);
  page.on("pageerror", (e) => crashes.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && isCrash(m.text())) crashes.push(m.text().slice(0, 200)); });
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), token);
  await page.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("blocked in tests"));
  });
  page.on("dialog", (d) => { void d.dismiss(); });
  await page.goto(`${siteUrl}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settleMs);
  return { page, crashes };
}

const textOf = (page) => page.evaluate(() => document.body.innerText || "");
const seen = (page, id) => page.locator(`[data-testid="${id}"], [testid="${id}"]`).count();

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  /* ---- the cast ---- */
  const agent = await register("student", "Desk Agent");
  sql(`update users set role = 'admin' where id = ${agent.id}`);
  const agentToken = (await api("/auth/login", { method: "POST",
    body: { email: agent.email, password: "password123" } })).body.token;

  const teacher = await register("teacher", "Test Teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.id}`);
  const granted = await api(`/admin/teachers/${teacher.id}/test-access`, { method: "POST", token: agentToken,
    body: { tier: "tier4", reason: "release-candidate walkthrough", days: 7 } });
  if (granted.status !== 201) throw new Error(`teaching grant: ${granted.status} ${JSON.stringify(granted.body)}`);

  const student = await register("student", "Test Student");
  const studentGrant = await api(`/admin/students/${student.id}/test-access`, { method: "POST", token: agentToken,
    body: { reason: "release-candidate walkthrough", days: 7 } });
  if (studentGrant.status !== 201) {
    throw new Error(`student grant: ${studentGrant.status} ${JSON.stringify(studentGrant.body)} — is ALLOW_TEST_STUDENT_ACCESS on?`);
  }

  // A class inside its own door, so the classroom actually opens.
  const cls = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Test class ${Date.now()}`, subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 120_000).toISOString(),
    duration: 60, price: 500, maxStudents: 5 } });
  const id = cls.body.id;
  const booked = await api(`/sessions/${id}/book`, { method: "POST", token: student.token,
    body: { paymentMethod: "esewa" } });
  if (booked.status !== 201) throw new Error(`book: ${booked.status} ${JSON.stringify(booked.body)}`);
  await api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  const chromium = await getChromium();
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    console.log(`\n  ${viewport.name} — ${viewport.width}×${viewport.height}\n`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });

    /* ---- the operator's own screen ---- */
    {
      const { page, crashes } = await open(context, agentToken, `/(admin)/person/${student.id}`);
      check(`[${viewport.name}] the operator's person screen opens`, crashes.length === 0, crashes[0] ?? "");
      const text = await textOf(page);
      check(`[${viewport.name}] it offers test booking access`, /Test booking access/i.test(text), text.slice(0, 300));
      check(`[${viewport.name}] and shows the live grant with its end date`,
        (await seen(page, "admin-student-test-active")) > 0);
      check(`[${viewport.name}] with the operator's own reason`,
        /release-candidate walkthrough/i.test(text));
      check(`[${viewport.name}] and an obvious way to end it`,
        (await seen(page, "admin-revoke-student-test")) > 0);
      check(`[${viewport.name}] it says plainly that nothing is recorded as revenue`,
        /nothing is recorded as revenue|no refund can be claimed/i.test(text), text.slice(0, 600));
      await page.close();
    }

    /* ---- a teacher's record does not offer it ---- */
    {
      const { page } = await open(context, agentToken, `/(admin)/person/${teacher.id}`);
      const text = await textOf(page);
      check(`[${viewport.name}] a teacher is offered teaching access, not booking access`,
        /Test teaching access/i.test(text) && !/Test booking access/i.test(text), text.slice(0, 400));
      await page.close();
    }

    /* ---- the student's own list ---- */
    {
      const { page, crashes } = await open(context, student.token, "/(student)/sessions");
      check(`[${viewport.name}] the student's list opens`, crashes.length === 0, crashes[0] ?? "");
      check(`[${viewport.name}] the class is labelled on its own card`,
        (await seen(page, `session-test-label-${id}`)) > 0);
      const text = await textOf(page);
      check(`[${viewport.name}] in words, next to the price it contradicts`,
        /TEST\s*—\s*no payment was processed/i.test(text), text.slice(0, 400));
      await page.close();
    }

    /* ---- the classroom, for both people in it ---- */
    for (const who of [
      { name: "student", token: student.token, route: `/(student)/classroom/${id}` },
      { name: "teacher", token: teacher.token, route: `/(teacher)/classroom/${id}` },
    ]) {
      const { page, crashes } = await open(context, who.token, who.route, 6000);
      check(`[${viewport.name}/${who.name}] the classroom opens`, crashes.length === 0, crashes[0] ?? "");
      check(`[${viewport.name}/${who.name}] and says so for the whole lesson`,
        (await seen(page, "classroom-test-banner")) > 0);
      const text = await textOf(page);
      check(`[${viewport.name}/${who.name}] in the same words everywhere else uses`,
        /TEST\s*—\s*no payment was processed/i.test(text), text.slice(0, 400));
      await page.close();
    }

    await context.close();
  }

  await browser.close();
  try { server.kill(); } catch { /* gone */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); try { server.kill(); } catch { /* gone */ } process.exit(1); });
