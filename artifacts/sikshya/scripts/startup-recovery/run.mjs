/**
 * The exact incident from 20 September 2026, in a real browser.
 *
 * The static app loads and a saved token exists, but `/auth/me` never answers. Fadko must leave
 * the red launch screen on its own, explain the interruption, keep the token, and recover from
 * the same screen when the API returns. Every request is intercepted so this gate cannot touch
 * Preview, Production or any third-party service.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const port = Number(process.env.STARTUP_RECOVERY_SITE_PORT ?? 8107);
const siteUrl = `http://127.0.0.1:${port}`;
const siteOrigin = new URL(siteUrl).origin;

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot,
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});
const stop = () => { try { server.kill(); } catch { /* already stopped */ } };
process.on("exit", stop);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

for (let attempt = 0; attempt < 40; attempt += 1) {
  try { if ((await fetch(siteUrl)).ok) break; } catch { /* still starting */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const chromium = await getChromium();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("@sikshya_token", "saved-session-token"));

let authCalls = 0;
const escaped = [];
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (!url.pathname.startsWith("/api/")) {
    if (url.origin === siteOrigin && ["GET", "HEAD"].includes(request.method())) return route.continue();
    escaped.push(request.url());
    return route.abort("blockedbyclient");
  }

  if (url.pathname === "/api/auth/me") {
    authCalls += 1;
    if (authCalls === 1) {
      // Longer than AuthContext's eight-second budget. This is the request that formerly kept
      // the red screen alive forever. It is deliberately allowed to ignore the browser abort.
      await new Promise((resolve) => setTimeout(resolve, 9_000));
      try { await route.abort("timedout"); } catch { /* the deadline already cancelled it */ }
      return;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 501,
        email: "recovery@example.invalid",
        name: "Recovery Student",
        role: "student",
        emailVerified: true,
        authProviders: ["password"],
        onboardingComplete: true,
        student: { id: 601, userId: 501, grade: "10", bio: "" },
      }),
    });
  }

  // The destination dashboard may begin reads as soon as auth recovers. They are irrelevant to
  // this contract but must remain local and settle rather than pollute the page with open calls.
  return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Not part of this fixture" }) });
});

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(siteUrl, { waitUntil: "domcontentloaded" });

const recovery = page.getByTestId("startup-recovery");
await recovery.waitFor({ state: "visible", timeout: 11_000 });
const recoveryText = await recovery.innerText();
check("the endless splash becomes a recoverable screen", /We.re reconnecting/.test(recoveryText), recoveryText);
check("the screen says the account is safe", /account is safe/i.test(recoveryText), recoveryText);
check("the saved token survived the transient failure", await page.evaluate(() => localStorage.getItem("@sikshya_token")) === "saved-session-token");

await page.getByRole("button", { name: "Retry connection now" }).click();
await recovery.waitFor({ state: "hidden", timeout: 5_000 });
check("retry asks the session endpoint again", authCalls === 2, `calls=${authCalls}`);
check("the same screen recovers when the API returns", await page.getByText("What do you want to learn?", { exact: true }).isVisible());
check("no browser exception escaped", pageErrors.length === 0, pageErrors.join(" | "));
check("no request escaped the local harness", escaped.length === 0, JSON.stringify(escaped));

await context.close();
await browser.close();
stop();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
