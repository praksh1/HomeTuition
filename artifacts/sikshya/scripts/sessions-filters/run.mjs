/**
 * The Sessions screens, once there is more on them than a week of testing produces.
 *
 * Two complaints from the owner, on the same screens. "I have only been testing for less than
 * a month and already my pages look overcrowded" — so a teacher needs to be able to ask for
 * the part they came for. The retired Monthly product must not leak back into either current
 * Sessions screen while its old records and direct compatibility route remain preserved.
 *
 * Every check here is driven from a seeded account with enough on it to crowd the screen: ten
 * lessons still to come, six that came and went unstarted, and one finished. A filter tested
 * against three rows proves nothing. The same journey measures the phone and laptop layouts;
 * readable source code cannot prove that a visible control fits a real viewport.
 *
 * Usage: PGURL=... node scripts/sessions-filters/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

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
prepareBrowserAccount(teacher.user.id);
/*
 * This screen-crowding fixture deliberately needs seventeen single classes. Put only this
 * synthetic teacher on the real 30-class tier so the test measures filtering rather than the
 * independently verified Base-plan limit.
 */
sql(`update teacher_profiles
     set approval_status = 'approved', subscription_tier = 'tier4',
         max_sessions_per_month = 30, subscription_active = true
     where user_id = ${teacher.user.id}`);

// Independent days at 10:00 Nepal time. Seventeen copies of one instant no longer constitute
// a valid crowding fixture.
const fixtureDay = new Date(Date.now() + 3 * 24 * 3600_000);
fixtureDay.setUTCHours(4, 15, 0, 0);
let fixtureOrdinal = 0;
const make = async (topic) => {
  const date = new Date(fixtureDay.getTime() + fixtureOrdinal++ * 24 * 3600_000).toISOString();
  const made = await api("/sessions", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic, date, duration: 60, maxStudents: 20, price: 500,
  } });
  if (made.status !== 201 || !Number.isInteger(made.body?.id)) {
    throw new Error(`Could not create filter fixture: ${made.status} ${JSON.stringify(made.body)}`);
  }
  return made;
};

const upcomingIds = [];
for (let i = 0; i < 10; i++) {
  upcomingIds.push((await make(`Coming up ${i}`)).body.id);
}
for (let i = 0; i < 6; i++) {
  const row = (await make(`Missed it ${i}`)).body;
  sql(`update sessions set date = now() - interval '${4 + i} days' where id = ${row.id}`);
}
const done = (await make("All finished")).body.id;
sql(`update sessions set status = 'completed', date = now() - interval '9 days' where id = ${done}`);

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
check("the teacher's Schedule offers one calm History view", /Teaching schedule/.test(body) && /History/.test(body), body.slice(0, 300).replace(/\n/g, " | "));
check("and does not advertise the retired Monthly product", !/Monthly/.test(body), body.slice(0, 300).replace(/\n/g, " | "));
check("and presents lessons as an agenda rather than a price catalogue", /One-time lesson/.test(body) && !/NPR 500 per class/.test(body), body.slice(0, 500).replace(/\n/g, " | "));

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
for (const label of ["Upcoming", "Live", "History"]) {
  const box = await chipBox(label);
  check(`the "${label}" filter is visible, not a zero-height ghost`,
    box.height > 10 && box.width > 10, `height=${box.height} width=${box.width}`);
}

for (const id of ["upcoming", "live", "history"]) {
  const box = await page.locator(`[data-testid="teacher-group-${id}"]`).first().boundingBox().catch(() => null);
  check(`the teacher's "${id}" filter has a 44 point touch target`, !!box && box.height >= 44,
    box ? `height=${box.height}` : "not found");
}

check("the row holding them has a height of its own",
  await rowHeight(page, "teacher-filter-row") > 20, `height=${await rowHeight(page, "teacher-filter-row")}`);

/* And it stays visible — a row that collapses one frame later is the bug being fixed. */
await page.waitForTimeout(2500);
const settled = await chipBox("History");
check("and is still there once the list below has loaded",
  settled.height > 10, `height=${settled.height}`);

await tap("Upcoming");
body = await text();
check("Upcoming shows the classes still to come", /Coming up 0/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and none of the ones whose time has passed", !/Missed it/.test(body), body.slice(0, 600).replace(/\n/g, " | "));

await tap("History");
body = await text();
check("History keeps missed lessons", /Missed it/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("and none of the ones still to come", !/Coming up/.test(body), body.slice(0, 600).replace(/\n/g, " | "));
await page.locator('[data-testid="teacher-schedule-list"]').evaluate((element) => {
  element.scrollTop = element.scrollHeight;
  element.dispatchEvent(new Event("scroll"));
});
await page.waitForTimeout(400);
check("and completed lessons are kept in that same history",
  await page.getByText("All finished", { exact: true }).count() === 1,
  (await text()).slice(-600).replace(/\n/g, " | "));

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
const teacherDesktop = await page.locator('[data-testid="teacher-schedule-content"]').first().boundingBox();
check("the teacher schedule keeps a calm reading width on a laptop",
  !!teacherDesktop && teacherDesktop.width <= 760 && teacherDesktop.x >= 250,
  teacherDesktop ? `x=${teacherDesktop.x} width=${teacherDesktop.width}` : "not found");
check("the teacher schedule never creates sideways scrolling",
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  await page.evaluate(() => `scroll=${document.documentElement.scrollWidth} viewport=${window.innerWidth}`));

const student = (await api("/auth/register", { method: "POST", body: {
  name: "Kiran Basnet", email: `flt_s_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(student.user.id);
const joined = await api(`/sessions/${upcomingIds[0]}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
check("a student can book one of the upcoming classes", joined.status < 300, `status=${joined.status} ${JSON.stringify(joined.body).slice(0, 200)}`);

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
for (const id of ["upcoming", "live", "history"]) {
  const box = await sPage.locator(`[data-testid="student-group-${id}"]`).first().boundingBox().catch(() => null);
  check(`the student's "${id}" filter is on screen`, !!box && box.height > 10 && box.width > 10,
    box ? `height=${box.height}` : "not found");
}
check("and the row holding them has a height of its own",
  await rowHeight(sPage, "student-filter-row") > 20, `height=${await rowHeight(sPage, "student-filter-row")}`);
check("the student does not see the retired Monthly product", !/Monthly Classes|Monthly/.test(sBody), sBody.slice(0, 400).replace(/\n/g, " | "));
check("the student sees one class library rather than a session database", /My classes/.test(sBody), sBody.slice(0, 300).replace(/\n/g, " | "));

/* Choosing one narrows the current learning list rather than revealing a retired product. */
const bookedCard = `[data-testid="session-${upcomingIds[0]}"]`;
check("the booked class is in Upcoming", await sPage.locator(bookedCard).count() > 0);
await sPage.locator('[data-testid="student-group-history"]').first().click();
await sPage.waitForTimeout(1500);
check("choosing History hides the upcoming class",
  await sPage.locator(bookedCard).count() === 0,
  (await sPage.evaluate(() => document.body.innerText)).slice(0, 240).replace(/\n/g, " | "));
await sPage.locator('[data-testid="student-group-upcoming"]').first().click();
await sPage.waitForTimeout(1500);
check("and choosing Upcoming brings it back", await sPage.locator(bookedCard).count() > 0);
check("with the class they joined in it", /Coming up 0/.test(sBody), sBody.slice(0, 400).replace(/\n/g, " | "));
check("and who teaches it", /Gita Poudel/.test(sBody), sBody.slice(0, 400).replace(/\n/g, " | "));
/* A booked class and an empty-state claim must never be shown together. */
check("and is not told they have nothing while a class is listed above",
  !/No sessions yet/.test(sBody), sBody.slice(0, 600).replace(/\n/g, " | "));

await sPage.setViewportSize({ width: 1440, height: 900 });
await sPage.waitForTimeout(400);
const studentDesktop = await sPage.locator('[data-testid="student-classes-content"]').first().boundingBox();
check("the student's class library keeps a calm reading width on a laptop",
  !!studentDesktop && studentDesktop.width <= 760 && studentDesktop.x >= 250,
  studentDesktop ? `x=${studentDesktop.x} width=${studentDesktop.width}` : "not found");
check("the student's class library never creates sideways scrolling",
  await sPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  await sPage.evaluate(() => `scroll=${document.documentElement.scrollWidth} viewport=${window.innerWidth}`));

/* A student who has not booked this teacher must not see the teacher's diary as their own. */
const onlooker = (await api("/auth/register", { method: "POST", body: {
  name: "Nabin Rai", email: `flt_n_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(onlooker.user.id);
const nCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const nPage = await nCtx.newPage();
await nPage.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), onlooker.token);
await nPage.goto(`${siteUrl}/(student)/sessions`, { waitUntil: "networkidle" });
await nPage.waitForTimeout(4000);
const nBody = await nPage.evaluate(() => document.body.innerText);
check("a student who has not joined does not see it under My Sessions",
  !/Coming up 0/.test(nBody), nBody.slice(0, 400).replace(/\n/g, " | "));

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
