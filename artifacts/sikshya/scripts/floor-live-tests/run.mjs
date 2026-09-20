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
 * lesson began — and "Invite all" and "Mute all" iterate that list, so both reached nobody while
 * looking as though they had worked. With a single student who raises a hand, the row is rebuilt
 * by the raised hand itself and the hole never shows. So: two students, both named, both sitting
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

  /** Open the class list, do something in it, and close it again. */
  const inSheet = async (body) => {
    await t.page.locator('[data-testid="teacher-floor-participants"]').click();
    const there = await waitFor(t.page, "participant-sheet");
    if (!there) return false;
    const out = await body();
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
  const roster = await inSheet(async () => ({
    first: await t.page.locator(`[data-testid="participant-row-${student.user.id}"]`).count(),
    second: await t.page.locator(`[data-testid="participant-row-${second.user.id}"]`).count(),
    text: await textOf(t.page, "participant-sheet"),
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

  console.log("\n[1d] Invite all reaches every student who was already in the room");
  await t.page.locator('[data-testid="teacher-floor-invite-all"]').click();
  check("the first student is asked to speak", await waitFor(s.page, "student-floor-accept-mic"),
    "Invite all reached nobody — the floor had no students to iterate");
  check("the second student is asked to speak", await waitFor(s2.page, "student-floor-accept-mic"),
    "Invite all reached only some of the room");
  const inviteText = await textOf(s2.page, "student-floor-title");
  check("and it reads as their teacher asking them", /asked you to speak/i.test(inviteText), inviteText);

  await s.page.locator('[data-testid="student-floor-accept-mic"]').click();
  await s2.page.locator('[data-testid="student-floor-accept-mic"]').click();
  await t.page.waitForTimeout(1500);
  /*
    The badge shows a bare number and says the whole sentence to a screen reader, so both are read.
    Checking only the visible text would have matched "2" from a badge that meant something else.

    The digits are pulled out rather than the text trimmed: `innerText` here begins with the Feather
    icon's own glyph — a private-use character, U+F19F — which is not whitespace and survives
    `trim()`. It also prints as nothing at all in a terminal, so the comparison failed against a
    string that looked identical to the one expected.
  */
  const speakingCount = (await textOf(t.page, "teacher-floor-speaking")).replace(/\D+/g, "");
  const speakingSpoken = await t.page
    .locator('[data-testid="teacher-floor-speaking"]')
    .first()
    .getAttribute("aria-label")
    .catch(() => "");
  check("the teacher's strip counts both of them speaking",
    speakingCount === "2" && /2 speaking/i.test(speakingSpoken ?? ""),
    `visible=${JSON.stringify(speakingCount)} spoken=${JSON.stringify(speakingSpoken)}`);

  console.log("\n[1e] Mute all reaches every student too");
  // Held for over a second before being stopped, so the record below has something to hold.
  await t.page.waitForTimeout(1200);
  await t.page.locator('[data-testid="teacher-floor-mute-all"]').click();
  await s.page.waitForTimeout(1500);
  const mutedFirst = await textOf(s.page, "student-floor-title");
  const mutedSecond = await textOf(s2.page, "student-floor-title");
  check("the first student's microphone is turned off", /your teacher turned/i.test(mutedFirst), mutedFirst);
  check("the second student's is too", /your teacher turned/i.test(mutedSecond), mutedSecond);

  console.log("\n[1f] Both are put back to listening, so the rest of the lesson starts clean");
  const returned = await inSheet(async () => {
    await t.page.locator(`[data-testid="participant-${student.user.id}-return"]`).click();
    await t.page.waitForTimeout(400);
    await t.page.locator(`[data-testid="participant-${second.user.id}-return"]`).click();
    await t.page.waitForTimeout(400);
    return true;
  });
  check("the teacher can take both turns back", returned === true);
  await s.page.waitForTimeout(1200);
  check("the first student can ask again", await waitFor(s.page, "student-floor-ask"));
  check("and so can the second", await waitFor(s2.page, "student-floor-ask"));

  console.log("\n[2] The student raises a hand, and the teacher sees it");
  await s.page.locator('[data-testid="student-floor-ask"]').click();
  check("the teacher's badge appears", await waitFor(t.page, "teacher-floor-hands"),
    "the socket did not carry the request to the other browser");
  const waiting = await textOf(s.page, "student-floor-body");
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
  const invited = await textOf(s.page, "student-floor-title");
  check("and it reads as their teacher asking them, not as a setting changing",
    /asked you to speak/i.test(invited), invited);

  /*
    The grant reached a real SFU and a real participant, and the class was told so.

    Worth asserting out loud rather than inferred from the sentence above. A grant the provider has
    not confirmed now withholds those buttons and says "Switching your microphone on…" instead, so
    the invitation being drawn at all means `livekit-server` accepted `updateParticipant` for a
    participant that was actually in the room — which is only true because both browsers really do
    join it. The file header used to claim they did not.
  */
  check("the teacher's row shows nothing outstanding against the provider",
    (await t.page.locator(`[data-testid="participant-provider-${student.user.id}"]`).count()) === 0,
    await textOf(t.page, `participant-provider-${student.user.id}`));

  console.log("\n[4] The student accepts, and the class agrees about it");
  await s.page.locator('[data-testid="student-floor-accept-mic"]').click();
  await s.page.waitForTimeout(1200);
  const mine = await textOf(s.page, "student-floor-title");
  check("the student's own screen says they are speaking", /you're speaking/i.test(mine), mine);
  const onTeacher = await textOf(t.page, `participant-state-${student.user.id}`);
  check("and the teacher's list says the same thing", /speaking/i.test(onTeacher), onTeacher);

  console.log("\n[5] The teacher turns them off");
  await t.page.locator(`[data-testid="participant-${student.user.id}-mute"]`).click();
  await s.page.waitForTimeout(1200);
  const muted = await textOf(s.page, "student-floor-title");
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
  const countOf = (action, extra = "") => Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = '${action}'${extra}`));
  check("the raised hand is in the record", countOf("classroom.floor.ask") === 1,
    String(countOf("classroom.floor.ask")));
  const allows = countOf("classroom.floor.allow", ` and user_id = ${teacher.user.id}`);
  check("so is the teacher's decision, against the teacher's own account", allows === 1, String(allows));
  check("and so is the mute", countOf("classroom.floor.mute") === 1, String(countOf("classroom.floor.mute")));
  check("the whole-room invitation is one line, not one per student",
    countOf("classroom.floor.invite_all") === 1, String(countOf("classroom.floor.invite_all")));
  check("and so is the whole-room mute", countOf("classroom.floor.mute_all") === 1,
    String(countOf("classroom.floor.mute_all")));
  check("each turn taken back is its own line", countOf("classroom.floor.return_audience") === 2,
    String(countOf("classroom.floor.return_audience")));

  console.log("\n[7b] And what it says about speech is what the app can actually prove");
  /*
    Finding 3, checked against the database a support agent would actually read.

    Two students held a microphone for over a second each, so there are rows here. What matters is
    what they are called and what they claim: `classroom.floor.held` and `speechConfirmed: false`.
    Nothing in this build observes a published audio track, so a row asserting that speech occurred
    would be a number a refund decision could rest on and the app cannot support.
  */
  const held = countOf("classroom.floor.held");
  check("holding the floor is recorded", held >= 2, String(held));
  const spoke = countOf("classroom.floor.spoke");
  check("and never under a name that claims speech happened", spoke === 0, String(spoke));
  const unconfirmed = Number(sql(`select count(*) from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.held'
      and detail->>'speechConfirmed' = 'false'`));
  check("every row says outright that speech is unconfirmed", unconfirmed === held,
    `${unconfirmed} of ${held}`);
  const basis = sql(`select distinct detail->>'basis' from activity_log
    where subject_id = ${sessionId} and action = 'classroom.floor.held'`);
  check("and says what it was measured from", basis === "permission_and_consent", basis);

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
