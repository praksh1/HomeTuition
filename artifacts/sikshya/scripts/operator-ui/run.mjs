import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(appRoot, "operator-web-build");
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".ico": "image/x-icon" };
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = path.resolve(output, `.${requested === "/" ? "/index.html" : requested}`);
  if (!file.startsWith(output + path.sep) && file !== path.join(output, "index.html")) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch {
    const html = await readFile(path.join(output, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(html);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`); };
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    const apiCalls = [];
    let mustChangePassword = true;
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      apiCalls.push(pathname);
      if (pathname === "/api/operator/login") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "synthetic-operator-token", operator: { mustChangePassword: true } }) });
      if (pathname === "/api/auth/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 91, email: "desk@operators.invalid", name: "Synthetic Operator", role: "admin", emailVerified: true }) });
      if (pathname === "/api/operator/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ loginId: "synthetic", name: "Synthetic Operator", mustChangePassword, isAdministrator: false }) });
      if (pathname === "/api/operator/password") { mustChangePassword = false; return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
      return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Not available in this test."}' });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole("heading", { name: "Operator sign in" }).waitFor();
    check(!(await page.locator("body").innerText()).includes("Create New Account"), `${width}: no public signup`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.getByRole("textbox", { name: "Operator ID" }).fill("synthetic");
    await page.getByLabel("Operator password").fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in to Fadko Desk" }).click();
    await page.getByRole("heading", { name: "Choose your own password" }).waitFor();
    check(apiCalls.includes("/api/operator/login") && apiCalls.includes("/api/operator/me"), `${width}: operator-specific authentication`);
    check(!apiCalls.includes("/api/auth/login"), `${width}: public login never used`);
    await page.getByLabel("Current one-time password").fill("synthetic-temporary");
    await page.getByLabel("New password").fill("synthetic-new-password");
    await page.getByRole("button", { name: "Save and open desk" }).click();
    await page.getByText("Support", { exact: true }).first().waitFor({ timeout: 10_000 }).catch(async error => {
      throw new Error(`${error.message}\nVisible page: ${(await page.locator("body").innerText()).slice(0, 1200)}`);
    });
    check(apiCalls.includes("/api/operator/password"), `${width}: forced password change reaches the server`);
    check(errors.length === 0, `${width}: no browser runtime errors`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} operator checks passed.`);
