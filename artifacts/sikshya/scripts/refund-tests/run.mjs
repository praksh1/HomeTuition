/**
 * Moving a class and dropping one, through the screens a person actually uses.
 *
 * The API suite proves the rules. This proves somebody can reach them: that a student sees the
 * figure before they agree to it, that the teacher is told what a change will cost before they
 * make it, and that an agent can find the money that is owed. A rule nobody can reach is not a
 * feature, and every one of those is a change a compile cannot check.
 *
 * The figures matter most. The number on the confirmation is the number a person decides on,
 * so this reads it off the rendered page rather than trusting that the component was passed
 * the right props.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:refunds
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.REFUND_TEST_PORT ?? 8091);
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
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role, name) {
  seq += 1;
  const email = `rfb_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

const DAY = 24 * 3_600_000;

async function makeSession(teacher, { inDays = 10, price = 500 } = {}) {
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Browser class ${++seq}`, subject: "Mathematics", description: "d",
    date: new Date(Date.now() + inDays * DAY).toISOString(),
    duration: 60, price, maxStudents: 10 } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
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
 * A signed-in browser on one page.
 *
 * A fresh context every time, never a reused one. A dialog accepted in an earlier test or a
 * page left in a state by a previous step is how this project has twice ended up with an
 * assertion that could not fail.
 */
async function open(browser, token, route, { onDialog = "accept" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  // Every confirmation here is a window.confirm on the web, and Playwright dismisses dialogs by
  // default — so without this the "yes" is never given and the test silently proves nothing.
  const seen = [];
  page.on("dialog", async (d) => {
    seen.push(d.message());
    if (onDialog === "accept") await d.accept();
    else await d.dismiss();
  });
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), token);
  await page.goto(`${siteUrl}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  return { ctx, page, dialogs: seen };
}

const text = (page) => page.evaluate(() => document.body.innerText);

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const chromium = await getChromium();
  const browser = await chromium.launch();

  const teacher = await register("teacher", "Ram Prasad");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);

  console.log("\nWhat a student is shown before they give up their money");

  {
    const student = await register("student", "Sita Sharma");
    const session = await makeSession(teacher, { price: 500 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

    const { ctx, page } = await open(browser, student.token, `/session/${session.id}`);
    const body = await text(page);

    check("the Drop control is on the class's page",
      (await page.locator('[data-testid="drop-class"]').count()) > 0, body.slice(0, 200).replace(/\n/g, " | "));
    check("the amount coming back is on screen, not just in the confirmation",
      /NPR\s*250/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("and so is what the student paid", /NPR\s*500/.test(body));
    check("the fee is named a cancellation fee",
      /cancellation fee/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("and never a processing fee", !/processing fee/i.test(body));
    check("the wait is stated before they agree, not after",
      /5-7 business days/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("and nothing claims the money is already back",
      !/you have been refunded/i.test(body) && !/refund complete/i.test(body));

    /**
     * A class ten days away is not an expired one.
     *
     * The button said "Session Expired" for every refusal, including "not open yet" — so a
     * student looking at a class they had just paid for was told it had expired. The owner
     * reported this shape of thing twice about the teacher's side; the same wrong label was
     * still on the student's button after the navigation around it was fixed.
     */
    check("a class ten days away is not labelled expired",
      !/session expired/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("it says it is not open yet",
      /not open yet/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));

    await ctx.close();
  }

  console.log("\nDropping it, and the seat going back on sale");

  {
    const student = await register("student", "Dropping Deepa");
    const session = await makeSession(teacher, { price: 500 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

    const { ctx, page, dialogs } = await open(browser, student.token, `/session/${session.id}`);
    await page.locator('[data-testid="drop-class-btn"]').click({ timeout: 15000 });
    await page.waitForTimeout(3000);

    check("the confirmation names the amount rather than asking `are you sure`",
      dialogs.some((d) => /250/.test(d)), JSON.stringify(dialogs));
    check("and says the place goes to somebody else",
      dialogs.some((d) => /offered to someone else/i.test(d)), JSON.stringify(dialogs));
    check("the drop actually happened",
      sql(`select payment_status from session_enrollments where session_id=${session.id} and student_id=${student.user.id}`) === "refunded");
    check("the seat is back on sale",
      sql(`select enrolled_count from sessions where id=${session.id}`) === "0");
    check("and the debt is on the books",
      sql(`select count(*) from refunds where session_id=${session.id}`) === "1");

    const after = await text(page);
    check("the student is told it is requested, not done",
      /requested/i.test(after) || dialogs.some((d) => /requested/i.test(d)),
      after.slice(0, 300).replace(/\n/g, " | "));

    await ctx.close();
  }

  console.log("\nSaying no leaves everything alone");

  {
    const student = await register("student", "Careful Kamala");
    const session = await makeSession(teacher, { price: 500 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

    const { ctx, page } = await open(browser, student.token, `/session/${session.id}`, { onDialog: "dismiss" });
    await page.locator('[data-testid="drop-class-btn"]').click({ timeout: 15000 });
    await page.waitForTimeout(2500);

    check("cancelling the confirmation drops nothing",
      sql(`select payment_status from session_enrollments where session_id=${session.id} and student_id=${student.user.id}`) === "paid");
    check("and writes no refund",
      sql(`select count(*) from refunds where session_id=${session.id}`) === "0");

    await ctx.close();
  }

  console.log("\nThe teacher's side of the same class");

  {
    const quotaTeacher = await register("teacher", "Moving Mohan");
    sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${quotaTeacher.user.id}`);
    const student = await register("student", "Booked Bimal");
    const session = await makeSession(quotaTeacher, { price: 500 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

    const { ctx, page, dialogs } = await open(browser, quotaTeacher.token, `/session/${session.id}`);
    const body = await text(page);

    check("the teacher is not told their future class expired either",
      !/session expired/i.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("the teacher sees the Schedule card",
      (await page.locator('[data-testid="reschedule-class"]').count()) > 0, body.slice(0, 300).replace(/\n/g, " | "));
    check("with the month's allowance in front of them",
      /5 of 5 changes left this month/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
    check("and who a change would disrupt",
      /1 student has paid/.test(body), body.slice(0, 400).replace(/\n/g, " | "));

    await page.locator('[data-testid="reschedule-open-btn"]').click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    check("the form opens", (await page.locator('[data-testid="reschedule-date"]').count()) > 0);

    const to = new Date(Date.now() + 15 * DAY);
    const pad = (n) => String(n).padStart(2, "0");
    await page.locator('[data-testid="reschedule-date"]').fill(
      `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`);
    await page.locator('[data-testid="reschedule-time"]').fill("14:30");
    await page.locator('[data-testid="reschedule-save-btn"]').click({ timeout: 15000 });
    await page.waitForTimeout(3500);

    check("the confirmation warns that students can now get a full refund",
      dialogs.some((d) => /full refund within 24 hours/i.test(d)), JSON.stringify(dialogs));
    check("and that it costs one of five",
      dialogs.some((d) => /5 schedule changes this month/i.test(d)), JSON.stringify(dialogs));
    check("the class really moved",
      sql(`select count(*) from schedule_changes where session_id=${session.id}`) === "1");
    check("and the allowance went down",
      /4 of 5 changes left this month/.test(await text(page)),
      (await text(page)).slice(0, 400).replace(/\n/g, " | "));

    await ctx.close();

    // And the student's page now offers the whole price back, without them asking why.
    const studentView = await open(browser, student.token, `/session/${session.id}`);
    const studentBody = await text(studentView.page);
    check("the student is now offered the whole price back",
      /whole price back/i.test(studentBody), studentBody.slice(0, 400).replace(/\n/g, " | "));
    check("and no cancellation fee is itemised for them",
      !/cancellation fee/i.test(studentBody), studentBody.slice(0, 400).replace(/\n/g, " | "));
    await studentView.ctx.close();
  }

  console.log("\nA class too close to move, and too close to drop");

  {
    const lateTeacher = await register("teacher", "Late Laxmi");
    sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${lateTeacher.user.id}`);
    const student = await register("student", "Stuck Sunita");
    const session = await makeSession(lateTeacher, { price: 500 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
    // Tomorrow: inside both the 48-hour move lock and the 24-hour drop deadline.
    sql(`update sessions set date = now() + interval '20 hours' where id = ${session.id}`);

    const teacherView = await open(browser, lateTeacher.token, `/session/${session.id}`);
    check("the teacher is told why, rather than given a form that will be refused",
      (await teacherView.page.locator('[data-testid="reschedule-reason"]').count()) > 0);
    check("and there is no button to open one",
      (await teacherView.page.locator('[data-testid="reschedule-open-btn"]').count()) === 0);
    await teacherView.ctx.close();

    const studentView = await open(browser, student.token, `/session/${session.id}`);
    check("the student gets a reason instead of a Drop button",
      (await studentView.page.locator('[data-testid="drop-class-reason"]').count()) > 0);
    check("and no Drop button at all",
      (await studentView.page.locator('[data-testid="drop-class-btn"]').count()) === 0);
    check("with Support offered instead",
      /Support/i.test(await text(studentView.page)));
    await studentView.ctx.close();
  }

  console.log("\nThe thread a student keeps after dropping");

  {
    const student = await register("student", "Gone Gita");
    const session = await makeSession(teacher, { price: 500 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
    await api(`/sessions/${session.id}/messages`, { method: "POST", token: teacher.token, body: { body: "Bring a protractor." } });
    await api(`/sessions/${session.id}/drop`, { method: "POST", token: student.token });

    const { ctx, page } = await open(browser, student.token, `/session/${session.id}`);
    const body = await text(page);
    check("they can still read what the teacher said",
      /Bring a protractor/.test(body), body.slice(0, 500).replace(/\n/g, " | "));
    check("but the box to write in is gone",
      (await page.locator('[data-testid="session-thread-input"]').count()) === 0);
    check("and they are told why",
      (await page.locator('[data-testid="session-thread-readonly"]').count()) > 0);

    /**
     * And the page says what happened to their money.
     *
     * It used to say nothing at all — identical to a class they had never booked — at the exact
     * moment somebody is most likely to be checking on a refund they were promised.
     */
    check("the page tells them they have left",
      (await page.locator('[data-testid="drop-class-left"]').count()) > 0, body.slice(0, 400).replace(/\n/g, " | "));
    check("and names the amount and the wait",
      /NPR\s*250/.test(body) && /5-7 business days/i.test(body), body.slice(0, 600).replace(/\n/g, " | "));
    check("without claiming it has already been paid",
      !/has been paid/i.test(body), body.slice(0, 600).replace(/\n/g, " | "));
    await ctx.close();
  }

  console.log("\nThe agent's queue");

  {
    const agentAccount = await register("student", "Support Agent");
    sql(`update users set role = 'admin' where id = ${agentAccount.user.id}`);
    const signedIn = await api("/auth/login", { method: "POST", body: { email: agentAccount.email, password: "password123" } });
    const agentToken = signedIn.body?.token ?? agentAccount.token;

    const student = await register("student", "Owed Ojaswi");
    const session = await makeSession(teacher, { price: 800 });
    await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
    const dropped = await api(`/sessions/${session.id}/drop`, { method: "POST", token: student.token });
    const refundId = dropped.body?.refund?.id;

    const { ctx, page } = await open(browser, agentToken, "/refunds");
    const firstView = await text(page);

    check("Refunds is a tab an agent can reach",
      (await page.locator('[data-testid="admin-refunds-total"]').count()) > 0,
      firstView.slice(0, 300).replace(/\n/g, " | "));
    check("and the screen says plainly that it pays nothing",
      /Nothing here moves money/i.test(firstView), firstView.slice(0, 300).replace(/\n/g, " | "));

    /**
     * Found by searching, not by scrolling.
     *
     * The queue is worked oldest-first a page at a time, so on any database with real history
     * the newest refund is not on the first screen — which is the situation an agent answering
     * "where is my money" about a named person is always in.
     */
    await page.locator('[data-testid="admin-refunds-search"]').fill("Owed Ojaswi");
    await page.waitForTimeout(3000);
    const body = await text(page);

    check("searching a name finds that person's refund",
      (await page.locator(`[data-testid="admin-refund-${refundId}"]`).count()) > 0, `refund=${refundId}`);
    check("the student is named", /Owed Ojaswi/.test(body), body.slice(0, 500).replace(/\n/g, " | "));
    check("the amount is right", /NPR\s*400/.test(body), body.slice(0, 500).replace(/\n/g, " | "));
    check("and searching a name nobody has finds nothing rather than everything",
      await (async () => {
        await page.locator('[data-testid="admin-refunds-search"]').fill("Zzzz Nobody Here");
        await page.waitForTimeout(3000);
        const none = await page.locator('[data-testid^="admin-refund-"]').count();
        await page.locator('[data-testid="admin-refunds-search"]').fill("Owed Ojaswi");
        await page.waitForTimeout(3000);
        return none === 0;
      })());

    // Marking it paid without a reference must not go through.
    await page.locator(`[data-testid="admin-refund-paid-${refundId}"]`).click({ timeout: 15000 });
    await page.waitForTimeout(2000);
    check("marking it paid with no reference does nothing",
      sql(`select status from refunds where id=${refundId}`) === "owed");

    await page.locator(`[data-testid="admin-refund-reference-${refundId}"]`).fill("ESEWA-7712");
    await page.locator(`[data-testid="admin-refund-paid-${refundId}"]`).click({ timeout: 15000 });
    await page.waitForTimeout(3000);
    check("with one, it is settled",
      sql(`select status from refunds where id=${refundId}`) === "paid");
    check("and what to point at is kept",
      sql(`select note from refunds where id=${refundId}`) === "ESEWA-7712");

    await ctx.close();
  }

  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
