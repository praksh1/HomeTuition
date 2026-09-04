/**
 * A class you are early for must not look like a class that is over.
 *
 * This is a **rendered** test, and that is the point of it existing. The server-side journey
 * suite checked the HTTP contract and passed 49 of 49 while both classrooms were still turning
 * every timing refusal into an ending — the teacher's screen offering "Session already expired"
 * and a button to **create a new session** for a class their students had already booked. An
 * API-only test cannot see that. A browser can.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:lobby
 *
 * A browser is not a phone. Everything here renders in headless Chromium at two viewport sizes;
 * nothing in it is evidence about iOS or Android hardware.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.LOBBY_TEST_PORT ?? 8087);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

/** A laptop, and a narrow phone-sized browser window. Not a phone. */
const EARLY_TOPIC = `Lobby early ${Date.now()}`;
const OVER_TOPIC = `Lobby over ${Date.now()}`;

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
async function register(role) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`,
    email: `lobby_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  prepareBrowserAccount(res.body.user.id);
  if (role === "teacher") {
    /**
     * Opened explicitly, and only here.
     *
     * `prepareBrowserAccount` deliberately leaves approval and payment shut so that no suite can
     * pass a plan-purchase test by accident. This one is about a clock, not about a gate, so it
     * opens exactly the two gates that stand between a registered teacher and a class.
     */
    sql(`UPDATE teacher_profiles SET approval_status = 'approved', subscription_active = true
          WHERE user_id = ${res.body.user.id}`);
  }
  return res.body;
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

/**
 * Open a classroom link cold, the way a refresh or a shared link does.
 *
 * This used to be impossible. Both classroom screens returned `null` for the wrong role on a line
 * above forty hooks, so on a cold open — before `useAuth` had restored the session — the first
 * render ran three hooks and the next ran forty, and React threw error 310: **"Something went wrong.
 * Please reload the app."** Every API test passed the whole time. Rendering is the only thing
 * that finds it, which is the argument for this file existing.
 */
async function openClassroom(context, token, route) {
  const page = await context.newPage();
  /**
   * Only a real crash counts.
   *
   * A classroom that is not open yet legitimately fails to open its WebSocket, and the browser
   * logs that as a console error. Counting it would make this suite red for the very state it
   * exists to check.
   */
  const crashes = [];
  const isCrash = (text) =>
    /Minified React error|Something went wrong|is not a function|Cannot read (properties|property)/i.test(text);
  page.on("pageerror", (e) => crashes.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && isCrash(m.text())) crashes.push(m.text().slice(0, 200));
  });
  // The key the app itself reads. Same preamble the classroom suite uses.
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), token);
  // Nothing here should reach a camera, and a headless prompt would hang if it tried.
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("blocked in tests"));
    }
  });
  page.on("dialog", (d) => { void d.dismiss(); });
  await page.goto(`${siteUrl}${route}`, { waitUntil: "domcontentloaded" });
  // The app boots, restores the session, asks for a room and settles on the answer.
  await page.waitForTimeout(6000);
  return { page, crashes };
}

const textOf = (page) => page.evaluate(() => document.body.innerText || "");

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const teacher = await register("teacher");
  const student = await register("student");

  // A class tomorrow: booked, paid, and a long way outside its ten-minute door.
  const tomorrow = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: EARLY_TOPIC, subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 26 * 3600_000).toISOString(),
    duration: 60, price: 500, maxStudents: 5 } });
  if (tomorrow.status > 201) throw new Error(`create: ${tomorrow.status} ${JSON.stringify(tomorrow.body)}`);
  const early = tomorrow.body.id;
  await api(`/sessions/${early}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });

  // A class that genuinely finished days ago, to prove the terminal screen still appears.
  const past = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: OVER_TOPIC, subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 3600_000).toISOString(),
    duration: 60, price: 500, maxStudents: 5 } });
  await api(`/sessions/${past.body.id}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  sql(`update sessions set date = now() - interval '3 days' where id = ${past.body.id}`);
  const over = past.body.id;

  const chromium = await getChromium();
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    console.log(`\n  ${viewport.name} — ${viewport.width}×${viewport.height}\n`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      permissions: [],
    });

    /* ---- the teacher, early for their own class ---- */
    {
      const { page, crashes } = await openClassroom(context, teacher.token, `/(teacher)/classroom/${early}`);
      check(`[${viewport.name}] a classroom link opened cold does not crash the app`,
        crashes.length === 0, crashes[0] ?? "");
      const text = await textOf(page);
      check(`[${viewport.name}] the teacher who is early is not told the class expired`,
        !/already expired/i.test(text), text.slice(0, 200));
      check(`[${viewport.name}] and is not offered a replacement class`,
        !/create a new session/i.test(text), text.slice(0, 200));
      check(`[${viewport.name}] they are told it has not opened yet`,
        /has not opened yet/i.test(text), text.slice(0, 200));
      check(`[${viewport.name}] and when it does`, /opens 10 minutes before it starts/i.test(text),
        text.slice(0, 300));
      check(`[${viewport.name}] the lobby is what rendered`,
        (await page.locator('[data-testid="classroom-lobby"], [testid="classroom-lobby"]').count()) > 0 ||
          /has not opened yet/i.test(text));
      check(`[${viewport.name}] and there is a way back`, /go back/i.test(text));
      await page.close();
    }

    /* ---- the teacher, on a class that really is over ---- */
    {
      const { page, crashes } = await openClassroom(context, teacher.token, `/(teacher)/classroom/${over}`);
      check(`[${viewport.name}] and neither does a finished one`, crashes.length === 0, crashes[0] ?? "");
      const text = await textOf(page);
      check(`[${viewport.name}] a class that finished still says so`, /expired|finished|no longer/i.test(text),
        text.slice(0, 200));
      check(`[${viewport.name}] and still offers a replacement, which is right here`,
        /create a new session/i.test(text), text.slice(0, 200));
      check(`[${viewport.name}] and does not offer a lobby for it`, !/has not opened yet/i.test(text));
      await page.close();
    }

    /* ---- the student, early for a class they paid for ---- */
    {
      const { page, crashes } = await openClassroom(context, student.token, `/(student)/classroom/${early}`);
      check(`[${viewport.name}] the student's classroom link survives a cold open too`,
        crashes.length === 0, crashes[0] ?? "");
      const text = await textOf(page);
      check(`[${viewport.name}] the paid student who is early is told when it opens`,
        /opens 10 minutes before it starts/i.test(text), text.slice(0, 300));
      check(`[${viewport.name}] and is never told they are not enrolled`,
        !/must be enrolled/i.test(text), text.slice(0, 200));
      check(`[${viewport.name}] and is not shown an ending`, !/has finished/i.test(text),
        text.slice(0, 200));
      await page.close();
    }

    await context.close();
  }

  await browser.close();
  try { server.kill(); } catch { /* gone */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
