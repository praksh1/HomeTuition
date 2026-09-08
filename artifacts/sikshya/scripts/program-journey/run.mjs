/**
 * One teacher, one program, one real server — the journey the component harness cannot prove.
 *
 * `scripts/program-studio/run.mjs` renders the studio's components against props and proves what is
 * *drawn*. This proves what the **screens** do, which is where the three defects Codex found lived:
 * the save callback comparing against a stale closure, lifecycle actions running over unsaved text,
 * and a leave guard that existed as a tested function nobody called. Every one of them is invisible
 * to a component test, because none of them is about a component.
 *
 * So this drives the built web app, signed in as a real teacher, against a real API and a real
 * database. The one thing that is not real is *timing*: `page.route` holds the save request open on
 * command, because "type during a slow PATCH" is the whole point and a slow connection cannot be
 * waited for.
 *
 * Needs a built app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run test:program-journey
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.PROGRAM_JOURNEY_PORT ?? 8091);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const sql = (statement) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", statement], { encoding: "utf8" }).trim();

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function registerTeacher() {
  const email = `program_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: "Program Journey Teacher", email, password: "password123", role: "teacher",
    subject: "Mathematics", bio: "Teaches Grade 10 mathematics.",
  } });
  if (res.status > 201) throw new Error(`register: ${res.status} ${JSON.stringify(res.body)}`);
  prepareBrowserAccount(res.body.user.id);
  // Publication needs an approved account. Set explicitly rather than relying on registration, so
  // this suite cannot pass because approval leaked into the default state.
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${res.body.user.id}`);
  return res.body;
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first:");
  console.error("  EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build");
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

/** Waits for a condition rather than a duration, so a slow container does not make this flaky. */
async function until(what, fn, ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const teacher = await registerTeacher();
  const chromium = await getChromium();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), teacher.token);

  const seen = (id) => page.locator(`[data-testid="${id}"]`).count().then((n) => n > 0);
  const read = (id) => page.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "");
  const chip = () => read("program-studio-save");

  /**
   * Holds the next PATCH open until it is let go.
   *
   * Everything about blocking finding 1 happens *between* a save leaving and its answer arriving,
   * which is a window of a few milliseconds against a local server. This makes the window as long
   * as the test needs.
   */
  let release = null;
  let holdFor = null;
  let patches = 0;
  /** Every learning-program write the page made, in order, as "METHOD /path". */
  const writes = [];
  await page.route("**/api/learning-programs**", async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fallback();
    writes.push(`${method} ${new URL(route.request().url()).pathname}`);
    if (method === "PATCH") patches += 1;
    if (!release || (holdFor && holdFor !== method)) return route.fallback();
    const go = release;
    release = null;
    holdFor = null;
    await go(); // resolves when the test says this request may reach the server
    return route.fallback();
  });
  /**
   * Holds the next write of `method` open until the returned handle is called.
   *
   * Every race in this screen happens between a request leaving and its answer arriving, which is a
   * few milliseconds against a local server. This makes that window as long as the test needs.
   */
  const holdNext = (method) => {
    let letGo;
    const held = new Promise((resolve) => { letGo = resolve; });
    release = () => held;
    holdFor = method;
    return () => letGo();
  };
  const holdNextSave = () => holdNext("PATCH");

  /* ------------------------------------------------------------------ create */

  console.log("\nCreating a program");

  await page.goto(`${siteUrl}/programs`, { waitUntil: "networkidle" });
  check("the teacher's program list opens", await until("list", () => seen("program-home")));
  check("with an honest empty state rather than an invented one", await seen("program-home-empty"));

  await page.locator('[data-testid="program-home-create-first"]').click();
  check("the chooser opens", await until("chooser", () => seen("program-type-chooser")));

  const cards = await page.locator('[data-testid^="program-type-"]').count();
  check("the chooser drew only what the server offers",
    (await seen("program-type-school_subject")) && (await seen("program-type-custom")),
    `${cards} cards`);
  /*
    The server's own answer, asked for directly, and compared with what the screen drew. A
    hard-coded list would agree with a hard-coded expectation forever; this fails the day the API
    stops offering one of them.
  */
  const templates = await api("/learning-programs/templates", { token: teacher.token });
  const offered = templates.body.templates.map((t) => t.type).sort();
  const drawn = (await page.locator('[data-testid^="program-type-"]').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-testid"))))
    .filter((id) => !["program-type-chooser", "program-type-back", "program-type-none", "program-type-failure"].includes(id))
    .map((id) => id.replace("program-type-", ""))
    .sort();
  check("and drew exactly the server's list, not a list of its own",
    offered.length > 0 && JSON.stringify(drawn) === JSON.stringify(offered),
    `drew [${drawn}] / server [${offered}] (status ${templates.status})`);
  const chooserBack = await page.locator('[data-testid="program-type-back"]').boundingBox();
  check("the chooser has an immediately visible thumb-sized Back to Programs control",
    chooserBack && chooserBack.height >= 44 && chooserBack.y < 844,
    JSON.stringify(chooserBack));

  await page.locator('[data-testid="program-type-school_subject"]').click();
  check("choosing a kind opens the studio", await until("studio", () => seen("program-studio")), await read("program-studio"));

  const programId = Number(sql(`select id from learning_programs where teacher_id = ${teacher.user.id} order by id desc limit 1`));
  check("and the server has exactly one program for this teacher",
    Number(sql(`select count(*) from learning_programs where teacher_id = ${teacher.user.id}`)) === 1);
  const studioBack = await page.locator('[data-testid="program-studio-back"]').boundingBox();
  check("the studio has an immediately visible thumb-sized Back to Programs control",
    studioBack && studioBack.height >= 44 && studioBack.y < 844,
    JSON.stringify(studioBack));
  const titleExample = await read("program-example-title");
  check("field examples are visible before typing", titleExample.startsWith("Example:"), titleExample);

  /* ------------------------------------------- the stale response, in the flesh */

  console.log("\nTyping while a save is in flight");

  const titleBox = page.locator('[data-testid="program-input-title"]');
  await titleBox.fill("Grade 10 Mathematics");
  check("field examples remain visible after typing", (await read("program-example-title")) === titleExample);
  check("typing marks the draft unsaved", (await chip()) === "Unsaved changes", await chip());

  const letSaveFinish = holdNextSave();
  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("pressing Save says Saving, not Saved", await until("saving", async () => (await chip()) === "Saving…"), await chip());

  // The whole point: a second sentence typed while the first save is still out.
  await titleBox.fill("Grade 10 Mathematics, term by term");

  /*
    Waited for the response itself, not for the chip to look settled.

    The first version of this polled until the chip read "Unsaved changes" — which the *typing*
    above had already made true, so it returned before the response existed and the assertion below
    passed against a state nothing had tested yet. Restoring the bug proved it: the check stayed
    green and only two later ones went red. A test that agrees with the broken code is worse than
    no test, so this holds until the PATCH has actually come back.
  */
  const answered = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().includes("/learning-programs/"),
    { timeout: 20000 },
  );
  letSaveFinish();
  await answered;
  await until("applied", async () => (await chip()) !== "Saving…");

  /*
    The old response has now returned, carrying the older title. Before the fix it executed
    `draftDiffers(draft, answer)` against the draft captured when the request began — which matched
    — and wrote "Saved" over work the server had never been sent.
  */
  check("and an older response does not call the newer typing saved",
    (await chip()) === "Unsaved changes", await chip());
  check("the newer words are still on screen", (await titleBox.inputValue()) === "Grade 10 Mathematics, term by term",
    await titleBox.inputValue());
  const stored = sql(`select coalesce(title, '(null)') from learning_programs where id = ${programId}`);
  check("and the server still holds only the older title", stored === "Grade 10 Mathematics",
    `id ${programId} holds ${JSON.stringify(stored)}`);

  /* ------------------------------------------------------- nothing over dirt */

  console.log("\nWhat cannot run while the screen is ahead of the server");

  check("Publish is not on the screen while work is unsaved", !(await seen("program-publish")));
  check("and the reason is", await seen("program-actions-blocked"));
  const before = Number(sql(`select version from learning_programs where id = ${programId}`));
  check("no publication has happened", before === 0, String(before));

  /* --------------------------------------------------------- leaving is guarded */

  console.log("\nLeaving with work at risk");

  await page.locator('[data-testid="program-studio-back"]').click();
  check("the Back link asks before leaving", await until("ask", () => seen("program-leave-confirm")));
  check("and is still on the studio, not the list", await seen("program-studio"));
  /*
    Present in the page is not the same as seen by the teacher.

    The question was first written at the foot of the studio — four thousand points below the Back
    link on a phone. Every DOM assertion passed while a teacher would have tapped Back, watched
    nothing move, and tapped it again.
  */
  const question = page.locator('[data-testid="program-leave-confirm"]');
  const inView = await question.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.top < window.innerHeight && box.bottom > 0;
  });
  check("and the question is where the teacher is looking", inView,
    JSON.stringify(await question.boundingBox()));
  await page.locator('[data-testid="program-leave-cancel"]').click();
  check("keeping editing puts the question away", await until("gone", async () => !(await seen("program-leave-confirm"))));
  check("and the typing survived it", (await titleBox.inputValue()) === "Grade 10 Mathematics, term by term");

  /* --- the browser's own Back button -------------------------------------- */

  /*
    The one the first attempt missed, and said so.

    Expo Router is a single page: Back fires `popstate`, the router swaps the screen, and neither
    `beforeunload` nor React Navigation's `beforeRemove` sees it. This is a real `page.goBack()`,
    which is the only way to know.

    The studio was reached by pressing New program on the list, so there is genuine history behind
    it: /programs → /programs/new → /programs/<id>.
  */
  console.log("\nThe browser's Back button");

  const wasAt = await page.evaluate(() => location.pathname);
  const depth = await page.evaluate(() => window.history.length);
  await page.goBack();
  await page.waitForTimeout(500);
  check("Back does not leave the studio while work is unsaved",
    (await page.evaluate(() => location.pathname)) === wasAt,
    await page.evaluate(() => location.pathname));
  check("and it asks", await until("ask", () => seen("program-leave-confirm")),
    `history was ${depth} deep, now ${await page.evaluate(() => window.history.length)}`);
  check("the studio is still on screen behind the question", await seen("program-studio"));

  await page.locator('[data-testid="program-leave-cancel"]').click();
  check("keeping editing puts that question away too",
    await until("gone", async () => !(await seen("program-leave-confirm"))));
  check("and the typing is still there",
    (await titleBox.inputValue()) === "Grade 10 Mathematics, term by term",
    await titleBox.inputValue());

  // Again, and this time agree to go. The original press must complete: one step back from where
  // the teacher was, not a jump to somewhere the app chose.
  await page.goBack();
  await page.waitForTimeout(500);
  check("a second Back is caught too, so the guard re-armed",
    await until("ask", () => seen("program-leave-confirm")));
  await page.locator('[data-testid="program-leave-discard"]').click();
  check("agreeing completes the navigation the teacher asked for",
    await until("left", async () => (await page.evaluate(() => location.pathname)) !== wasAt),
    await page.evaluate(() => location.pathname));

  // Back into the studio, clean this time.
  await page.goto(`${siteUrl}/programs/${programId}`, { waitUntil: "networkidle" });
  check("the studio reopens", await until("studio", () => seen("program-studio")));
  check("with the older title, which is what the server has",
    (await page.locator('[data-testid="program-input-title"]').inputValue()) === "Grade 10 Mathematics",
    await page.locator('[data-testid="program-input-title"]').inputValue());
  check("and nothing unsaved", (await chip()) === "All changes saved", await chip());

  await page.goBack();
  await page.waitForTimeout(600);
  check("clean work goes back with no question at all",
    !(await seen("program-leave-confirm")) && (await page.evaluate(() => location.pathname)) !== `/programs/${programId}`,
    await page.evaluate(() => location.pathname));

  /* --- reload, which no sheet of ours can cover ----------------------------- */

  await page.goto(`${siteUrl}/programs/${programId}`, { waitUntil: "networkidle" });
  await until("studio", () => seen("program-studio"));
  const title2 = page.locator('[data-testid="program-input-title"]');
  await title2.fill("Grade 10 Mathematics, term by term");
  check("dirty again", await until("dirty", async () => (await chip()) === "Unsaved changes"), await chip());

  /*
    A real reload, and a real dialog.

    Playwright auto-dismisses `beforeunload`, so what is asserted is that the browser *raised* one —
    which it only does when a listener called `preventDefault`. The earlier version of this test
    dispatched a synthetic event and checked `defaultPrevented`, which proves a listener exists and
    nothing about whether the browser would act on it. Codex was right to reject that.
  */
  let dialogs = 0;
  const onDialog = (d) => { dialogs += 1; void d.dismiss(); };
  page.on("dialog", onDialog);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(500);
  page.off("dialog", onDialog);
  check("reloading raises the browser's own leave dialog", dialogs > 0, `${dialogs} dialogs`);

  // The reload threw the unsaved edit away, which is what it is for. Type it again so the rest of
  // the journey starts where it did before this section was added.
  await page.goto(`${siteUrl}/programs/${programId}`, { waitUntil: "networkidle" });
  await until("studio", () => seen("program-studio"));
  await titleBox.fill("Grade 10 Mathematics, term by term");
  await until("dirty", async () => (await chip()) === "Unsaved changes");

  /* --------------------------------------------------------------- save, then publish */

  console.log("\nSaving the newest copy, and publishing it");

  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("the second save lands", await until("saved", async () => (await chip()) === "Saved"), await chip());
  check("and the server now has the newer title",
    sql(`select title from learning_programs where id = ${programId}`) === "Grade 10 Mathematics, term by term",
    sql(`select title from learning_programs where id = ${programId}`));

  // A program needs the rest of its contract before the server will publish it. Filled through the
  // screen, so the fields the studio draws are the fields the API validates.
  const type = async (field, value) => {
    await page.locator(`[data-testid="program-input-${field}"]`).fill(value);
  };
  await type("summary", "A term of Grade 10 mathematics, worked through week by week together.");
  await type("outcome", "Students can work through a whole past paper with support.");
  await type("intendedLearner", "Students in Grade 10 preparing for the board examination");
  await type("startingLevel", "Comfortable with Grade 9 arithmetic");
  await type("teachingLanguage", "Nepali and English");
  await page.locator('[data-testid="program-modules-add"]').click();
  await page.locator('[data-testid="program-module-0-title"]').fill("Where we start");
  await page.locator('[data-testid="program-module-0-outcome"]').fill("Know what the first lesson covers and why it comes first.");
  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("the whole contract saves", await until("saved", async () => (await chip()) === "Saved"), await chip());

  check("with nothing outstanding, Publish appears", await until("publish", () => seen("program-publish")),
    await read("program-section-review"));
  await page.locator('[data-testid="program-publish"]').click();
  check("publishing asks first", await until("confirm", () => seen("program-confirm-publish")));
  const publishBox = await page.locator('[data-testid="program-confirm-publish"]').boundingBox();
  check("publish confirmation is immediately visible without scrolling",
    publishBox && publishBox.y < 844 && publishBox.y + publishBox.height > 0,
    JSON.stringify(publishBox));
  await page.locator('[data-testid="program-confirm-publish-go"]').click();

  check("and the program is published",
    await until("published", () => Promise.resolve(sql(`select status from learning_programs where id = ${programId}`) === "published")),
    sql(`select status, version from learning_programs where id = ${programId}`));
  check("at version 1", sql(`select version from learning_programs where id = ${programId}`) === "1",
    sql(`select version from learning_programs where id = ${programId}`));

  /* ------------------------------------------- an unchanged program makes no version */

  console.log("\nPublishing nothing");

  check("a published program in step offers no publish button",
    await until("unchanged", async () => (await seen("program-publish-unchanged")) && !(await seen("program-publish"))),
    await read("program-section-review"));
  check("and the version did not move", sql(`select version from learning_programs where id = ${programId}`) === "1",
    sql(`select version from learning_programs where id = ${programId}`));
  check("nothing on the screen invites a republish of the same thing",
    /already have exactly this/i.test(await read("program-publish-unchanged")),
    await read("program-publish-unchanged"));

  /* ------------------------------------------- a lifecycle action over new typing */

  console.log("\nA lifecycle action cannot run over new typing");

  await page.locator('[data-testid="program-input-outcome"]').fill("Changed again, and not saved");
  check("typing hides taking it down", await until("hidden", async () => !(await seen("program-action-unpublish"))));
  check("and archiving", !(await seen("program-action-archive")));
  check("and says to save first", await seen("program-actions-blocked"));
  const statusNow = sql(`select status, version from learning_programs where id = ${programId}`);
  check("the server was not asked to do anything", statusNow === "published|1", statusNow);

  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("saving brings the actions back", await until("back", () => seen("program-action-unpublish")), await chip());
  check("and the publish button, because there is now something to publish", await seen("program-publish"));

  check(`${patches} saves went to the server, each on its own`, patches >= 3, String(patches));

  /* ------------------------------------------ one operation at a time, proved */

  console.log("\nNothing crosses a lifecycle request");

  /*
    The reverse ordering Codex found: start a publish while clean, then type and press Save while
    that POST is still out. A PATCH and a POST then race for the same row lock, and which one wins
    decides what students were given.
  */
  // The section above ended with a save, so the screen is already clean and Publish is offered.
  check("start from a saved draft", await until("saved", async () => {
    const label = await chip();
    return label === "Saved" || label === "All changes saved";
  }), await chip());

  const beforeRace = writes.length;
  const letPublishFinish = holdNext("POST");
  await page.locator('[data-testid="program-publish"]').click();
  await until("confirm", () => seen("program-confirm-publish"));
  await page.locator('[data-testid="program-confirm-publish-go"]').click();
  await page.waitForTimeout(400);

  // The editor is shut while it runs, so this typing should not even reach the draft.
  await page.locator('[data-testid="program-input-summary"]').fill("Typed during a publish").catch(() => {});
  await page.locator('[data-testid="program-studio-save-button"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);

  const during = writes.slice(beforeRace);
  check("only the publish was sent while it was in flight",
    during.filter((w) => w.startsWith("PATCH")).length === 0, JSON.stringify(during));
  check("and the fields were locked", await page.locator('[data-testid="program-input-summary"]').isEditable() === false);

  // A second lifecycle press during the first must not reach the server either.
  await page.locator('[data-testid="program-action-archive"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  check("and a second lifecycle action was not dispatched",
    writes.slice(beforeRace).filter((w) => w.startsWith("POST")).length === 1,
    JSON.stringify(writes.slice(beforeRace)));

  letPublishFinish();
  check("the publish lands", await until("v2", () =>
    Promise.resolve(sql(`select version from learning_programs where id = ${programId}`) === "2")),
    sql(`select status, version from learning_programs where id = ${programId}`));
  check("exactly one write crossed that whole stretch",
    writes.slice(beforeRace).length === 1, JSON.stringify(writes.slice(beforeRace)));
  check("and the screen agrees with what happened",
    (await until("settled", async () => (await chip()) === "All changes saved")) &&
      (await seen("program-publish-unchanged")),
    `${await chip()} / ${await read("program-review-live")}`);
  check("what students see is the version just published",
    /Version 2/.test(await read("program-review-live")), await read("program-review-live"));

  /* --- and the other way: no lifecycle request may cross a save -------------- */

  const beforeSaveRace = writes.length;
  await page.locator('[data-testid="program-input-summary"]').fill("Changed once more, and saved slowly");
  const letSlowSaveFinish = holdNext("PATCH");
  await page.locator('[data-testid="program-studio-save-button"]').click();
  await until("saving", async () => (await chip()) === "Saving…");

  check("publishing is not offered while a save is out", !(await seen("program-publish")));
  await page.locator('[data-testid="program-action-archive"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  check("and a lifecycle action pressed anyway is not dispatched",
    writes.slice(beforeSaveRace).filter((w) => w.startsWith("POST")).length === 0,
    JSON.stringify(writes.slice(beforeSaveRace)));

  letSlowSaveFinish();
  check("the save lands", await until("saved", async () => (await chip()) === "Saved"), await chip());
  const stateAfter = sql(`select status, version from learning_programs where id = ${programId}`);
  check("and the program is where the publish left it, not where the archive would have",
    stateAfter === "published|2", stateAfter);
  check("with the newly saved words on the server",
    sql(`select summary from learning_programs where id = ${programId}`) === "Changed once more, and saved slowly",
    sql(`select summary from learning_programs where id = ${programId}`));

  /* ------------------------------------------- deleting a draft, with work at risk */

  console.log("\nDeleting a never-published draft that has unsaved work");

  /*
    The one departure that must not be questioned twice.

    Delete is allowed with unsaved text, because throwing the work away is what it is for. Its own
    confirmation says so. What must not then happen is the navigation guard catching the departure
    it just agreed to and asking about work belonging to a program that no longer exists.
  */
  const second = await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } });
  check("a second draft is created to delete", second.status === 201 || second.status === 200,
    `${second.status} ${JSON.stringify(second.body).slice(0, 120)}`);
  const doomed = second.body.program.id;

  await page.goto(`${siteUrl}/programs/${doomed}`, { waitUntil: "networkidle" });
  check("it opens", await until("studio", () => seen("program-studio")));
  await page.locator('[data-testid="program-input-title"]').fill("Typed, and about to be thrown away");
  check("and is unsaved", await until("dirty", async () => (await chip()) === "Unsaved changes"), await chip());

  await page.locator('[data-testid="program-action-delete"]').click();
  check("delete still asks", await until("ask", () => seen("program-confirm-delete")));
  const deleteBox = await page.locator('[data-testid="program-confirm-delete"]').boundingBox();
  check("delete confirmation is immediately visible without scrolling",
    deleteBox && deleteBox.y < 844 && deleteBox.y + deleteBox.height > 0,
    JSON.stringify(deleteBox));
  check("and warns that the unsaved work goes too", /not saved/i.test(await read("program-confirm-delete")),
    await read("program-confirm-delete"));
  await page.locator('[data-testid="program-confirm-delete-go"]').click();

  check("the program is gone from the server",
    await until("gone", () => Promise.resolve(sql(`select count(*) from learning_programs where id = ${doomed}`) === "0")),
    sql(`select count(*) from learning_programs where id = ${doomed}`));
  check("and it left for the list without asking a second time",
    await until("list", () => seen("program-home")), await page.evaluate(() => location.pathname));
  check("with no unsaved-work question anywhere on the way", !(await seen("program-leave-confirm")));

  await ctx.close();
  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
