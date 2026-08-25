/**
 * The monthly tier through the screens somebody actually taps.
 *
 * Everything under it is tested — the money, the classes, the portal — and none of that says
 * whether a teacher can find the plan, or whether the price a student is shown is the price
 * they are charged. Those are the two things this exists for, and neither is visible from a
 * unit test or an API suite.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/monthly-browser/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.MONTHLY_SITE_PORT ?? 8098);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

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
  const t = await res.text();
  let parsed = null;
  try { parsed = t ? JSON.parse(t) : null; } catch { parsed = { raw: t }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const email = `mb_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first: pnpm --filter @workspace/sikshya run build");
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

/**
 * Pays, the way a person does: a number, a PIN, and the button.
 *
 * The same sheet every other purchase in the app uses. Driving it rather than calling the API
 * is the point — a screen that opens the wrong sheet, or whose button does nothing, passes
 * every test that skips this.
 */
async function payThrough(page) {
  await page.locator('[data-testid="pay-mobile"]').fill("9800000000");
  await page.locator('[data-testid="pay-pin"]').fill("1234");
  await page.waitForTimeout(300);
  await page.locator('[data-testid="pay-confirm"]').click({ timeout: 15000 });
  await page.waitForTimeout(5000);
}

async function main() {
  await waitForSite();
  const chromium = await getChromium();
  const browser = await chromium.launch();

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);

  console.log("\nA teacher finds the monthly plan and buys it");
  {
    const { ctx, page } = await open(browser, teacher.token, "/(teacher)");
    check("the dashboard offers a monthly class",
      (await page.locator('[data-testid="teacher-monthly-entry"]').count()) > 0,
      (await text(page)).slice(0, 260).replace(/\n/g, " | "));

    await page.locator('[data-testid="teacher-monthly-entry"]').click({ timeout: 15000 });
    await page.locator('[data-testid="monthly-buy"]').waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(400);

    const body = await text(page);
    check("the price is on the screen, not buried", /6,?500/.test(body), body.slice(0, 300).replace(/\n/g, " | "));
    check("and it says when the month starts", /starts when you set up/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("and what happens if they teach too few", /25 classes/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));

    await page.locator('[data-testid="monthly-buy"]').click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const paying = await text(page);
    check("the usual payment sheet opens", /eSewa|Khalti/i.test(paying), paying.slice(0, 300).replace(/\n/g, " | "));

    await payThrough(page);
    const bought = Number(sql(`select count(*) from teacher_plans where teacher_id = ${teacher.user.id}`));
    check("the plan is bought", bought === 1, `${bought} plans`);

    const after = await text(page);
    check("and the screen moves on to setting up the class", /Set up your class/i.test(after), after.slice(0, 300).replace(/\n/g, " | "));
    await ctx.close();
  }

  console.log("\nAnd sets up the class");
  {
    const { ctx, page } = await open(browser, teacher.token, "/(teacher)/monthly");

    await page.locator('[data-testid="monthly-subject"]').fill("Mathematics");
    await page.locator('[data-testid="monthly-topic"]').fill("Algebra for Grade 10");
    await page.locator('[data-testid="monthly-time"]').fill("16:00");
    await page.locator('[data-testid="monthly-fee"]').fill("3000");
    await page.waitForTimeout(400);
    await page.locator('[data-testid="monthly-create"]').click({ timeout: 15000 });
    await page.waitForTimeout(4000);

    const klass = sql(`select id, start_minute, monthly_price from recurring_sessions
                       where teacher_id = ${teacher.user.id}`).split("|");
    check("the class is created", klass[0] !== "", `row "${klass.join("|")}"`);
    check("at the time they typed, not midnight", Number(klass[1]) === 16 * 60, `start_minute ${klass[1]}`);
    check("with the fee they typed", Number(klass[2]) === 3000, `price ${klass[2]}`);

    const shown = await text(page);
    check("and the screen now shows the class", /Mathematics/.test(shown), shown.slice(0, 300).replace(/\n/g, " | "));
    check("with the time on a clock a teacher reads", /16:00/.test(shown), shown.slice(0, 400).replace(/\n/g, " | "));
    check("and how many more classes they owe their students",
      /more class|taught enough/i.test(shown), shown.slice(0, 500).replace(/\n/g, " | "));
    await ctx.close();
  }

  const classId = Number(sql(`select id from recurring_sessions where teacher_id = ${teacher.user.id}`));

  /**
   * Winds the month on, so what a student owes stops being the same number as a full month.
   *
   * Without this the student joins a class created moments ago, every class is still to come,
   * and the pro-rated price *is* the monthly price — so a screen showing either passes. Putting
   * the full month on the button instead of what is owed went unnoticed exactly that way.
   *
   * Two hops, both far longer than the month the classes span: one shift of twenty days lands
   * rows on instants their own neighbours still hold, which the unique index refuses.
   */
  function ageClassByDays(days) {
    const planId = Number(sql(`select plan_id from recurring_sessions where id = ${classId}`));
    sql(`update teacher_plans set cycle_anchor = cycle_anchor - interval '${days} days' where id = ${planId}`);
    sql(`update recurring_days set scheduled_for = scheduled_for - interval '4000 days' where recurring_id = ${classId}`);
    sql(`update recurring_days set scheduled_for = scheduled_for + interval '${4000 - days} days' where recurring_id = ${classId}`);
  }

  console.log("\nA student finds it and sees what it costs");
  const student = await register("student");
  {
    ageClassByDays(20);
    const quotedNow = (await api(`/monthly/classes/${classId}`)).body?.class?.quote?.amount;
    const monthly = Number(sql(`select monthly_price from recurring_sessions where id = ${classId}`));
    check("setup: the month is part-way through, so the two prices differ",
      quotedNow > 0 && quotedNow !== monthly, `owed ${quotedNow}, a month is ${monthly}`);

    const { ctx, page } = await open(browser, student.token, "/(student)");
    check("Discover offers monthly classes",
      (await page.locator('[data-testid="student-monthly-entry"]').count()) > 0,
      (await text(page)).slice(0, 260).replace(/\n/g, " | "));

    await page.locator('[data-testid="student-monthly-entry"]').click({ timeout: 15000 });

    /*
     * Waited for, not slept through.
     *
     * A fixed pause read the Discover screen instead — and "the class is listed" passed anyway,
     * because Discover has a subject filter chip that says "Mathematics" too. The check was
     * being answered by a completely different screen.
     */
    await page.locator(`[data-testid="monthly-join-${classId}"]`).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(600);

    const listed = await text(page);
    check("the class is listed", /Algebra for Grade 10/.test(listed), listed.slice(0, 300).replace(/\n/g, " | "));
    check("with the time it runs at", /16:00/.test(listed), listed.slice(0, 400).replace(/\n/g, " | "));

    /*
     * The number on the button is the number that gets charged.
     *
     * This is the check the whole screen exists for. A price worked out in the app could drift
     * from the one the server charges, and a student would find out after paying. Read off the
     * button itself, not off the page: the page also carries "a full month is NPR 3,000".
     */
    const quoted = (await api(`/monthly/classes/${classId}`)).body?.class?.quote?.amount;
    const monthPrice = Number(sql(`select monthly_price from recurring_sessions where id = ${classId}`));
    const buttonText = await page.locator(`[data-testid="monthly-join-${classId}"]`).innerText();
    const onButton = buttonText.replace(/[,\s]/g, "");
    check("the price the server quotes is on the button itself",
      onButton.includes(String(quoted)),
      `server says ${quoted}, button says "${buttonText}"`);
    check("and it is not quietly charging for a whole month",
      !onButton.includes(String(monthPrice)),
      `a full month is ${monthPrice} and the button says "${buttonText}"`);

    await page.locator(`[data-testid="monthly-join-${classId}"]`).click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await payThrough(page);

    const paid = sql(`select amount_paid from recurring_enrollments
                      where recurring_id = ${classId} and student_id = ${student.user.id}`);
    check("they are enrolled", paid !== "", "no enrolment row");
    check("and charged exactly what the button said", Number(paid) === Number(quoted), `paid ${paid}, quoted ${quoted}`);

    const after = await text(page);
    check("the screen says they are in the class", /You are in this class/i.test(after), after.slice(0, 400).replace(/\n/g, " | "));
    await ctx.close();
  }

  console.log("\nThe one conversation, from both sides");
  {
    const { ctx: tctx, page: tpage } = await open(browser, teacher.token, `/monthly-chat?id=${classId}`);
    await tpage.locator('[data-testid="monthly-chat-input"]').fill("Bring your compass tomorrow.");
    await tpage.waitForTimeout(300);
    await tpage.locator('[data-testid="monthly-chat-send"]').click({ timeout: 15000 });
    await tpage.waitForTimeout(2500);
    check("the teacher's message appears in their own thread",
      /compass/i.test(await text(tpage)), (await text(tpage)).slice(0, 300).replace(/\n/g, " | "));

    const messageId = Number(sql(`select id from session_messages where recurring_id = ${classId} order by id desc limit 1`));
    await tpage.locator(`[data-testid="pin-${messageId}"]`).click({ delay: 900, timeout: 15000 });
    await tpage.waitForTimeout(2500);
    const pinnedInDb = sql(`select pinned_at is not null from session_messages where id = ${messageId}`);
    check("the teacher can pin it by holding it down", pinnedInDb === "t", `pinned_at set: ${pinnedInDb}`);
    await tctx.close();

    const { ctx: sctx, page: spage } = await open(browser, student.token, `/monthly-chat?id=${classId}`);
    const seen = await text(spage);
    check("the student sees the same conversation", /compass/i.test(seen), seen.slice(0, 300).replace(/\n/g, " | "));
    check("a student is not offered a pin", (await spage.locator('[data-testid^="unpin-"]').count()) === 0);
    await sctx.close();
  }

  console.log("\nHomework, set and seen");
  {
    const { ctx, page } = await open(browser, teacher.token, `/monthly-homework?id=${classId}`);
    await page.locator('[data-testid="homework-new"]').click({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.locator('[data-testid="homework-title"]').fill("Algebra sheet 3");
    await page.locator('[data-testid="homework-instructions"]').fill("Questions 1 to 10 on page 62.");
    await page.waitForTimeout(300);
    await page.locator('[data-testid="homework-set"]').click({ timeout: 15000 });
    await page.waitForTimeout(3500);

    const rows = Number(sql(`select count(*) from homework where recurring_id = ${classId}`));
    check("the homework is set", rows === 1, `${rows} rows`);
    const shown = await text(page);
    check("and shown back to the teacher", /Algebra sheet 3/.test(shown), shown.slice(0, 300).replace(/\n/g, " | "));
    check("with how many have handed in", /0 in/.test(shown), shown.slice(0, 400).replace(/\n/g, " | "));
    await ctx.close();

    const { ctx: sctx, page: spage } = await open(browser, student.token, `/monthly-homework?id=${classId}`);
    const seen = await text(spage);
    check("the student sees the homework", /Algebra sheet 3/.test(seen), seen.slice(0, 300).replace(/\n/g, " | "));
    check("and what to do", /page 62/i.test(seen), seen.slice(0, 400).replace(/\n/g, " | "));
    check("and is offered somewhere to attach it",
      (await spage.locator('[data-testid^="homework-pick-"]').count()) > 0, seen.slice(0, 300).replace(/\n/g, " | "));
    await sctx.close();
  }

  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
