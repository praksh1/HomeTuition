/** Render the operator site with synthetic API responses. No provider or real account is called. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(appRoot, process.env.COST_HEALTH_UI_BUILD || "operator-web-build");
const screenshots = await mkdtemp(path.join(tmpdir(), "sikshya-cost-health-"));
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
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (ok, description) => { assert.ok(ok, description); passed++; console.log(`PASS ${description}`); };

const at = "2026-09-29T15:00:00.000Z";
const snapshot = {
  checkedAt: at,
  providers: [
    { id: "railway", name: "Railway", scope: "Hobby workspace", status: "connected", checkedAt: at, observedAt: at, dashboardUrl: "https://railway.com/workspace/usage", note: "Provider-reported usage.", setup: [], meters: [{ id: "compute", label: "Compute", used: 8.5, limit: 10, unit: "USD", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-30T00:00:00Z", source: "provider" }], cost: { amountUsd: 8.5, projectedUsd: 12, periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-30T00:00:00Z", basis: "provider_estimate", note: "Includes only compute." } },
    { id: "neon:staging", name: "Neon", scope: "Staging project", status: "partial", checkedAt: at, observedAt: at, dashboardUrl: "https://console.neon.tech/app/projects", note: "Free usage is visible but no dollar cost is reported.", setup: ["NEON_API_KEY"], meters: [{ id: "cu", label: "Compute", used: 80.1, limit: 100, unit: "CU-hours", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z", source: "provider" }], cost: null },
    { id: "cloudflare-workers", name: "Cloudflare", scope: "Workers Free", status: "not_connected", checkedAt: at, observedAt: null, dashboardUrl: "https://dash.cloudflare.com", note: "No cost reading.", setup: ["CLOUDFLARE_API_TOKEN"], meters: [], cost: null },
    { id: "brevo", name: "Brevo", scope: "Free account", status: "not_connected", checkedAt: at, observedAt: null, dashboardUrl: "https://app.brevo.com", note: "No cost reading.", setup: ["BREVO_API_KEY"], meters: [], cost: null },
  ],
  health: [{ id: "api", name: "API", status: "healthy", checkedAt: at, latencyMs: 37, note: "API responded from this monitor." }],
};
const dashboard = {
  settings: { monthlyBudgetUsd: null, providerBudgetsUsd: { railway: 15, neon: 15, cloudflare: 15, brevo: 15 }, emailAlertsEnabled: true },
  snapshot,
  warnings: [{ key: "neon-compute", severity: "attention", title: "Neon compute is near its limit", detail: "80.1 of 100 CU-hours used.", providerId: "neon" }, { key: "coverage:neon", severity: "attention", title: "Neon coverage partial", detail: "Provider connection still needs setup.", providerId: "neon" }],
  summary: { knownSpendUsd: 8.5, projectedSpendUsd: null, complete: false, note: "Only Railway reports cost. Billing periods differ." },
  monitoring: { enabled: true, intervalMinutes: 60, lastAttemptAt: at, lastSuccessAt: at, nextCheckAt: "2026-09-29T16:00:00Z", refreshing: false, emailConfigured: true, alertRecipient: "synthetic@example.invalid", lastEmailAt: null, lastEmailStatus: null, limitation: "An outage of this monitor can delay alerts." },
  history: [{ checkedAt: at, knownSpendUsd: 8.5 }],
};

try {
  for (const width of [390, 1440]) {
    let allowed = false;
    let costFetches = 0;
    let refreshes = 0;
    let saved = null;
    let emailTests = 0;
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on("pageerror", error => errors.push(String(error)));
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/auth/me") return json({ id: 91, email: "synthetic@example.invalid", name: "Synthetic Owner", role: "admin", emailVerified: true });
      if (pathname === "/api/operator/me") return json({ loginId: "synthetic", name: "Synthetic Owner", mustChangePassword: false, isAdministrator: true });
      if (pathname === "/api/identity-review/access") return json({ allowed: false });
      if (pathname === "/api/owner/access") return json({ allowed });
      if (pathname === "/api/owner/cost-health" && route.request().method() === "GET") { costFetches++; return json(dashboard); }
      if (pathname === "/api/owner/cost-health/refresh") { refreshes++; return json(dashboard); }
      if (pathname === "/api/owner/cost-health/settings") { saved = route.request().postDataJSON(); dashboard.settings = saved; return json(dashboard); }
      if (pathname === "/api/owner/cost-health/test-email") { emailTests++; return json({ accepted: true }); }
      if (pathname === "/api/admin/tickets") return json({ tickets: [] });
      if (pathname === "/api/admin/overview") return json({ known: true, openTickets: 0, pendingTeachers: 0, openModeration: 0, suspendedAccounts: 0 });
      return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Not available in this test."}' });
    });
    await page.addInitScript(() => localStorage.setItem("@sikshya_token", "synthetic-owner-token"));
    const deniedAccess = page.waitForResponse(response => new URL(response.url()).pathname === "/api/owner/access");
    await page.goto(`${base}/(admin)`);
    await deniedAccess;
    check(await page.getByTestId("admin-cost-health-link").count() === 0, `${width}: owner link hidden when access is denied`);
    await page.goto(`${base}/(admin)/cost-health`);
    await page.getByTestId("cost-health-access-denied").waitFor();
    check(costFetches === 0, `${width}: denied direct route never fetches private readings`);

    allowed = true;
    await page.goto(`${base}/(admin)`);
    await page.getByTestId("admin-cost-health-link").waitFor();
    const autoRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/owner/cost-health/refresh");
    await page.getByTestId("admin-cost-health-link").click();
    await page.getByTestId("cost-health-known-spend").waitFor();
    await autoRefresh;
    check((await page.getByTestId("cost-health-known-spend").innerText()) === "USD $8.50", `${width}: known spend is labeled USD`);
    check((await page.getByTestId("cost-health-projection").innerText()) === "Not available", `${width}: incomplete combined projection stays unavailable`);
    check((await page.getByTestId("cost-health-cost-neon:staging").innerText()) === "Not available", `${width}: missing Neon cost is not zero`);
    check(await page.getByTestId("cost-health-provider-neon:staging").getByText("Alert budget: USD $15.00 / month").count() === 1, `${width}: project cards inherit the provider alert budget`);
    check(await page.getByTestId("cost-health-provider-railway").getByText("Trend projection (estimate): USD $12.00").count() === 1, `${width}: trend estimate is shown without implying a combined projection`);
    check((await page.getByTestId("cost-health-coverage-summary").innerText()).includes("1 connection needs setup"), `${width}: connection coverage is summarized once`);
    check(await page.getByText("Neon coverage partial").count() === 0, `${width}: connection coverage does not duplicate the attention card`);
    check((await page.getByTestId("cost-health-budget-overall").inputValue()) === "", `${width}: overall budget remains unset`);
    check((await page.getByTestId("cost-health-budget-brevo").inputValue()) === "15", `${width}: per-provider alert budget is visible`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);

    await page.getByTestId("cost-health-budget-railway").fill("18");
    await page.getByTestId("cost-health-save-settings").click();
    await page.getByTestId("cost-health-feedback").getByText("Alert settings saved.").waitFor();
    check(saved?.providerBudgetsUsd?.railway === 18 && saved?.providerBudgetsUsd?.brevo === 15 && saved?.monthlyBudgetUsd === null && saved?.emailAlertsEnabled === true, `${width}: edited settings save without inventing a total cap`);
    check(refreshes === 1 && await page.getByTestId("cost-health-refresh").getAttribute("aria-disabled") === "true", `${width}: opening runs one check and starts the five-minute cooldown`);
    await page.getByTestId("cost-health-test-email").click();
    await page.getByText("Test email accepted for delivery.", { exact: false }).waitFor();
    check(emailTests === 1, `${width}: email test asks the authenticated server`);
    check(errors.length === 0, `${width}: no browser runtime errors`);
    const screenshot = path.join(screenshots, `cost-health-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(`SCREENSHOT ${screenshot}`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} Cost & Health browser checks passed.`);
