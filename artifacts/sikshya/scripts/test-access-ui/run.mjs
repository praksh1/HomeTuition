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
  /**
   * Dialogs are dismissed, but their words are kept.
   *
   * `confirm()` is `window.confirm` on web, so a confirmation never reaches `document.body`.
   * Dismissing it without reading it is how a suite can watch a booking succeed and never notice
   * that the sentence announcing it names a payment method nobody used.
   */
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.goto(`${siteUrl}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settleMs);
  return { page, crashes, dialogs };
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

  /*
    An ordinary student who genuinely paid for a seat in the same test class, and one who has not
    booked at all. Between them they are the two people the one-flag model told a falsehood to:
    the payer was shown "no payment was processed" in the classroom, and the browser was shown it
    on the card *before* being charged.
  */
  const payer = await register("student", "Paying Student");
  sql(`insert into session_enrollments (session_id, student_id, payment_status, payment_method, payment_reference)
       values (${id}, ${payer.id}, 'paid', 'esewa', 'REAL-UI-1')`);

  /**
   * A fresh unbooked class and a fresh eligible student, per viewport.
   *
   * They cannot be shared across the two runs: the laptop pass presses Book and succeeds, so the
   * narrow pass would find the same student already enrolled and the button replaced by "Booked".
   * That is what happened, and it read as "the button is missing on a phone" — a fixture leak
   * wearing the costume of a layout bug.
   */
  const freshBookingFixture = async (label) => {
    const spare = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: `Spare test class ${label} ${Date.now()}`, subject: "Mathematics", description: "d",
      date: new Date(Date.now() + 90 * 60_000).toISOString(),
      duration: 60, price: 500, maxStudents: 5 } });
    if (spare.status > 201) throw new Error(`spare class: ${JSON.stringify(spare.body)}`);
    const eligibleStudent = await register("student", `Eligible ${label}`);
    const granted = await api(`/admin/students/${eligibleStudent.id}/test-access`, { method: "POST",
      token: agentToken, body: { reason: "release-candidate walkthrough", days: 7 } });
    if (granted.status !== 201) throw new Error(`grant: ${JSON.stringify(granted.body)}`);
    return { spareId: spare.body.id, eligibleStudent, shopper: await register("student", `Browsing ${label}`) };
  };

  /**
   * The profile id, not the user id — `/(student)/teacher/:id` routes on `teacher_profiles.id`.
   *
   * See `.agents/memory/teacher-id-convention.md`. Getting this wrong renders an empty page and
   * every check on it fails with no message, which is exactly how it failed the first time.
   */
  const teacherProfileId = Number(sql(`select id from teacher_profiles where user_id = ${teacher.id}`));

  await api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  const chromium = await getChromium();
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    console.log(`\n  ${viewport.name} — ${viewport.width}×${viewport.height}\n`);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const { spareId, eligibleStudent, shopper } = await freshBookingFixture(viewport.name);

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

    /* ---- the student's own list: their own place, not the class ---- */
    {
      const { page, crashes } = await open(context, student.token, "/(student)/sessions");
      check(`[${viewport.name}] the student's list opens`, crashes.length === 0, crashes[0] ?? "");
      check(`[${viewport.name}] their own place is labelled as taking no payment`,
        (await seen(page, `session-test-booking-${id}`)) > 0);
      const text = await textOf(page);
      check(`[${viewport.name}] in words, next to the price it contradicts`,
        /TEST\s*—\s*no payment was processed/i.test(text), text.slice(0, 400));
      await page.close();
    }

    /* ---- the student who actually paid, in the same class ---- */
    /*
      One flag for two facts told this person their money had not been taken — on the card in
      their own list, and on a banner across the classroom they had paid to be in.
    */
    {
      const { page, crashes } = await open(context, payer.token, "/(student)/sessions");
      check(`[${viewport.name}] the paying student's list opens`, crashes.length === 0, crashes[0] ?? "");
      const text = await textOf(page);
      check(`[${viewport.name}] a student who paid is never told no payment was processed`,
        !/no payment was processed/i.test(text), text.slice(0, 500));
      check(`[${viewport.name}] and is not shown the class's test-enabled marker either`,
        !/test-enabled/i.test(text), text.slice(0, 500));
      check(`[${viewport.name}] no test label of any kind on their card`,
        (await seen(page, `session-test-booking-${id}`)) === 0 &&
          (await seen(page, `session-test-class-${id}`)) === 0);
      await page.close();
    }

    {
      const { page, crashes } = await open(context, payer.token, `/(student)/classroom/${id}`, 6000);
      check(`[${viewport.name}] the paying student's classroom opens`, crashes.length === 0, crashes[0] ?? "");
      check(`[${viewport.name}] with no false no-payment banner over it`,
        (await seen(page, "classroom-test-booking")) === 0);
      check(`[${viewport.name}] and no test wording of any kind aimed at them`,
        (await seen(page, "classroom-test-class")) === 0);
      const text = await textOf(page);
      check(`[${viewport.name}] and nothing on screen says their payment did not happen`,
        !/no payment was processed/i.test(text) && !/test-enabled/i.test(text), text.slice(0, 600));
      await page.close();
    }

    /* ---- the Book button, for the two kinds of student, on the same class ---- */
    /*
      The server had been bypassing the gateway *behind* a payment sheet: the student chose a
      method, typed a phone number and a PIN, and no payment was ever attempted. The walkthrough
      handed to the owner said no payment screen would appear.
    */
    {
      const { page, crashes, dialogs } = await open(context, eligibleStudent.token,
        `/(student)/teacher/${teacherProfileId}`, 7000);
      check(`[${viewport.name}] the teacher's profile opens for an eligible student`,
        crashes.length === 0, crashes[0] ?? "");
      // The page opens on Live when a class is running; the class being booked here is upcoming.
      const upcomingTab = page
        .locator('[data-testid="session-tab-upcoming"], [testid="session-tab-upcoming"]').first();
      await upcomingTab.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await upcomingTab.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // The button is below the fold on a phone-sized window; bring it into view before pressing.
      await page.locator(`[data-testid="book-btn-${spareId}"], [testid="book-btn-${spareId}"]`)
        .first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      const text = await textOf(page);
      check(`[${viewport.name}] the button offers a test place rather than a payment`,
        /Take a test place — no payment/i.test(text), text.slice(0, 800));
      check(`[${viewport.name}] and does not offer to charge them`,
        !/Book & pay NPR/i.test(text), text.slice(0, 800));

      const btn = page.locator(`[data-testid="book-btn-${spareId}"], [testid="book-btn-${spareId}"]`).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const after = await textOf(page);
        const said = `${after}\n${dialogs.join("\n")}`;
        check(`[${viewport.name}] pressing it opens no payment sheet`,
          !/eSewa|Khalti|PIN/i.test(said), said.slice(0, 600));
        check(`[${viewport.name}] and the confirmation says no payment was taken`,
          /no payment was taken|no payment was processed/i.test(said), said.slice(0, 700));
        check(`[${viewport.name}] and never names a payment method`,
          !/Paid with/i.test(said), said.slice(0, 700));
      } else {
        check(`[${viewport.name}] the eligible student's Book button is on screen`, false, "not found");
      }
      await page.close();
    }

    {
      const { page } = await open(context, shopper.token, `/(student)/teacher/${teacherProfileId}`, 7000);
      const tab = page
        .locator('[data-testid="session-tab-upcoming"], [testid="session-tab-upcoming"]').first();
      await tab.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await tab.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.locator(`[data-testid="book-btn-${spareId}"], [testid="book-btn-${spareId}"]`)
        .first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      const text = await textOf(page);
      check(`[${viewport.name}] an ordinary student is still offered the normal paid booking`,
        /Book & pay NPR/i.test(text), text.slice(0, 800));
      check(`[${viewport.name}] and is never promised a free place`,
        !/no payment/i.test(text), text.slice(0, 800));

      const btn = page.locator(`[data-testid="book-btn-${spareId}"], [testid="book-btn-${spareId}"]`).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const after = await textOf(page);
        check(`[${viewport.name}] pressing it opens the normal payment sheet`,
          /eSewa|Khalti/i.test(after), after.slice(0, 600));
      } else {
        check(`[${viewport.name}] the ordinary student's Book button is on screen`, false, "not found");
      }
      await page.close();
    }

    /* ---- the classroom, for both people in it ---- */

    /* ---- the teacher's own list, where the price sits ---- */
    /*
      The label used to hang off the viewer's enrolment alone, so only the student ever saw it.
      The teacher's list showed "NPR 500 per class" against a class that had never taken a rupee
      and never would — a teacher adding up their month from this screen counts money that does
      not exist. The card now reads the class's own fact, which the server sends with every row.
    */
    {
      const { page, crashes } = await open(context, teacher.token, "/(teacher)/sessions");
      check(`[${viewport.name}] the teacher's list opens`, crashes.length === 0, crashes[0] ?? "");
      check(`[${viewport.name}] the teacher sees their class is test-enabled`,
        (await seen(page, `session-test-class-${id}`)) > 0);
      const text = await textOf(page);
      check(`[${viewport.name}] in words that claim nothing about anybody's payment`,
        /TEST-ENABLED CLASS/i.test(text) && !/no payment was processed/i.test(text),
        text.slice(0, 600));
      await page.close();
    }

    /* ---- the classroom, for both people in it ---- */
    for (const who of [
      { name: "student", token: student.token, route: `/(student)/classroom/${id}` },
      { name: "teacher", token: teacher.token, route: `/(teacher)/classroom/${id}` },
    ]) {
      const { page, crashes } = await open(context, who.token, who.route, 6000);
      check(`[${viewport.name}/${who.name}] the classroom opens`, crashes.length === 0, crashes[0] ?? "");
      // The student holds a granted place, so they are told no payment was taken. The teacher
      // did not book anything, so they are told what is true of the class instead.
      const expected = who.name === "student" ? "classroom-test-booking" : "classroom-test-class";
      check(`[${viewport.name}/${who.name}] and says so for the whole lesson`,
        (await seen(page, expected)) > 0, expected);
      const text = await textOf(page);
      check(`[${viewport.name}/${who.name}] in the sentence that is true for them`,
        who.name === "student"
          ? /TEST\s*—\s*no payment was processed/i.test(text)
          : /TEST-ENABLED CLASS/i.test(text) && !/no payment was processed/i.test(text),
        text.slice(0, 500));
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
