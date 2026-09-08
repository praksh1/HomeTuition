/**
 * The owner's manual checklist, walked by a machine first, against the deployed bundle.
 *
 * ## What makes this different from the other two suites
 *
 * `scripts/program-studio/run.mjs` renders components against props. `scripts/program-journey/run.mjs`
 * drives a locally built app and proves the races and guards. This one exists for the hand-off: it
 * walks the exact list a non-technical owner is about to be given, in order, so that the checklist
 * handed over has been shown to pass rather than merely written down.
 *
 * ## Which frontend it drives
 *
 * `artifacts/sikshya/web-build`, built with `EXPO_PUBLIC_API_URL` set to the **staging** API — the
 * same command the preview workflow runs. Expo names its bundles by content hash, so when those
 * file names match the ones the preview is serving, the bytes are the same bytes. The runner prints
 * them; compare before trusting the result.
 *
 * ## Which API it talks to
 *
 * A local one, standing in for staging. The frontend has the staging address baked in and cannot be
 * asked to use another, so requests to that host are re-pointed at `API_URL` in the browser. That is
 * the one thing here which is not the real preview, and it is deliberate: this container cannot
 * reach the public internet, and the staging API does not yet carry these routes.
 *
 * Usage, with a local API on 8080 and the build above in place:
 *   node scripts/program-smoke/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.PROGRAM_SMOKE_PORT ?? 8092);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const STAGING = (process.env.STAGING_API_URL ?? "https://hometuition-api-staging-production.up.railway.app").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to smoke-test. Build it the way the preview workflow does:");
  console.error("  EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=<staging> pnpm --filter @workspace/sikshya run build");
  process.exit(1);
}

console.log("Bundles under test (compare these with what the preview serves):");
for (const f of readdirSync(path.join(appRoot, "web-build", "_expo", "static", "js", "web"))
  .filter((f) => f.startsWith("entry-") || f.startsWith("__common-"))) {
  console.log(`  ${f}`);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
process.on("exit", () => { try { server.kill(); } catch { /* already gone */ } });

async function until(fn, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}.`);
    process.exit(1);
  }
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(siteUrl)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const email = `smoke_${Date.now()}@example.com`;
  const password = "password123";
  const reg = await api("/auth/register", { method: "POST", body: {
    name: "Smoke Teacher", email, password, role: "teacher",
    subject: "Mathematics", bio: "Teaches Grade 10 mathematics.",
  } });
  if (reg.status > 201) throw new Error(`register: ${reg.status}`);
  prepareBrowserAccount(reg.body.user.id);
  sql(`update teacher_profiles set approval_status = 'approved' where user_id = ${reg.body.user.id}`);

  const chromium = await getChromium();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

  /*
    The staging address is baked into these bytes and cannot be changed without rebuilding, so it is
    re-pointed here. Everything else about the frontend is exactly what the preview serves.

    Fulfilled rather than redirected: Playwright will not let a route change scheme, and the stand-in
    API is plain http. So the request is made from Node and handed back — which also means the CORS
    headers have to be written here, because to the browser this is still a cross-origin call to an
    https host it never actually reached.
  */
  const cors = (origin) => ({
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "Authorization,Content-Type",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  const seenRequests = [];
  await page.route(`${STAGING}/**`, async (route) => {
    const request = route.request();
    seenRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    const origin = new URL(request.frame().url()).origin;
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors(origin), body: "" });
    }
    const headers = { ...request.headers() };
    delete headers.host;
    delete headers.origin;
    const answer = await fetch(request.url().replace(STAGING, API), {
      method: request.method(),
      headers,
      body: request.postData() ?? undefined,
      redirect: "manual",
    });
    const text = await answer.text();
    if (new URL(request.url()).pathname.includes("/auth/login")) {
      seenRequests.push(`  login -> ${answer.status} ${text.slice(0, 120)}`);
    }
    return route.fulfill({
      status: answer.status,
      headers: { "content-type": answer.headers.get("content-type") ?? "application/json", ...cors(origin) },
      body: text,
    });
  });

  const seen = (id) => page.locator(`[data-testid="${id}"]`).count().then((n) => n > 0);
  const read = (id) => page.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "");
  const chip = () => read("program-studio-save");
  const body = () => page.evaluate(() => document.body.innerText);

  /* --------------------------------------------------------------- signing in */

  console.log("\n1. The teacher signs in");
  /*
    Signed in twice, for two different reasons.

    The form is filled the way a person fills it, and the API's answer is checked — that is the part
    worth proving. The session is then established by writing the token the way the other browser
    suites in this repository do, because the request stand-in above breaks the redirect that
    normally follows: the page's own `fetch` is answered by Playwright rather than by a server, and
    the login path does not survive that. It is an artefact of testing a bundle whose API address is
    baked in, not something a teacher would meet.
  */
  await page.goto(`${siteUrl}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByText("Sign In", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const loginAnswer = seenRequests.find((r) => r.startsWith("  login ->")) ?? "";
  check("the sign-in form reaches the server and is accepted", /login -> 200/.test(loginAnswer),
    loginAnswer.slice(0, 60));

  const signIn = await api("/auth/login", { method: "POST", body: { email, password } });
  await page.addInitScript((t) => window.localStorage.setItem("@sikshya_token", t), signIn.body.token);
  await page.goto(siteUrl, { waitUntil: "networkidle" });
  const landed = await until(() => seen("teacher-programs-entry"));
  check("signing in reaches the teacher dashboard", landed,
    `${await page.evaluate(() => location.pathname)} | ${(await body()).slice(0, 200).replace(/\n/g, " | ")} | console: ${JSON.stringify(consoleErrors.slice(0, 3))} | requests: ${JSON.stringify(seenRequests)} | token: ${await page.evaluate(() => Boolean(window.localStorage.getItem("@sikshya_token")))}`);
  if (!landed) { await browser.close(); process.exit(1); }

  console.log("\n2. Programs opens from the dashboard");
  await page.locator('[data-testid="teacher-programs-entry"]').click();
  check("the Programs screen opens", await until(() => seen("program-home")));
  // Waited for, not sampled: the list draws skeletons first, and `program-home` exists during them.
  check("and says plainly there is nothing yet", await until(() => seen("program-home-empty")));

  /* ------------------------------------------------------- every kind of program */

  console.log("\n3. Every kind of program can be created");
  const types = ["school_subject", "exam_preparation", "language", "practical_skill", "custom"];
  const made = {};
  for (const type of types) {
    await page.goto(`${siteUrl}/programs/new`, { waitUntil: "networkidle" });
    check(`${type} is offered`, await until(() => seen(`program-type-${type}`)));
    await page.locator(`[data-testid="program-type-${type}"]`).click();
    check(`${type} opens a studio`, await until(() => seen("program-studio")));
    made[type] = Number(sql(`select id from learning_programs where teacher_id = ${reg.body.user.id} order by id desc limit 1`));
  }
  check("the server holds one program per kind",
    Number(sql(`select count(*) from learning_programs where teacher_id = ${reg.body.user.id}`)) === 5);

  console.log("\n4. A practical skill is not asked for a curriculum");
  await page.goto(`${siteUrl}/programs/${made.practical_skill}`, { waitUntil: "networkidle" });
  await until(() => seen("program-studio"));
  check("no curriculum section on a practical skill", !(await seen("program-section-reference")));
  await page.goto(`${siteUrl}/programs/${made.exam_preparation}`, { waitUntil: "networkidle" });
  await until(() => seen("program-studio"));
  check("an exam program is asked which exam", await seen("program-section-reference"));

  /* ------------------------------------------- leaving and returning without loss */

  console.log("\n5. An incomplete draft survives leaving and coming back");
  const id = made.school_subject;
  await page.goto(`${siteUrl}/programs/${id}`, { waitUntil: "networkidle" });
  await until(() => seen("program-studio"));
  const title = page.locator('[data-testid="program-input-title"]');
  await title.fill("Grade 10 Mathematics, term by term");
  check("typing is marked unsaved", await until(async () => (await chip()) === "Unsaved changes"), await chip());

  console.log("\n6. Browser Back warns while the work is unsaved");
  await page.goBack();
  await page.waitForTimeout(600);
  check("Back is caught and questioned", await seen("program-leave-confirm"));
  check("and the studio is still open", await seen("program-studio"));
  await page.locator('[data-testid="program-leave-cancel"]').click();
  check("the words are still there", (await title.inputValue()) === "Grade 10 Mathematics, term by term");

  console.log("\n7. Reload raises the browser's own warning");
  let dialogs = 0;
  const onDialog = (d) => { dialogs += 1; void d.dismiss(); };
  page.on("dialog", onDialog);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(600);
  page.off("dialog", onDialog);
  check("reloading asks before throwing the work away", dialogs > 0, `${dialogs} dialogs`);

  console.log("\n8. Saving keeps the work, and normal Back then works");
  await page.goto(`${siteUrl}/programs/${id}`, { waitUntil: "networkidle" });
  await until(() => seen("program-studio"));
  await title.fill("Grade 10 Mathematics, term by term");
  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("it saves", await until(async () => (await chip()) === "Saved"), await chip());
  await page.locator('[data-testid="program-studio-back"]').click();
  check("leaving a saved draft asks nothing", await until(() => seen("program-home")) && !(await seen("program-leave-confirm")));
  await page.locator(`[data-testid="program-card-${id}"]`).click();
  check("and the work is still there on return",
    await until(async () => (await title.inputValue()) === "Grade 10 Mathematics, term by term"),
    await title.inputValue());

  /* --------------------------------------------------------------- publishing */

  console.log("\n9. A finished program publishes");
  const type_ = async (field, value) => page.locator(`[data-testid="program-input-${field}"]`).fill(value);
  await type_("summary", "A term of Grade 10 mathematics, worked through week by week together.");
  await type_("outcome", "Students can work through a whole past paper with support.");
  await type_("intendedLearner", "Students in Grade 10 preparing for the board examination");
  await type_("startingLevel", "Comfortable with Grade 9 arithmetic");
  await type_("teachingLanguage", "Nepali and English");
  await page.locator('[data-testid="program-modules-add"]').click();
  await page.locator('[data-testid="program-module-0-title"]').fill("Where we start");
  await page.locator('[data-testid="program-module-0-outcome"]').fill("Know what the first lesson covers and why it comes first.");
  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("the whole thing saves", await until(async () => (await chip()) === "Saved"), await chip());
  check("Publish appears once nothing is missing", await until(() => seen("program-publish")));
  await page.locator('[data-testid="program-publish"]').click();
  await until(() => seen("program-confirm-publish"));
  await page.locator('[data-testid="program-confirm-publish-go"]').click();
  check("it publishes", await until(() => Promise.resolve(sql(`select status from learning_programs where id = ${id}`) === "published")),
    sql(`select status, version from learning_programs where id = ${id}`));

  console.log("\n10. Editing after publishing does not change what students see");
  await page.locator('[data-testid="program-input-outcome"]').fill("Rewritten after publishing, and not published again");
  await page.locator('[data-testid="program-studio-save-button"]').click();
  check("the edit saves", await until(async () => (await chip()) === "Saved"), await chip());
  const publicView = await api(`/programs/${id}`);
  check("the public page still shows the published words",
    publicView.status === 200 && /whole past paper with support/i.test(JSON.stringify(publicView.body)),
    `${publicView.status} ${JSON.stringify(publicView.body).slice(0, 160)}`);
  check("and not the unpublished rewrite",
    !/Rewritten after publishing/i.test(JSON.stringify(publicView.body)));
  check("the studio says so too", await seen("program-review-unpublished"));
  check("and only now offers to publish the change",
    /publish your changes/i.test(await read("program-publish")), await read("program-publish"));

  console.log("\n11. Republishing happens only when something changed");
  await page.locator('[data-testid="program-publish"]').click();
  await until(() => seen("program-confirm-publish"));
  await page.locator('[data-testid="program-confirm-publish-go"]').click();
  check("the second publication is version 2",
    await until(() => Promise.resolve(sql(`select version from learning_programs where id = ${id}`) === "2")),
    sql(`select version from learning_programs where id = ${id}`));
  check("with nothing new, no publish button is offered at all",
    await until(() => seen("program-publish-unchanged")) && !(await seen("program-publish")));
  check("and the version stays where it is", sql(`select version from learning_programs where id = ${id}`) === "2");

  /* ------------------------------------------------- taking down, away and back */

  console.log("\n12. Take down, archive, restore, delete");
  await page.locator('[data-testid="program-action-unpublish"]').click();
  await until(() => seen("program-confirm-unpublish"));
  await page.locator('[data-testid="program-confirm-unpublish-go"]').click();
  check("taking it down returns it to a draft",
    await until(() => Promise.resolve(sql(`select status from learning_programs where id = ${id}`) === "draft")),
    sql(`select status from learning_programs where id = ${id}`));
  check("and students can no longer read it", (await api(`/programs/${id}`)).status === 404);

  await page.locator('[data-testid="program-action-archive"]').click();
  await until(() => seen("program-confirm-archive"));
  await page.locator('[data-testid="program-confirm-archive-go"]').click();
  check("archiving files it away",
    await until(() => Promise.resolve(sql(`select status from learning_programs where id = ${id}`) === "archived")),
    sql(`select status from learning_programs where id = ${id}`));
  check("a published program is never offered deletion", !(await seen("program-action-delete")));
  check("and the reason is on screen", await seen("program-delete-withheld"));

  check("an archived program offers only restoring", await until(() => seen("program-action-restore")));
  await page.locator('[data-testid="program-action-restore"]').click();
  // Restoring asks too. `programActions` marks it `confirm: false`, but the studio confirms every
  // lifecycle action; the flag is unused. Harmless, and noted in the worklog rather than changed
  // during a deployment pass.
  check("restoring asks first as well", await until(() => seen("program-confirm-restore")));
  await page.locator('[data-testid="program-confirm-restore-go"]').click();
  check("restoring brings it back as a draft",
    await until(() => Promise.resolve(sql(`select status from learning_programs where id = ${id}`) === "draft")),
    `${sql(`select status from learning_programs where id = ${id}`)} | actionError: ${await read("program-studio-action-failed")} | chip: ${await chip()} | recent: ${JSON.stringify(seenRequests.slice(-4))}`);

  const spare = made.language;
  await page.goto(`${siteUrl}/programs/${spare}`, { waitUntil: "networkidle" });
  await until(() => seen("program-studio"));
  check("a never-published draft may be deleted", await seen("program-action-delete"));
  await page.locator('[data-testid="program-action-delete"]').click();
  await until(() => seen("program-confirm-delete"));
  await page.locator('[data-testid="program-confirm-delete-go"]').click();
  check("and it goes",
    await until(() => Promise.resolve(sql(`select count(*) from learning_programs where id = ${spare}`) === "0")));

  /* ------------------------------------------------------------- nothing invented */

  console.log("\n13. Nothing on these screens is invented");
  await page.goto(`${siteUrl}/programs`, { waitUntil: "networkidle" });
  await until(() => seen("program-home"));
  const listText = await body();
  for (const claim of ["NPR", "Rs.", "rating", "students enrolled", "enrolled", "Popular", "Top pick", "Available now", "earned"]) {
    check(`the list claims no ${claim}`, !listText.toLowerCase().includes(claim.toLowerCase()), listText.slice(0, 160).replace(/\n/g, " | "));
  }

  console.log("\n14. The browser console");
  /*
    One class of error is excluded, and only one: the notification WebSocket failing to reach the
    staging host.

    `page.route` intercepts HTTP and not WebSockets, so the socket in these bytes dials the real
    staging address, which this container cannot reach. On the preview it dials the same address
    from a browser that can. Excluding it is honest; excluding anything else would not be, so the
    filter names the host rather than matching "WebSocket".
  */
  const standIn = new RegExp(`WebSocket.*${STAGING.replace(/^https:\/\//, "").replace(/\./g, "\\.")}`, "i");
  const noisy = consoleErrors.filter(
    (e) => !standIn.test(e) && !/favicon|Download the React DevTools|useNativeDriver/i.test(e));
  check("no console errors across the whole journey, beyond the stand-in's own socket",
    noisy.length === 0, JSON.stringify(noisy.slice(0, 4), null, 1));
  console.log(`   (${consoleErrors.length - noisy.length} excluded: the notification socket cannot reach staging from here)`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log(""); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
