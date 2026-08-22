/**
 * Tapping a finished class, in the real app, against a real server.
 *
 * This suite exists because of a specific failure of mine. I fixed "a teacher may not *start*
 * an old class" and tested that rule thoroughly — and the teacher was opening old classes by
 * tapping a card in My Sessions, which never went near it. Every test I had written passed
 * against a build where tapping a three-day-old class opened a classroom, showed a LIVE badge
 * with a running timer, and asked the phone for camera and microphone.
 *
 * So this drives the actual screens: sign in, look at the list the teacher looks at, tap the
 * thing the teacher taps, and assert what the teacher sees. A rule that is right and a screen
 * that never asks it are the same thing from the outside.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:classroom
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.CLASSROOM_TEST_PORT ?? 8086);
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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`,
    email: `cr_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  return res.body;
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first:\n  pnpm.cmd --filter @workspace/sikshya run build");
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

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${teacher.user.id}`);

  // A class that finished three days ago — the case in the report.
  const old = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Stress 14", subject: "Mathematics", description: "d",
    date: new Date(Date.now() - 72 * 3600_000).toISOString(),
    duration: 60, price: 500, maxStudents: 20 } });
  sql(`update sessions set status = 'completed' where id = ${old.body.id}`);

  const chromium = await getChromium();
  const browser = await chromium.launch();

  // Camera and microphone are refused outright, so a request for them cannot be mistaken for
  // a grant. Any prompt at all is the bug.
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    permissions: [],
  });

  /** Every request the page makes for a video room, and every camera request. */
  const roomRequests = [];
  const page = await ctx.newPage();
  page.on("request", (r) => {
    if (/\/api\/sessions\/\d+\/room/.test(r.url())) roomRequests.push(r.url());
  });
  const mediaCalls = [];
  await page.addInitScript(() => {
    // Standing in for the operating system's permission prompt: the app cannot ask for a
    // camera without going through here.
    const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    window.__mediaCalls = [];
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = (...args) => {
        window.__mediaCalls.push(JSON.stringify(args[0] ?? {}));
        return original ? original(...args) : Promise.reject(new Error("blocked"));
      };
    }
  });
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);

  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  /**
   * Every address the app visits, not just where it ends up.
   *
   * Checking the final URL is not enough and this is why: the classroom already bounced a
   * finished class straight back out with an alert, so the teacher ended up on the list
   * again — while the classroom had mounted, asked for a video room and started a call on the
   * way through. "Where did you end up" was exactly the question that made this look fine.
   */
  const visited = [];
  await page.addInitScript(() => {
    window.__visited = [location.pathname];
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method].bind(history);
      history[method] = (...args) => {
        const result = original(...args);
        window.__visited.push(location.pathname);
        return result;
      };
    }
    window.addEventListener("popstate", () => window.__visited.push(location.pathname));
  });

  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  console.log("\nA teacher taps a class that finished three days ago");

  // Get to My Sessions the way a teacher does — the tab bar, which is real links.
  await page.click('a[role="tab"][href="/sessions"]', { timeout: 15000 });
  await page.waitForTimeout(3500);
  // The Completed filter, since that is where a finished class sits.
  await page.click('text="Completed"', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const card = page.locator('text="Stress 14"').first();
  const found = await card.count();
  check("the finished class is in the list", found > 0, `found ${found}`);
  if (found === 0) {
    console.log(await page.evaluate(() => document.body.innerText.slice(0, 400)));
  } else {
    await card.click();
    await page.waitForTimeout(4000);
  }

  const after = await page.evaluate(() => ({
    url: location.pathname,
    text: document.body.innerText.slice(0, 600),
    mediaCalls: window.__mediaCalls ?? [],
    visited: window.__visited ?? [],
  }));

  // The three things the report is about.
  check(
    "the classroom is never opened, not even briefly",
    !after.visited.some((p) => /classroom/.test(p)) && !/classroom/.test(after.url),
    `visited ${JSON.stringify(after.visited)}, ended on ${after.url}`,
  );
  check(
    "it says the session has expired",
    /expired/i.test(after.text) || dialogs.some((d) => /expired/i.test(d)),
    `dialogs: ${JSON.stringify(dialogs)} | screen: ${after.text.slice(0, 200).replace(/\n/g, " | ")}`,
  );
  check(
    "nothing asks the server for a video room",
    roomRequests.length === 0,
    `requests: ${JSON.stringify(roomRequests)}`,
  );
  check(
    "nothing asks for the camera or microphone",
    after.mediaCalls.length === 0,
    `getUserMedia calls: ${JSON.stringify(after.mediaCalls)}`,
  );
  check(
    "no LIVE badge is shown for it",
    !/\bLIVE\b/.test(after.text),
    after.text.slice(0, 200).replace(/\n/g, " | "),
  );

  await ctx.close();

  // ---------------------------------------------------------------------------------------
  // The other half of the same window: a teacher who hung up and comes straight back.
  //
  // Reported from a real session and reproduced here before it was fixed. Ending a class set
  // it `completed`; walking back in fetched a perfectly good room and then threw it away,
  // because the screen could not tell "I ended this and came back" from "someone ended this
  // while I was in it". The teacher was told they must have started another class — they had
  // not — and bounced to the dashboard, or on a phone left watching "Setting up video room…"
  // for as long as they cared to wait. The three-hour window exists for exactly this person.
  // ---------------------------------------------------------------------------------------
  console.log("\nA teacher ends a class and walks straight back in");

  const mine = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Rejoin Test", subject: "Mathematics", description: "d",
    date: new Date().toISOString(), duration: 60, price: 500, maxStudents: 20 } });
  await api(`/sessions/${mine.body.id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
  await api(`/sessions/${mine.body.id}`, { method: "PATCH", token: teacher.token, body: { status: "completed" } });
  check(
    "the class really is ended before we start",
    sql(`select status from sessions where id = ${mine.body.id}`) === "completed",
  );

  const ctx2 = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    permissions: [],
  });
  const rejoinRooms = [];
  const page2 = await ctx2.newPage();
  page2.on("response", (r) => {
    if (/\/api\/sessions\/\d+\/room/.test(r.url())) rejoinRooms.push(r.status());
  });
  const rejoinDialogs = [];
  page2.on("dialog", async (d) => { rejoinDialogs.push(d.message()); await d.dismiss(); });
  await page2.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);

  await page2.goto(siteUrl, { waitUntil: "networkidle" });
  await page2.waitForTimeout(3000);
  await page2.click('a[role="tab"][href="/sessions"]', { timeout: 15000 });
  await page2.waitForTimeout(2500);
  await page2.click('text="Completed"', { timeout: 5000 }).catch(() => {});
  await page2.waitForTimeout(2000);
  await page2.locator('text="Rejoin Test"').first().click({ timeout: 10000 });
  await page2.waitForTimeout(3000);

  /**
   * The list now opens the class's own page rather than the classroom itself.
   *
   * The owner asked for that directly — "the teacher should be able to click on it and see the
   * students that have enrolled... the start option should come after this" — and the recovery
   * this block is about still has to work through it. So the page is checked, and then it is
   * used: the class a teacher ended by accident must still be one tap from being live again.
   */
  const landing = await page2.evaluate(() => ({ url: location.pathname, text: document.body.innerText }));
  check(
    "tapping a class opens its own page, not a video call",
    /\/session\//.test(landing.url),
    `ended on ${landing.url}`,
  );
  check(
    "no video room is asked for merely by looking at a class",
    rejoinRooms.length === 0,
    `room responses: ${JSON.stringify(rejoinRooms)}`,
  );
  check(
    "the page offers a way back in, because this class ended within the window",
    /Reopen class/i.test(landing.text),
    landing.text.slice(0, 300).replace(/\n/g, " | "),
  );
  check(
    "and a running clock is on it, as asked for",
    (await page2.locator('[data-testid="session-clock"]').count()) > 0,
  );

  await page2.locator('[data-testid="session-start-btn"]').first().click({ timeout: 10000 });
  await page2.waitForTimeout(5000);

  const rejoin = await page2.evaluate(() => ({ url: location.pathname, text: document.body.innerText }));

  check(
    "the teacher stays in the classroom instead of being bounced out",
    /classroom/.test(rejoin.url),
    `ended on ${rejoin.url}`,
  );
  check(
    "they are not told they started another class",
    !rejoinDialogs.some((d) => /no longer live|started another class/i.test(d)),
    `dialogs: ${JSON.stringify(rejoinDialogs)}`,
  );
  check(
    "the class is live again, which is what the three-hour window is for",
    sql(`select status from sessions where id = ${mine.body.id}`) === "live",
    `status is ${sql(`select status from sessions where id = ${mine.body.id}`)}`,
  );
  check(
    "a video room is granted",
    rejoinRooms.includes(200),
    `room responses: ${JSON.stringify(rejoinRooms)}`,
  );
  check(
    "and asked for once, not twice",
    rejoinRooms.length === 1,
    `room responses: ${JSON.stringify(rejoinRooms)}`,
  );
  check(
    "the video area is not left saying it is still setting up",
    !/Setting up video room/i.test(rejoin.text),
    rejoin.text.slice(0, 200).replace(/\n/g, " | "),
  );
  /**
   * One chat, not two.
   *
   * On the web the call carries Daily's own chat, inside the video where it belongs. The
   * classroom's own tab beside the board was a second, emptier conversation next to a working
   * one — "I don't want teacher and student to get confused on which chat system to use". It
   * stays on the installed apps, where Daily has no chat panel at all and this is the only one
   * there is. See utils/classroomChat.ts.
   */
  /**
   * The Rec button is gone, and must stay gone.
   *
   * It recorded nothing and then said "Recording saved to Sikshya cloud." A teacher could have
   * relied on that in a dispute and found there was never anything to produce. Checked here
   * because a control that lies about evidence is the kind of thing that gets restored by
   * accident, and nothing else would notice.
   */
  check(
    "there is no Rec button pretending to record the lesson",
    !/\bRec\b/.test(rejoin.text) && !/Recording saved/i.test(rejoin.text),
    rejoin.text.slice(0, 200).replace(/\n/g, " | "),
  );

  check(
    "the board has no second chat tab beside it on the web",
    !(await page2.getByText("Chat", { exact: false }).filter({ hasText: /^Chat/ }).count()),
    `found ${await page2.getByText("Chat", { exact: false }).filter({ hasText: /^Chat/ }).count()} chat control(s)`,
  );

  console.log("\nA teacher looks at a class without starting it");

  /**
   * The owner's ask, driven through the real screen: "the teacher should be able to click on
   * it and see the students that have enrolled", and "the start option should be grayed out"
   * for anything too old to reopen.
   *
   * Checked in a browser rather than against the endpoint because the endpoint was never the
   * doubtful part. A rule the server enforces and a screen that never shows it are the same
   * thing from the teacher's side — which is the failure this whole suite exists for.
   */
  const soon = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Who Is Coming", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 30 * 60_000).toISOString(),
    duration: 60, price: 500, maxStudents: 20 } });

  const pupilA = await register("student");
  const pupilB = await register("student");
  for (const pupil of [pupilA, pupilB]) {
    const booked = await api(`/sessions/${soon.body.id}/book`, {
      method: "POST", token: pupil.token, body: { paymentMethod: "esewa" },
    });
    if (booked.status > 201) throw new Error(`book: ${booked.status} ${JSON.stringify(booked.body)}`);
  }

  const ctx3 = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    permissions: [],
  });
  const page3 = await ctx3.newPage();
  const peekRooms = [];
  page3.on("response", (r) => {
    if (/\/api\/sessions\/\d+\/room/.test(r.url())) peekRooms.push(r.status());
  });
  await page3.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);

  await page3.goto(`${siteUrl}/session/${soon.body.id}`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(3500);
  const peek = await page3.evaluate(() => document.body.innerText);

  check("both students who booked are named", /Student/.test(peek) && peek.match(/Student \d+/g)?.length >= 2,
    (peek.match(/Student \d+/g) ?? []).join(", "));
  check("they are shown as booked, not as having attended", /Booked/.test(peek) && !/Attended/.test(peek));
  check("the class can be started from here", /Start class/i.test(peek));
  check("looking at who is coming does not open a video room", peekRooms.length === 0,
    `room responses: ${JSON.stringify(peekRooms)}`);

  // The three-day-old class from the first block, opened at its own address.
  await page3.goto(`${siteUrl}/session/${old.body.id}`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(3500);
  const expired = await page3.evaluate(() => document.body.innerText);
  check("a class too old to reopen says so on the button itself", /Session expired/i.test(expired), expired.slice(0, 300).replace(/\n/g, " | "));
  check("and the reason is on the page, not hidden behind a tap",
    /more than 3 hours ago/i.test(expired), expired.slice(0, 300).replace(/\n/g, " | "));

  await page3.locator('[data-testid="session-start-btn"]').first().click({ timeout: 10000 }).catch(() => {});
  await page3.waitForTimeout(2500);
  check("and tapping it goes nowhere near a classroom",
    !/classroom/.test(await page3.evaluate(() => location.pathname)),
    await page3.evaluate(() => location.pathname));
  check("still no video room, after tapping the greyed-out button", peekRooms.length === 0,
    `room responses: ${JSON.stringify(peekRooms)}`);

  await ctx3.close();

  await ctx2.close();
  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
