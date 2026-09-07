/**
 * A teacher and a student, in two real browsers, in one live class.
 *
 * ## What this is for
 *
 * Every other suite around the classroom floor tests one layer. This one tests that they are
 * joined up: a student taps a button in the built app, the frame goes over a real WebSocket to a
 * real server, the server authorises it against a real database, and the *teacher's* screen — a
 * separate browser — shows a raised hand. Nothing is faked between the two.
 *
 * That path is the thing a green unit suite cannot promise. It is also the exact failure this
 * project has had before: a rule that was right and a screen that never asked it. The rules were
 * correct and the buttons were not wired, and both halves passed their own tests.
 *
 * ## What it deliberately does not prove
 *
 * That media flows. Neither browser joins the LiveKit room — that needs cameras, and
 * `scripts/livekit-live` already does it. The API is pointed at a real `livekit-server` so
 * `moderatesPublishing` is true and the permission push goes somewhere real, but the participants
 * are not in that room, so the push finds nobody. That is a truthful outcome the server is written
 * to tolerate, and the exact shape of the request it sends is asserted by
 * `api-server/scripts/floor-tests` against a recording stub.
 *
 * Needs a built app and an API running with LiveKit configured:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:floor-live
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.FLOOR_LIVE_PORT ?? 8087);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`   PASS  ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`   FAIL  ${n}${d ? ` — ${d}` : ""}`); }
};

const sql = (statement) => execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" }).trim();

async function api(p, { method = "GET", token, body } = {}) {
  /*
    The platform header, because the room route reads it.

    A browser gets whatever `VIDEO_PROVIDER` names and a phone gets Daily regardless — both SDKs
    ship the same native WebRTC library and cannot be in one phone build. A caller that sends no
    header is treated as a phone, which is the safe default and is why the precondition check
    below reported `provider=daily` until this was added. The browsers in this suite send it
    themselves; this is for the setup calls made outside them.
  */
  const headers = { "Content-Type": "application/json", "X-Fadko-Platform": "web" };
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
    name: `${role === "teacher" ? "Floor Teacher" : "Floor Student"} ${seq}`,
    email: `fl_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  prepareBrowserAccount(res.body.user.id);
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

/** Poll until a locator appears, so a slow socket is a wait rather than a failure. */
async function waitFor(page, testId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.locator(`[data-testid="${testId}"]`).count()) > 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  console.log("\nA teacher and a student, in one live class\n");

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved', subscription_active = true where user_id = ${teacher.user.id}`);
  const student = await register("student");

  // Starting shortly, so the doors are open and the class can be started for real.
  const made = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Raise your hand", subject: "Mathematics", description: "d",
    date: new Date(Date.now() + 2 * 60_000).toISOString(),
    // A real price: the API refuses a free class, and booking is atomic with no pending state,
    // so the student's place is paid for the moment `/book` returns. Payments run in simulated
    // mode here, which is what `NODE_ENV=test` on the API is for.
    duration: 60, price: 500, maxStudents: 20 } });
  if (made.status > 201) throw new Error(`could not create the class: ${made.status} ${JSON.stringify(made.body)}`);
  const sessionId = made.body.id;

  const booked = await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: {} });
  check("the student can book the class", booked.status <= 201, `${booked.status} ${JSON.stringify(booked.body)}`);

  /*
    The one precondition worth asserting out loud.

    The whole floor hides itself where the provider cannot decide who publishes. If the API under
    test is on Daily, every check below would fail for a reason that has nothing to do with the
    code — so it is said here, once, rather than discovered eight failures later.
  */
  const room = await api(`/sessions/${sessionId}/room`, { token: teacher.token });
  const canModerate = room.body?.capabilities?.moderatesPublishing === true;
  check("the class's video can decide who publishes", canModerate,
    `provider=${room.body?.provider} — start the API with VIDEO_PROVIDER=livekit and LiveKit credentials`);
  if (!canModerate) {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    for (const f of failures) console.log(`  - ${f}`);
    stopServer();
    process.exit(1);
  }

  const chromium = await getChromium();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  const open = async (token, viewport, url) => {
    const ctx = await browser.newContext({ viewport, permissions: [] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), token);
    await page.goto(`${siteUrl}${url}`);
    return { ctx, page, errors };
  };

  const t = await open(teacher.token, { width: 1440, height: 900 }, `/(teacher)/classroom/${sessionId}`);
  const s = await open(student.token, { width: 390, height: 844 }, `/(student)/classroom/${sessionId}`);

  console.log("[1] Both classrooms open before the class starts, and both draw a floor");
  /*
    Opened *before* the teacher presses start, which is the ordinary case: doors are open ten
    minutes early and students gather. It is also the case a first version of this suite skipped,
    and skipping it hid a real bug — starting a class broadcast `floor_ended`, so everybody already
    in the lobby lost their controls for the rest of the lesson with nothing to bring them back.
  */
  check("the teacher's strip is there", await waitFor(t.page, "teacher-floor"));
  check("the student's strip is there", await waitFor(s.page, "student-floor"));
  check("the student is offered a way to ask", (await s.page.locator('[data-testid="student-floor-ask"]').count()) === 1);

  console.log("\n[1b] The teacher starts the class, and nobody's controls vanish");
  const started = await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
  check("the teacher can start it", started.status === 200, `${started.status} ${JSON.stringify(started.body)}`);
  await s.page.waitForTimeout(1500);
  check("the student waiting in the lobby still has a floor",
    (await s.page.locator('[data-testid="student-floor-ask"]').count()) === 1,
    "starting the class took the controls away from everybody already in the room");
  check("and so does the teacher", (await t.page.locator('[data-testid="teacher-floor"]').count()) === 1);

  console.log("\n[2] The student raises a hand, and the teacher sees it");
  await s.page.locator('[data-testid="student-floor-ask"]').click();
  check("the teacher's badge appears", await waitFor(t.page, "teacher-floor-hands"),
    "the socket did not carry the request to the other browser");
  const waiting = await s.page.locator('[data-testid="student-floor-body"]').first().innerText().catch(() => "");
  check("and the student is told where they are", /next|in line/i.test(waiting), waiting);

  console.log("\n[3] The teacher lets them speak");
  await t.page.locator('[data-testid="teacher-floor-participants"]').click();
  check("the class list opens", await waitFor(t.page, "participant-sheet"));
  const rowId = `participant-${student.user.id}-allow-mic`;
  check("the student is listed with the three answers", await waitFor(t.page, rowId),
    `no ${rowId} — the roster did not reach the teacher's screen`);
  await t.page.locator(`[data-testid="${rowId}"]`).click();

  check("the student is told they may speak", await waitFor(s.page, "student-floor-accept-mic"),
    "the grant did not come back down the student's socket");
  const invited = await s.page.locator('[data-testid="student-floor-title"]').first().innerText().catch(() => "");
  check("and it reads as their teacher asking them, not as a setting changing",
    /asked you to speak/i.test(invited), invited);

  console.log("\n[4] The student accepts, and the class agrees about it");
  await s.page.locator('[data-testid="student-floor-accept-mic"]').click();
  await s.page.waitForTimeout(1200);
  const mine = await s.page.locator('[data-testid="student-floor-title"]').first().innerText().catch(() => "");
  check("the student's own screen says they are speaking", /you're speaking/i.test(mine), mine);
  const onTeacher = await t.page.locator(`[data-testid="participant-state-${student.user.id}"]`).first().innerText().catch(() => "");
  check("and the teacher's list says the same thing", /speaking/i.test(onTeacher), onTeacher);

  console.log("\n[5] The teacher turns them off");
  await t.page.locator(`[data-testid="participant-${student.user.id}-mute"]`).click();
  await s.page.waitForTimeout(1200);
  const muted = await s.page.locator('[data-testid="student-floor-title"]').first().innerText().catch(() => "");
  check("the student is told who turned their microphone off",
    /your teacher turned/i.test(muted), muted);
  check("and never as an unexplained setting", !/muted by moderator/i.test(muted), muted);

  console.log("\n[6] A pay-as-you-go class has no discussion to offer");
  check("no discussion control is drawn",
    (await t.page.locator('[data-testid="teacher-floor-discussion"]').count()) === 0,
    "a permanently greyed button is a promise the product does not keep");

  console.log("\n[7] It is written down");
  // The log is fire-and-forget on the server; give it a moment to land.
  await t.page.waitForTimeout(800);
  const asks = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.ask'`));
  check("the raised hand is in the record", asks === 1, String(asks));
  const allows = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.allow' and user_id = ${teacher.user.id}`));
  check("so is the teacher's decision, against the teacher's own account", allows === 1, String(allows));
  const mutes = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.mute'`));
  check("and so is the mute", mutes === 1, String(mutes));

  console.log("\n[8] Nothing threw on either screen");
  check("no page error in the teacher's browser", t.errors.length === 0, t.errors[0] ?? "");
  check("no page error in the student's browser", s.errors.length === 0, s.errors[0] ?? "");

  await t.ctx.close();
  await s.ctx.close();
  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length) for (const f of failures) console.log(`  - ${f}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
