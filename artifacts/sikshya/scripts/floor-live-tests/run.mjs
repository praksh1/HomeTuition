/**
 * A teacher and two students, in three real browsers, in one live class.
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
 * ## Why two students rather than one
 *
 * Because one student cannot catch the bug this suite was extended for. Starting a class used to
 * clear the roster and rebuild nothing, so a teacher's class list was empty the moment their
 * lesson began — and "Mute all" reached nobody while looking as though it had worked. With a
 * single student who raises a hand, the row is rebuilt by the raised hand itself and the hole
 * never shows. So: two students, both named, both sitting
 * in the lobby, neither of whom reconnects and neither of whom raises a hand before the class
 * starts. That is the shape the failure needs to be visible.
 *
 * ## What it proves about the provider, and what it does not
 *
 * The browsers **do** join the LiveKit room — each classroom screen mounts the real embed against
 * the real `livekit-server`, so a permission push names a participant that is genuinely there and
 * comes back applied. An earlier version of this comment said the opposite and was wrong; it is
 * now asserted rather than assumed, in section 3, because a grant the provider has not confirmed
 * withholds the student's buttons and would fail the checks around it.
 *
 * What it does not prove is that **media flows**: nothing here grants a camera or a microphone to
 * the browser, so no track is ever published. That is `scripts/livekit-live`, with real devices.
 * Nor can it stage the orderings the reconciler is built for — a grant that arrives before the
 * student's media does, two decisions crossing, a stale retry — because those need the provider's
 * answer held open by hand. `api-server/scripts/floor-tests` does exactly that against a recording
 * stub, and is where findings 5 and 6 are proved.
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
/**
 * @param {"teacher"|"student"} role
 * @param {string} [called] the name this person is known by, so a roster check can look for it
 */
async function register(role, called) {
  seq += 1;
  const name = called ?? `${role === "teacher" ? "Floor Teacher" : "Floor Student"} ${seq}`;
  const res = await api("/auth/register", { method: "POST", body: {
    name,
    email: `fl_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Mathematics", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  prepareBrowserAccount(res.body.user.id);
  return { ...res.body, name };
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

/** The text of one element, or "" when it is not on the page. Never throws at a caller. */
const textOf = (page, testId) =>
  page.locator(`[data-testid="${testId}"]`).first().innerText().catch(() => "");

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  console.log("\nA teacher and two students, in one live class\n");

  const teacher = await register("teacher");
  sql(`update teacher_profiles set approval_status = 'approved', subscription_active = true where user_id = ${teacher.user.id}`);
  /*
    Named, and named distinctly.

    The roster check below looks for these exact strings on the teacher's screen. When the name map
    was thrown away at start, every row read the fallback "Student" — so a check that only counted
    rows would have passed on a list of anonymous strangers. Two different names is what makes
    "the teacher can tell which child is which" an assertion rather than an assumption.
  */
  const student = await register("student", "Anjali Gurung");
  const second = await register("student", "Bikash Thapa");

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
  const booked2 = await api(`/sessions/${sessionId}/book`, { method: "POST", token: second.token, body: {} });
  check("and so can a second student", booked2.status <= 201, `${booked2.status} ${JSON.stringify(booked2.body)}`);

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
  const s2 = await open(second.token, { width: 390, height: 844 }, `/(student)/classroom/${sessionId}`);

  /** Open the responsive class list, do something in it, and close it again. */
  const inSheet = async (body) => {
    await t.page.locator('[data-testid="teacher-floor-participants"]').click();
    const deadline = Date.now() + 12000;
    let panelId = null;
    while (Date.now() < deadline) {
      if ((await t.page.locator('[data-testid="participant-drawer"]').count()) > 0) {
        panelId = "participant-drawer";
        break;
      }
      if ((await t.page.locator('[data-testid="participant-sheet"]').count()) > 0) {
        panelId = "participant-sheet";
        break;
      }
      await t.page.waitForTimeout(200);
    }
    if (panelId === null) return false;
    const out = await body(panelId);
    await t.page.locator('[data-testid="participant-sheet-close"]').click();
    await t.page.waitForTimeout(300);
    return out;
  };

  console.log("[1] All three classrooms open before the class starts, and all three draw a floor");
  /*
    Opened *before* the teacher presses start, which is the ordinary case: doors are open ten
    minutes early and students gather. It is also the case a first version of this suite skipped,
    and skipping it hid a real bug — starting a class broadcast `floor_ended`, so everybody already
    in the lobby lost their controls for the rest of the lesson with nothing to bring them back.
  */
  check("the teacher's strip is there", await waitFor(t.page, "teacher-floor"));
  check("the first student's strip is there", await waitFor(s.page, "student-floor"));
  check("the second student's strip is there", await waitFor(s2.page, "student-floor"));
  check("the first student is offered a way to ask", (await s.page.locator('[data-testid="student-floor-ask"]').count()) === 1);
  check("so is the second", (await s2.page.locator('[data-testid="student-floor-ask"]').count()) === 1);

  console.log("\n[1b] The teacher starts the class, and nobody's controls vanish");
  const started = await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
  check("the teacher can start it", started.status === 200, `${started.status} ${JSON.stringify(started.body)}`);
  await s.page.waitForTimeout(1500);
  check("the first student waiting in the lobby still has a floor",
    (await s.page.locator('[data-testid="student-floor-ask"]').count()) === 1,
    "starting the class took the controls away from everybody already in the room");
  check("and so does the second",
    (await s2.page.locator('[data-testid="student-floor-ask"]').count()) === 1);
  check("and so does the teacher", (await t.page.locator('[data-testid="teacher-floor"]').count()) === 1);

  console.log("\n[1c] The teacher's class list holds both students, by name, with nothing having reconnected");
  /*
    The Finding 1 proof, and every clause of it is load-bearing.

    Neither student has raised a hand, reloaded, or dropped and returned since the class started —
    so nothing but `restartFloorFor` can have put these rows back. Before the correction this list
    was empty here, and the two bulk controls below reached nobody.
  */
  const roster = await inSheet(async (panelId) => ({
    first: await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).count(),
    second: await t.page.locator(`[data-testid="participant-row-${second.user.id}"]`).count(),
    text: await textOf(t.page, panelId),
  }));
  check("the class list opens", roster !== false);
  check("the first student is in it", roster && roster.first === 1,
    "the roster was not rebuilt when the class started");
  check("the second student is in it", roster && roster.second === 1,
    "the roster was not rebuilt when the class started");
  check("both are shown by their own names", Boolean(roster && roster.text.includes(student.name) && roster.text.includes(second.name)),
    roster ? roster.text.slice(0, 200) : "no sheet");
  // Tied to the rows actually being there, so an empty list cannot pass this by having no names in
  // it to be wrong about.
  check("and nobody has fallen back to the anonymous 'Student'",
    Boolean(roster && roster.first === 1 && roster.second === 1 && !/\bStudent\b/.test(roster.text)),
    roster ? roster.text.slice(0, 200) : "no sheet");

  console.log("\n[1d] The current microphone-first classroom is what both students see");
  check("the retired Invite all control stays retired",
    (await t.page.locator('[data-testid="teacher-floor-invite-all"]').count()) === 0);
  const firstStart = await textOf(s.page, "student-floor-state");
  const secondStart = await textOf(s2.page, "student-floor-state");
  check("the first student joins with their microphone off", /microphone off/i.test(firstStart), firstStart);
  check("the second student joins with their microphone off", /microphone off/i.test(secondStart), secondStart);
  check("camera status stays out of the compact strip until it is available",
    (await s.page.locator('[data-testid="student-floor-camera"]').count()) === 0);

  console.log("\n[1e] One-student moderation blocks and restores self-unmute");
  const mutedOne = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).click();
    const action = `participant-${student.user.id}-mute`;
    if (!(await waitFor(t.page, action))) return false;
    await t.page.locator(`[data-testid="${action}"]`).click();
    return true;
  });
  check("the teacher can prevent one student from unmuting", mutedOne === true);
  await s.page.waitForTimeout(900);
  check("that student is told the teacher muted them",
    /muted by teacher/i.test(await textOf(s.page, "student-floor-state")),
    await textOf(s.page, "student-floor-state"));
  check("the other student's microphone remains their own choice",
    /microphone off/i.test(await textOf(s2.page, "student-floor-state")),
    await textOf(s2.page, "student-floor-state"));

  const restoredOne = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).click();
    const action = `participant-${student.user.id}-allow-mic`;
    if (!(await waitFor(t.page, action))) return false;
    await t.page.locator(`[data-testid="${action}"]`).click();
    return true;
  });
  check("the teacher can restore that student's self-unmute", restoredOne === true);
  await s.page.waitForTimeout(900);
  check("restoring permission does not open the microphone",
    /microphone off/i.test(await textOf(s.page, "student-floor-state")),
    await textOf(s.page, "student-floor-state"));

  console.log("\n[1f] Mute all reaches every student, and each permission can be restored");
  const mutedAll = await inSheet(async () => {
    const action = t.page.locator('[data-testid="participant-mute-all"]');
    if ((await action.count()) === 0) return false;
    await action.click();
    return true;
  });
  check("mute all stays inside the class list", mutedAll === true);
  await s.page.waitForTimeout(1000);
  check("the first student is blocked",
    /muted by teacher/i.test(await textOf(s.page, "student-floor-state")));
  check("the second student is blocked too",
    /muted by teacher/i.test(await textOf(s2.page, "student-floor-state")));

  const restoredBoth = await inSheet(async () => {
    for (const id of [student.user.id, second.user.id]) {
      await t.page.locator(`[data-testid="participant-row-${id}"]`).click();
      const action = `participant-${id}-allow-mic`;
      if (!(await waitFor(t.page, action))) return false;
      await t.page.locator(`[data-testid="${action}"]`).click();
      await t.page.waitForTimeout(350);
    }
    return true;
  });
  check("the teacher can restore both microphone permissions", restoredBoth === true);
  await s.page.waitForTimeout(900);
  check("the first stays muted by themselves after permission returns",
    /microphone off/i.test(await textOf(s.page, "student-floor-state")));
  check("the second stays muted by themselves after permission returns",
    /microphone off/i.test(await textOf(s2.page, "student-floor-state")));

  console.log("\n[2] The student raises a hand, and the teacher sees it");
  await s.page.locator('[data-testid="student-floor-ask"]').click();
  check("the teacher's badge appears", await waitFor(t.page, "teacher-floor-hands"),
    "the socket did not carry the request to the other browser");
  check("the student's control becomes Lower hand", await waitFor(s.page, "student-floor-cancel-ask"));
  const waiting = await textOf(s.page, "student-floor-state");
  check("and the student sees their hand is up", /hand up/i.test(waiting), waiting);

  console.log("\n[3] The teacher answers the hand with separate camera permission");
  const cameraAllowed = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).click();
    const action = `participant-${student.user.id}-allow-camera`;
    if (!(await waitFor(t.page, action))) return false;
    await t.page.locator(`[data-testid="${action}"]`).click();
    await t.page.waitForTimeout(1100);
    return (await t.page.locator(`[data-testid="participant-provider-${student.user.id}"]`).count()) === 0;
  });
  check("the teacher can acknowledge the hand and allow camera", cameraAllowed === true,
    "the permission did not settle with LiveKit");
  await s.page.waitForTimeout(900);
  check("the hand is cleared without another consent dialog", await waitFor(s.page, "student-floor-ask"));
  check("camera is now available to the student",
    /camera available/i.test(await textOf(s.page, "student-floor-camera")),
    await textOf(s.page, "student-floor-camera"));
  check("the microphone remains off until the student chooses otherwise",
    /microphone off/i.test(await textOf(s.page, "student-floor-state")));

  console.log("\n[4] Camera permission can be removed without changing microphone permission");
  const cameraStopped = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).click();
    const action = `participant-${student.user.id}-stop-camera`;
    if (!(await waitFor(t.page, action))) return false;
    await t.page.locator(`[data-testid="${action}"]`).click();
    return true;
  });
  check("the teacher can remove camera access", cameraStopped === true);
  await s.page.waitForTimeout(900);
  check("camera status leaves the compact strip after access is removed",
    (await s.page.locator('[data-testid="student-floor-camera"]').count()) === 0);
  check("microphone permission remains available",
    /microphone off/i.test(await textOf(s.page, "student-floor-state")));

  console.log("\n[5] A later teacher mute is still explicit and reversible");
  const mutedAgain = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).click();
    const action = `participant-${student.user.id}-mute`;
    if (!(await waitFor(t.page, action))) return false;
    await t.page.locator(`[data-testid="${action}"]`).click();
    return true;
  });
  check("the teacher can block self-unmute again", mutedAgain === true);
  await s.page.waitForTimeout(900);
  check("the student sees Muted by teacher",
    /muted by teacher/i.test(await textOf(s.page, "student-floor-state")));
  const restoredAgain = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).click();
    const action = `participant-${student.user.id}-allow-mic`;
    if (!(await waitFor(t.page, action))) return false;
    await t.page.locator(`[data-testid="${action}"]`).click();
    return true;
  });
  check("the teacher can restore self-unmute again", restoredAgain === true);

  console.log("\n[6] A pay-as-you-go class has no discussion to offer");
  check("no discussion control is drawn",
    (await t.page.locator('[data-testid="teacher-floor-discussion"]').count()) === 0,
    "a permanently greyed button is a promise the product does not keep");

  console.log("\n[7] It is written down");
  // The log is fire-and-forget on the server; give it a moment to land.
  await t.page.waitForTimeout(800);
  const countOf = (action, extra = "") => Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = '${action}'${extra}`));
  check("the raised hand is in the record", countOf("classroom.floor.ask") === 1,
    String(countOf("classroom.floor.ask")));
  const allows = countOf("classroom.floor.allow", ` and user_id = ${teacher.user.id}`);
  check("each restored or expanded permission is recorded against the teacher", allows === 5, String(allows));
  check("and so are both individual mutes",
    countOf("classroom.floor.mute") === 2, String(countOf("classroom.floor.mute")));
  check("the retired whole-room invitation is never emitted",
    countOf("classroom.floor.invite_all") === 0, String(countOf("classroom.floor.invite_all")));
  check("and so is the whole-room mute", countOf("classroom.floor.mute_all") === 1,
    String(countOf("classroom.floor.mute_all")));
  check("camera removal is recorded separately",
    countOf("classroom.floor.stop_camera") === 1, String(countOf("classroom.floor.stop_camera")));

  console.log("\n[7b] And the audit record does not invent speech from permissions");
  /*
    These browsers have no device permission, so nobody can publish a track. Permission changes
    must not become evidence that somebody spoke or even held an open microphone. The separate
    real-media suite proves track publication and revocation with virtual devices.
  */
  const held = countOf("classroom.floor.held");
  check("no microphone hold is invented", held === 0, String(held));
  const spoke = countOf("classroom.floor.spoke");
  check("no speech is invented either", spoke === 0, String(spoke));

  console.log("\n[8] Nothing threw on any screen");
  check("no page error in the teacher's browser", t.errors.length === 0, t.errors[0] ?? "");
  check("no page error in the first student's browser", s.errors.length === 0, s.errors[0] ?? "");
  check("no page error in the second student's browser", s2.errors.length === 0, s2.errors[0] ?? "");

  await t.ctx.close();
  await s.ctx.close();
  await s2.ctx.close();
  await browser.close();
  stopServer();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length) for (const f of failures) console.log(`  - ${f}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
