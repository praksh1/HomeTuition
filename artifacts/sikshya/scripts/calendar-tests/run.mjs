/**
 * The Nepali calendar, through the screens people actually use.
 *
 * The conversion is unit-tested; this is about whether a Nepali teacher can schedule a class
 * without converting a date in their head, and whether a student sees the date they recognise.
 * Those are the two things the feature exists for and neither is visible from a unit test.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/calendar-tests/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.CAL_SITE_PORT ?? 8096);
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
  const email = `cal_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
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

const text = (page) => page.evaluate(() => document.body.innerText);

async function open(browser, token, route) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { await d.accept(); });
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), token);
  await page.goto(`${siteUrl}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  return { ctx, page };
}

async function main() {
  await waitForSite();
  const chromium = await getChromium();
  const browser = await chromium.launch();

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);
  const student = await register("student");

  console.log("\nA teacher schedules a class in their own calendar");

  {
    const { ctx, page } = await open(browser, teacher.token, "/session-create");

    check("the date field offers a calendar rather than a Gregorian box",
      (await page.locator('[data-testid="session-date-btn"]').count()) > 0,
      (await text(page)).slice(0, 300).replace(/\n/g, " | "));

    await page.locator('[data-testid="session-date-btn"]').click({ timeout: 15000 });
    await page.waitForTimeout(1200);

    check("a Bikram Sambat calendar opens",
      (await page.locator('[data-testid="nepali-date-picker"]').count()) > 0);

    const monthLabel = await page.locator('[data-testid="bs-month-label"]').innerText();
    check("its month is a Nepali one, not a Gregorian one",
      /Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/.test(monthLabel),
      monthLabel);
    check("and its year is in the 2080s, not the 2020s",
      /20[89]\d/.test(monthLabel), monthLabel);

    /**
     * Bikram Sambat months are 29 to 32 days, which is the whole reason a table is needed. A
     * grid that always drew 30 or 31 would be wrong for most of the year.
     */
    const dayCount = await page.locator('[data-testid^="bs-day-"]').count();
    check("the month has a real Bikram Sambat length", dayCount >= 29 && dayCount <= 32, `days=${dayCount}`);

    await page.locator('[data-testid="bs-next-month"]').click({ timeout: 10000 });
    await page.waitForTimeout(800);
    const nextLabel = await page.locator('[data-testid="bs-month-label"]').innerText();
    check("it can be paged forward a month", nextLabel !== monthLabel, `${monthLabel} -> ${nextLabel}`);

    // Pick a day well clear of today so nothing is disabled.
    await page.locator('[data-testid="bs-day-20"]').click({ timeout: 10000 });
    await page.waitForTimeout(600);
    const echo = await page.locator('[data-testid="bs-picked-echo"]').innerText();
    check("the Gregorian date is shown alongside, so nothing is hidden",
      /20\d\d/.test(echo) && !/Bhadra|Baisakh/.test(echo), echo);

    await page.locator('[data-testid="bs-confirm"]').click({ timeout: 10000 });
    await page.waitForTimeout(1200);

    const chosen = await page.locator('[data-testid="session-date-btn"]').innerText();
    check("and the form now shows the Nepali date",
      /Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/.test(chosen),
      chosen);

    await ctx.close();
  }

  console.log("\nA student reads a class date");

  {
    const session = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "Nepali dates", subject: "Mathematics", description: "d",
      date: new Date(Date.now() + 9 * 24 * 3600_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    check("a class exists to look at", session.status <= 201, `status=${session.status}`);
    await api(`/sessions/${session.body.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

    const { ctx, page } = await open(browser, student.token, `/session/${session.body.id}`);
    const body = await text(page);

    /**
     * The order matters, not just the presence.
     *
     * This page shows both calendars, so "does a Nepali month appear" is true whichever one the
     * reader prefers — a weak assertion that passed even with the default set back to Gregorian.
     * What it should say is that the reader's own calendar leads.
     */
    const bsMonth = /Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/;
    const clock = body.slice(body.indexOf("Class details"));
    const bsAt = clock.search(bsMonth);
    const MONTH = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
    const adAt = clock.search(new RegExp(`(\\b\\d{1,2} ${MONTH} 20\\d\\d|${MONTH} \\d{1,2}, 20\\d\\d)`));

    check("the class page shows a Nepali month", bsAt >= 0, clock.slice(0, 300).replace(/\n/g, " | "));
    check("and a Bikram Sambat year", /20[89]\d/.test(clock), clock.slice(0, 300).replace(/\n/g, " | "));
    check("with the Gregorian date beside it, for anyone who needs it",
      adAt >= 0, clock.slice(0, 300).replace(/\n/g, " | "));
    check("and the Nepali one leads, because that is the default here",
      bsAt >= 0 && adAt >= 0 && bsAt < adAt, `bs@${bsAt} ad@${adAt} — ${clock.slice(0, 200).replace(/\n/g, " | ")}`);

    await ctx.close();
  }

  console.log("\nAnybody who prefers Gregorian can have it back");

  {
    const { ctx, page } = await open(browser, student.token, "/notification-settings");
    check("the calendar setting is on the settings screen",
      (await page.locator('[data-testid="date-system-setting"]').count()) > 0,
      (await text(page)).slice(0, 300).replace(/\n/g, " | "));

    await page.locator('[data-testid="date-system-ad"]').click({ timeout: 15000 });
    await page.waitForTimeout(1500);

    await page.goto(`${siteUrl}/(student)/sessions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    const listed = await text(page);
    check("the class list switches to Gregorian",
      !/Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/.test(listed),
      listed.slice(0, 400).replace(/\n/g, " | "));

    /** The choice is on the device, so it has to survive the page being reloaded. */
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const afterReload = await text(page);
    check("and the choice is remembered after a reload",
      !/Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/.test(afterReload),
      afterReload.slice(0, 400).replace(/\n/g, " | "));

    await ctx.close();
  }

  await browser.close();
  stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
