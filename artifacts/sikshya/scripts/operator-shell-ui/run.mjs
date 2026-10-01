/** Test the real isolated operator export. Every account and API result is synthetic. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(appRoot, "operator-web-build");
const captures = await mkdtemp(path.join(tmpdir(), "fadko-operator-shell-"));
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".ico": "image/x-icon" };
const server = createServer(async (request, response) => {
  const requested = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = path.resolve(output, `.${requested === "/" ? "/index.html" : requested}`);
  if (!file.startsWith(output + path.sep)) return response.writeHead(403).end();
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch {
    const html = await readFile(path.join(output, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(html);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (condition, label) => { assert.ok(condition, label); passed++; console.log(`PASS ${label}`); };

async function fixture(width, options = {}) {
  const state = { role: "admin", mustChangePassword: true, profileUnavailable: false, operatorUnavailable: false, operatorStatus: 200, loginCalls: 0, passwordCalls: 0, privateCalls: 0, escaped: [], errors: [], ...options };
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width <= 768, serviceWorkers: "block" });
  if (options.savedToken) await context.addInitScript(() => localStorage.setItem("@sikshya_token", "synthetic-desk-token"));
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      if (url.origin === base && ["GET", "HEAD"].includes(request.method())) return route.continue();
      state.escaped.push(request.url()); return route.abort("blockedbyclient");
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/operator/login") {
      state.loginCalls++;
      const body = request.postDataJSON();
      check(body.loginId === "synthetic-operator" && body.password === "synthetic-one-time", `${width}: operator login uses the issued ID and password`);
      return json({ token: "synthetic-desk-token", operator: { mustChangePassword: state.mustChangePassword } });
    }
    if (url.pathname === "/api/auth/me") {
      if (state.profileUnavailable) return json({ error: "Synthetic interruption" }, 503);
      return json({ id: 91, email: "synthetic@example.invalid", name: "Synthetic Operator", role: state.role, emailVerified: true, authProviders: ["password"], onboardingComplete: true, student: { id: 192, grade: "10" } });
    }
    if (url.pathname === "/api/operator/me") {
      if (state.operatorUnavailable) return json({ error: "Synthetic interruption" }, 503);
      if (state.operatorStatus !== 200) return json({ error: "Operator access required" }, state.operatorStatus);
      return json({ loginId: "synthetic-operator", name: "Synthetic Operator", mustChangePassword: state.mustChangePassword, isAdministrator: false });
    }
    if (url.pathname === "/api/operator/password") {
      state.passwordCalls++;
      const body = request.postDataJSON();
      check(body.currentPassword === "synthetic-one-time" && body.newPassword === "Synthetic-New-Password-123", `${width}: password rotation sends the confirmed private password`);
      state.mustChangePassword = false; return json({ changed: true });
    }
    if (url.pathname.startsWith("/api/admin/") || url.pathname.startsWith("/api/owner/")) state.privateCalls++;
    if (url.pathname === "/api/admin/tickets") return json({ tickets: [] });
    if (url.pathname === "/api/admin/overview") return json({ known: true, openTickets: 0, pendingTeachers: 0, openModeration: 0, suspendedAccounts: 0 });
    if (url.pathname === "/api/admin/lesson-remedies") return json({ enabled: true, role: "admin", serverNow: new Date().toISOString(), quotas: [], lessons: [] });
    if (url.pathname === "/api/owner/access") return json({ allowed: false });
    if (url.pathname === "/api/notification-events") return json({ events: [], readState: {} });
    if (url.pathname === "/api/notification-preferences") return json({ emailAvailable: false });
    return json({ error: "Not part of this isolated fixture" }, 403);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", error => state.errors.push(String(error)));
  page.on("dialog", dialog => void dialog.accept());
  return { page, context, state };
}

async function assertUsable(page, width, label) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: ${label} has no horizontal overflow`);
  const controls = page.getByRole("button").filter({ visible: true });
  for (let index = 0; index < await controls.count(); index++) {
    const control = controls.nth(index);
    if (!(await control.isEnabled())) continue;
    const bounds = await control.boundingBox();
    if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= width) check(bounds.height >= 43.5, `${width}: ${label} button ${index + 1} has a usable target`);
  }
}

try {
  for (const width of [320, 390, 1440]) {
    const { page, context, state } = await fixture(width);
    await page.goto(`${base}/(admin)/operator-makeups`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Operator sign in" }).waitFor().catch(async error => {
      console.error(JSON.stringify({ url: page.url(), errors: state.errors, escaped: state.escaped, body: (await page.locator("body").innerText()).slice(0, 1800) }));
      await page.screenshot({ path: path.join(captures, `operator-${width}-unready.png`) });
      throw error;
    });
    check(state.privateCalls === 0, `${width}: signed-out deep link never requests private work`);
    check(await page.getByText("Teacher Login", { exact: true }).count() === 0, `${width}: no participant login is exposed`);
    await assertUsable(page, width, "operator sign in");
    await page.screenshot({ path: path.join(captures, `operator-${width}-login.png`) });
    await page.getByLabel("Operator ID", { exact: true }).fill("synthetic-operator");
    await page.getByLabel("Operator password", { exact: true }).fill("synthetic-one-time");
    await page.getByLabel("Operator password", { exact: true }).press("Enter");
    await page.getByRole("heading", { name: "Choose your own password" }).waitFor();
    check(state.loginCalls === 1 && state.privateCalls === 0, `${width}: one-time password must rotate before any private work loads`);
    await page.getByLabel("Current one-time password", { exact: true }).fill("synthetic-one-time");
    await page.getByLabel("New password", { exact: true }).fill("Synthetic-New-Password-123");
    await page.getByLabel("New password", { exact: true }).press("Enter");
    await page.getByTestId("admin-logout").waitFor();
    check(state.passwordCalls === 1, `${width}: password rotation opens the real desk without a refresh`);
    check(await page.getByTestId("admin-cost-health-link").count() === 0, `${width}: owner-only readings stay unavailable to ordinary operators`);
    await page.getByRole("button", { name: "Review make-up lessons and held payments" }).click();
    await page.getByText("Review the exceptions", { exact: true }).waitFor();
    check(new URL(page.url()).pathname.endsWith("/operator-makeups"), `${width}: the desk opens the original-lesson make-up workspace`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: make-up workspace has no horizontal overflow`);
    await page.screenshot({ path: path.join(captures, `operator-${width}-makeups.png`) });
    await page.goto(`${base}/(admin)`);
    await page.getByTestId("admin-logout").click();
    await page.getByRole("heading", { name: "Operator sign in" }).waitFor();
    check(await page.evaluate(() => localStorage.getItem("@sikshya_token")) === null, `${width}: sign-out removes the saved operator token`);
    check(state.errors.length === 0, `${width}: login, password rotation, routing and sign-out have no browser errors`);
    check(state.escaped.length === 0, `${width}: no request escaped the local fixture`);
    await context.close();
  }

  for (const problem of ["profileUnavailable", "operatorUnavailable"]) {
    const { page, context, state } = await fixture(390, { savedToken: true, mustChangePassword: false, [problem]: true });
    await page.goto(`${base}/(admin)/operator-makeups`);
    await page.getByRole("heading", { name: "The desk could not connect" }).waitFor();
    check(state.privateCalls === 0, `${problem}: unavailable authentication never mounts private screens`);
    check(await page.evaluate(() => localStorage.getItem("@sikshya_token")) === "synthetic-desk-token", `${problem}: transient interruption retains the session`);
    state[problem] = false;
    await page.getByRole("button", { name: "Retry the operator connection" }).click();
    await page.getByText("Review the exceptions", { exact: true }).waitFor();
    check(state.errors.length === 0, `${problem}: retry recovers the same deep link without a refresh or browser error`);
    check(state.escaped.length === 0, `${problem}: no external request escaped the fixture`);
    await context.close();
  }

  for (const options of [{ role: "student" }, { operatorStatus: 403 }]) {
    const { page, context, state } = await fixture(390, { savedToken: true, mustChangePassword: false, ...options });
    await page.goto(`${base}/(admin)/operator-makeups`);
    await page.getByRole("heading", { name: "Operator sign in" }).waitFor();
    check(state.privateCalls === 0, `${JSON.stringify(options)}: rejected access never mounts private screens`);
    check(await page.evaluate(() => localStorage.getItem("@sikshya_token")) === null, `${JSON.stringify(options)}: rejected access clears the invalid token`);
    check(state.errors.length === 0, `${JSON.stringify(options)}: rejection redirects safely`);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`${passed} isolated operator browser checks passed. Screenshots: ${captures}`);
