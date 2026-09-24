/** Real exported app, deliberately slow auth, no request can reach an external service. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const port = 8127, origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [`${root}/server/serve.js`], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
let browser, count = 0;
const check = (name, value) => { assert.ok(value, name); count++; console.log(`PASS ${name}`); };
async function fixture(width, role, gate = "ready") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(() => localStorage.setItem("@sikshya_token", "synthetic-reload-token"));
  const errors = [], escaped = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) {
      if (url.origin === origin && ["GET", "HEAD"].includes(route.request().method())) return route.continue();
      escaped.push(url.origin); return route.abort();
    }
    if (url.pathname === "/api/auth/me") {
      await new Promise(r => setTimeout(r, 300));
      if (gate === "signed-out") return route.fulfill({ status: 401, json: { error: "Sign in" } });
      return route.fulfill({ json: { id: 501, name: `Reload ${role}`, email: "reload@example.invalid", role, emailVerified: gate !== "unverified", onboardingComplete: gate !== "incomplete", authProviders: ["password"], teacher: { id: 601, userId: 501, subjects: [], subject: "Maths", bio: "", approvalStatus: "approved" }, student: { id: 701, userId: 501, grade: "10", bio: "" } } });
    }
    // Deliberate API failure on secondary content: route retention cannot depend on it.
    return route.fulfill({ status: 503, json: { error: "Secondary reads are outside this fixture" } });
  });
  const page = await context.newPage();
  page.on("dialog", dialog => {
    void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()).catch(() => {});
  });
  page.on("pageerror", e => errors.push(String(e)));
  return { context, page, errors, escaped };
}
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  browser = await (await getChromium()).launch();
  for (const width of [390, 1440]) for (const role of ["teacher", "student"]) {
    const { context, page, errors, escaped } = await fixture(width, role);
    for (const tab of ["messages", "sessions", "profile"]) {
      const target = tab === "messages" ? "new-message-button" : tab === "profile" ? "notification-settings-link" : role === "teacher" ? "teacher-schedule-list" : "student-classes-list";
      await page.goto(`${origin}/${tab}?keep=1`);
      await page.getByTestId(target).waitFor({ timeout: 15000 });
      check(`${width} ${role}: cold ${tab} retains destination`, new URL(page.url()).pathname === `/${tab}`);
      check(`${width} ${role}: query survives role resolution`, new URL(page.url()).searchParams.get("keep") === "1");
      await page.reload();
      await page.getByTestId(target).waitFor({ timeout: 15000 });
      check(`${width} ${role}: ${tab} survives refresh`, new URL(page.url()).pathname === `/${tab}`);
    }
    await context.close();
    // Each cold-start account state owns its browser storage and fixed auth response. Mutating
    // auth underneath a mounted onboarding form mixed this route test with its leave guard,
    // producing an intermittent beforeunload navigation timeout in the full Linux CI run.
    for (const [state, destination] of [["unverified", "check-email"], ["incomplete", "onboarding"], ["signed-out", "welcome"]]) {
      const gated = await fixture(width, role, state);
      try {
        await gated.page.goto(`${origin}/messages`);
        await gated.page.waitForURL(url => url.pathname === `/${destination}`, { timeout: 15000 });
        check(`${width} ${role}: ${state} gate still enforced`, new URL(gated.page.url()).pathname === `/${destination}`);
      } finally {
        errors.push(...gated.errors);
        escaped.push(...gated.escaped);
        await gated.context.close();
      }
    }
    check(`${width} ${role}: no browser exceptions`, errors.length === 0, errors.join(" | "));
    check(`${width} ${role}: no external HTTP requests`, escaped.length === 0);
  }
  console.log(`${count} cold-reload checks passed`);
} finally { await browser?.close(); stop(); }
