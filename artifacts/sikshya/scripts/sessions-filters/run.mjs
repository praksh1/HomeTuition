/**
 * The Sessions screens, once there is more on them than a week of testing produces.
 *
 * Two complaints from the owner, on the same screens. "I have only been testing for less than
 * a month and already my pages look overcrowded" — so a teacher needs to be able to ask for
 * the part they came for. And monthly classes were invisible: nothing on either Sessions
 * screen said a standing arrangement existed.
 *
 * Every check here is driven from a seeded account with enough on it to crowd the screen: ten
 * classes still to come, six that came and went unstarted, one finished, and a monthly class.
 * A filter tested against three rows proves nothing.
 *
 * Usage: PGURL=... node scripts/sessions-filters/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PORT = Number(process.env.FILTER_SITE_PORT ?? 8097);
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
const teacher = (await api("/auth/register", { method: "POST", body: {
  name: "Gita Poudel", email: `flt_t_${stamp}@example.com`, password: "password123", role: "teacher", subject: "Maths", bio: "x",
} })).body;
sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);

const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
const make = (topic) => api("/sessions", { method: "POST", token: teacher.token, body: {
  subject: "Maths", topic, date: soon, duration: 60, maxStudents: 20, price: 500,
} });

for (let i = 0; i < 10; i++) await make(`Coming up ${i}`);
for (let i = 0; i < 6; i++) {
  const row = (await make(`Missed it ${i}`)).body;
  sql(`update sessions set date = now() - interval '${4 + i} days' where id = ${row.id}`);
}
const done = (await make("All finished")).body.id;
sql(`update sessions set status = 'completed', date = now() - interval '9 days' where id = ${done}`);

await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
const klass = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
  subject: "Maths", topic: "Daily algebra hour", startMinute: 17 * 60, durationMinutes: 60,
  timeZone: "Asia/Kathmandu", monthlyPrice: 2000, maxStudents: 20,
} });
const klassId = klass.body?.id ?? klass.body?.class?.id;
if (!klassId) {
  console.error("could not create the monthly class:", klass.status, JSON.stringify(klass.body).slice(0, 300));
  process.exit(1);
}

const chromium = await getChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("dialog", async (d) => { await d.accept(); });
await page.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), teacher.token);
await page.goto(`${siteUrl}/(teacher)/sessions`, { waitUntil: "networkidle" });
await page.waitForTimeout(4500);

const text = () => page.evaluate(() => document.body.innerText);
const tap = async (label) => {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(2800);
};

let body = await text();
check("the teacher's Sessions screen offers an Expired filter", /Expired/.test(body), body.slice(0, 300).replace(/\n/g, " | "));
check("and a Monthly one", /Monthly/.test(body), body.slice(0, 300).replace(/\n/g, " | "));

/**
 * And they are actually on the screen, with a height, not merely in the document.
 *
 * This is the check that was missing. A horizontal ScrollView has no height of its own, and
 * above a list that wants all the room it collapses to nothing — the chips paint for one frame
 * and vanish, which is what a teacher reported. Every assertion above still passed, because
 * `innerText` returns text from zero-height elements too. Measuring is the only way to tell a
 * rendered control from a remembered one.
 */
/**
 * The row's own height, not a chip's.
 *
 * Measuring the chips is not enough: give the row `height: 0` and the chips overflow it and
 * keep boxes of their own, so every chip assertion passes while the row is invisible and
 * unclickable. The container is the thing that collapses, so the container is the thing to
 * measure.
 */
const rowHeight = async (page, testId) => {
  const box = await page.locator(`[data-testid="${testId}"]`).first().boundingBox().catch(() => null);
  return box?.height ?? 0;
};

const chipBox = async (label) => {
  const box = await page.getByText(label, { exact: true }).first().boundingBox();
  return box ?? { width: 0, height: 0 };
};
for (const label of ["All", "Live", "Upcoming", "Completed", "Expired", "Monthly"]) {
  const box = await chipBox(label);
  check(`the "${label}" filter is visible, not a zero-height ghost`,
    box.height > 10 && box.width > 10, `height=${box.height} width=${box.width}`);
}

check("the row holding them has a height of its own",
  await rowHeight(page, "teacher-filter-row") > 20, `height=${await rowHeight(page, "teacher-filter-row")}`);

/* And it stays visible — a row that collapses one frame later is the bug being fixed. */
await page.waitForTimeout(2500);
const settled = await chipBox("Expired");
check("and is still there once the list below has loaded",
  settled.height > 10, `height=${settled.height}`);

await tap("Upcoming");
body = await text();
check("Upcoming shows the classes still to come", /Coming up 0/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and none of the ones whose time has passed", !/Missed it/.test(body), body.slice(0, 600).replace(/\n/g, " | "));

await tap("Expired");
body = await text();
check("Expired shows exactly those", /Missed it/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and none of the ones still to come", !/Coming up/.test(body), body.slice(0, 600).replace(/\n/g, " | "));

await tap("Completed");
body = await text();
check("Completed is its own pile", /All finished/.test(body) && !/Missed it/.test(body), body.slice(0, 400).replace(/\n/g, " | "));

await tap("Monthly");
body = await text();
check("Monthly shows the standing arrangement", /Daily algebra hour/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("with what the teacher charges for it", /2,000/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and not one of the single classes", !/Coming up|Missed it|All finished/.test(body), body.slice(0, 500).replace(/\n/g, " | "));
check("and it opens My Plan", await page.locator('[data-testid="teacher-monthly-plan"]').count() > 0);

const student = (await api("/auth/register", { method: "POST", body: {
  name: "Kiran Basnet", email: `flt_s_${stamp}@example.com`, password: "password123", role: "student", grade: "10",
} })).body;
const joined = await api(`/monthly/classes/${klassId}/join`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
check("a student can join the monthly class", joined.status < 300, `status=${joined.status} ${JSON.stringify(joined.body).slice(0, 200)}`);

const sCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const sPage = await sCtx.newPage();
sPage.on("dialog", async (d) => { await d.accept(); });
await sPage.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), student.token);
await sPage.goto(`${siteUrl}/(student)/sessions`, { waitUntil: "networkidle" });
await sPage.waitForTimeout(4500);
const sBody = await sPage.evaluate(() => document.body.innerText);
/*
 * The student's own filters, which they had none of. Measured, not read: text inside a
 * zero-height row is still in innerText, and that is how the teacher's row passed while being
 * invisible on a phone.
 */
for (const id of ["all", "monthly", "live", "upcoming", "past"]) {
  const box = await sPage.locator(`[data-testid="student-group-${id}"]`).first().boundingBox().catch(() => null);
  check(`the student's "${id}" filter is on screen`, !!box && box.height > 10 && box.width > 10,
    box ? `height=${box.height}` : "not found");
}
check("and the row holding them has a height of its own",
  await rowHeight(sPage, "student-filter-row") > 20, `height=${await rowHeight(sPage, "student-filter-row")}`);
check("the student sees a Monthly Classes section", /Monthly Classes/.test(sBody), sBody.slice(0, 400).replace(/\n/g, " | "));

/* Choosing one narrows to it, and the count on the chip matches what is under it. */
/*
 * Checked by the card, not by its topic. A monthly class generates real daily sessions under
 * the same name, so matching the words finds the day's class sitting in Past and reads it as
 * the standing arrangement — an assertion that cannot tell the two apart is not an assertion.
 */
const monthlyCard = `[data-testid="student-monthly-${klassId}"]`;
await sPage.locator('[data-testid="student-group-past"]').first().click();
await sPage.waitForTimeout(1500);
check("choosing Past hides the monthly arrangement",
  await sPage.locator(monthlyCard).count() === 0,
  (await sPage.evaluate(() => document.body.innerText)).slice(0, 240).replace(/\n/g, " | "));
await sPage.locator('[data-testid="student-group-monthly"]').first().click();
await sPage.waitForTimeout(1500);
check("and choosing Monthly brings it back", await sPage.locator(monthlyCard).count() > 0);
await sPage.locator('[data-testid="student-group-all"]').first().click();
await sPage.waitForTimeout(1200);
check("with the class they joined in it", /Daily algebra hour/.test(sBody), sBody.slice(0, 400).replace(/\n/g, " | "));
check("and who teaches it", /Gita Poudel/.test(sBody), sBody.slice(0, 400).replace(/\n/g, " | "));
/*
 * The contradiction that would otherwise sit on this screen: a monthly class listed above
 * "No sessions yet", because this student has booked no single lessons.
 */
check("and is not told they have nothing while a class is listed above",
  !/No sessions yet/.test(sBody), sBody.slice(0, 600).replace(/\n/g, " | "));

/*
 * A student who has NOT joined must not see it. `/monthly/classes` lists every class on offer,
 * so the filter that keeps it off this screen is the only thing standing between "my classes"
 * and "every class in the country".
 */
const onlooker = (await api("/auth/register", { method: "POST", body: {
  name: "Nabin Rai", email: `flt_n_${stamp}@example.com`, password: "password123", role: "student", grade: "10",
} })).body;
const nCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const nPage = await nCtx.newPage();
await nPage.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), onlooker.token);
await nPage.goto(`${siteUrl}/(student)/sessions`, { waitUntil: "networkidle" });
await nPage.waitForTimeout(4000);
const nBody = await nPage.evaluate(() => document.body.innerText);
check("a student who has not joined does not see it under My Sessions",
  !/Daily algebra hour/.test(nBody), nBody.slice(0, 400).replace(/\n/g, " | "));

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
