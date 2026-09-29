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

const current = new Date();
const at = current.toISOString();
const periodStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)).toISOString();
const periodEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)).toISOString();
const snapshot = {
  checkedAt: at,
  providers: [
    { id: "railway", name: "Railway", scope: "Hobby workspace", status: "connected", checkedAt: at, observedAt: at, dashboardUrl: "https://railway.com/workspace/usage", note: "Provider-reported usage.", setup: [], meters: [{ id: "compute", label: "Compute", used: 8.5, limit: 10, unit: "USD", periodStart, periodEnd, source: "provider" }], cost: { amountUsd: 8.5, projectedUsd: 12, periodStart, periodEnd, basis: "provider_estimate", note: "Includes only compute." } },
    { id: "neon:staging", name: "Neon", scope: "Staging project", status: "partial", checkedAt: at, observedAt: at, dashboardUrl: "https://console.neon.tech/app/projects", note: "Free usage is visible but no dollar cost is reported.", setup: ["NEON_API_KEY"], meters: [{ id: "cu", label: "Compute", used: 80.1, limit: 100, unit: "CU-hours", periodStart, periodEnd, source: "provider" }], cost: null },
    { id: "cloudflare-workers", name: "Cloudflare", scope: "Workers Free", status: "not_connected", checkedAt: at, observedAt: null, dashboardUrl: "https://dash.cloudflare.com", note: "No cost reading.", setup: ["CLOUDFLARE_API_TOKEN"], meters: [], cost: null },
    { id: "cloudflare-r2", name: "Cloudflare R2", scope: "Object storage", status: "partial", checkedAt: at, observedAt: at, dashboardUrl: "https://dash.cloudflare.com", note: "Storage usage is available without a dollar reading.", setup: [], meters: [{ id: "storage", label: "Storage", used: 3.2, limit: 10, unit: "GB", periodStart, periodEnd, source: "provider" }], cost: null },
    { id: "brevo", name: "Brevo", scope: "Free account", status: "not_connected", checkedAt: at, observedAt: null, dashboardUrl: "https://app.brevo.com", note: "No cost reading.", setup: ["BREVO_API_KEY"], meters: [], cost: null },
  ],
  health: [{ id: "api", name: "API", status: "healthy", checkedAt: at, latencyMs: 37, note: "API responded from this monitor." }],
};
const initialDashboard = {
  settings: { monthlyBudgetUsd: null, providerBudgetsUsd: { railway: 15, neon: 15, cloudflare: 15, brevo: 15 }, emailAlertsEnabled: true },
  snapshot,
  warnings: [{ key: "neon-compute", severity: "attention", title: "Neon compute is near its limit", detail: "80.1 of 100 CU-hours used.", providerId: "neon" }, { key: "coverage:neon", severity: "attention", title: "Neon coverage partial", detail: "Provider connection still needs setup.", providerId: "neon" }],
  summary: { knownSpendUsd: 8.5, projectedSpendUsd: null, complete: false, note: "Only Railway reports cost. Billing periods differ." },
  monitoring: { enabled: true, intervalMinutes: 60, lastAttemptAt: at, lastSuccessAt: at, nextCheckAt: new Date(current.getTime() + 3_600_000).toISOString(), refreshing: false, emailConfigured: true, alertRecipient: "synthetic@example.invalid", lastEmailAt: null, lastEmailStatus: null, limitation: "An outage of this monitor can delay alerts." },
  history: [
    { checkedAt: new Date(current.getTime() - 10 * 86_400_000).toISOString(), knownSpendUsd: 4.2 },
    { checkedAt: new Date(current.getTime() - 2 * 86_400_000).toISOString(), knownSpendUsd: 6.25 },
    { checkedAt: new Date(current.getTime() - 12 * 3_600_000).toISOString(), knownSpendUsd: null },
    { checkedAt: at, knownSpendUsd: 8.5 },
  ],
};

const tabs = ["overview", "providers", "alerts", "settings"];
const budgetProviders = ["railway", "neon", "cloudflare", "brevo"];

async function tapControl(page, control, label, width) {
  await control.waitFor({ state: "visible" });
  await control.scrollIntoViewIfNeeded();
  const bounds = await control.boundingBox();
  check(bounds && bounds.width >= 43.5 && bounds.height >= 43.5, `${width}: ${label} has a finger-sized target`);
  const visible = await control.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    let left = Math.max(0, bounds.left), right = Math.min(innerWidth, bounds.right);
    let top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (/^(hidden|clip|auto|scroll)$/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/^(hidden|clip|auto|scroll)$/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    return { width: right - left, height: bottom - top };
  });
  check(visible.width >= 43.5 && visible.height >= 43.5, `${width}: ${label} keeps a finger-sized target after clipping`);
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  check(point.x > 0 && point.x < width && point.y > 0 && point.y < 844, `${width}: ${label} is in the viewport`);
  check(await control.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && (hit === element || element.contains(hit));
  }, point), `${width}: ${label} is reachable without another control covering it`);
  if (width <= 768) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function openTab(page, name, width) {
  await tapControl(page, page.getByTestId(`cost-health-tab-${name}`), `${name} navigation`, width);
  await page.getByTestId(`cost-health-panel-${name}`).waitFor({ state: "visible" });
  check(await page.getByTestId(`cost-health-tab-${name}`).getAttribute("aria-selected") === "true", `${width}: ${name} is announced as selected`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: ${name} has no horizontal overflow`);
}

async function capture(page, name, width) {
  const screenshot = path.join(screenshots, `cost-health-${width}-${name}.png`);
  await page.screenshot({ path: screenshot });
  console.log(`SCREENSHOT ${screenshot}`);
}

try {
  for (const width of [320, 390, 768, 1440]) {
    let dashboard = structuredClone(initialDashboard);
    let allowed = false;
    let costFetches = 0;
    let refreshes = 0;
    let saved = null;
    let emailTests = 0;
    let privateRequests = 0;
    let rejectSave = false;
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width <= 768 });
    page.on("pageerror", error => errors.push(String(error)));
    await page.clock.install({ time: current });
    await page.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/auth/me") return json({ id: 91, email: "synthetic@example.invalid", name: "Synthetic Owner", role: "admin", emailVerified: true });
      if (pathname === "/api/operator/me") return json({ loginId: "synthetic", name: "Synthetic Owner", mustChangePassword: false, isAdministrator: true });
      if (pathname === "/api/identity-review/access") return json({ allowed: false });
      if (pathname === "/api/owner/access") return json({ allowed });
      if (pathname.startsWith("/api/owner/cost-health")) privateRequests++;
      if (pathname === "/api/owner/cost-health" && route.request().method() === "GET") { costFetches++; return json(dashboard); }
      if (pathname === "/api/owner/cost-health/refresh") { refreshes++; return json(dashboard); }
      if (pathname === "/api/owner/cost-health/settings") {
        if (rejectSave) return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Owner access required."}' });
        saved = route.request().postDataJSON(); dashboard.settings = saved; return json(dashboard);
      }
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
    await page.clock.runFor(300_000);
    check(privateRequests === 0, `${width}: denied direct route never requests readings, refreshes, settings or email even after five minutes`);
    check(await page.getByTestId("cost-health-known-spend").count() === 0, `${width}: denied direct route exposes no owner readings`);

    allowed = true;
    await page.goto(`${base}/(admin)`);
    await page.getByTestId("admin-cost-health-link").waitFor();
    const autoRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/owner/cost-health/refresh");
    await page.getByTestId("admin-cost-health-link").click();
    await page.getByTestId("cost-health-known-spend").waitFor();
    await autoRefresh;
    check((await page.getByTestId("cost-health-known-spend").innerText()) === "USD $8.50", `${width}: known spend is labeled USD`);
    check((await page.getByTestId("cost-health-projection").innerText()) === "Not available", `${width}: incomplete combined projection stays unavailable`);
    check(await page.getByTestId("cost-health-budget-railway").count() === 0, `${width}: settings are not expanded on the overview`);
    check(await page.getByTestId("cost-health-provider-neon:staging").count() === 0, `${width}: provider setup details are not expanded on the overview`);
    check((await page.getByTestId("cost-health-coverage-summary").innerText()).includes("1 connection"), `${width}: connection coverage has one concise summary`);
    check(await page.getByText("Neon coverage partial", { exact: true }).count() === 0, `${width}: connection coverage does not duplicate the attention card`);
    check(refreshes === 1 && await page.getByTestId("cost-health-refresh").getAttribute("aria-disabled") === "true", `${width}: opening runs one check and starts the five-minute cooldown`);
    await capture(page, "overview", width);

    for (const [range, count] of [["1D", 1], ["30D", 3], ["7D", 2]]) {
      await tapControl(page, page.getByTestId(`cost-health-range-${range}`), `${range} chart range`, width);
      check(await page.getByTestId(`cost-health-range-${range}`).getAttribute("aria-pressed") === "true", `${width}: ${range} chart range is announced as selected`);
      check(await page.locator('[data-testid^="cost-health-chart-point-"]').count() === count, `${width}: ${range} shows only its actual non-null readings`);
    }
    await tapControl(page, page.getByTestId("cost-health-reading-1"), "recorded usage detail", width);
    check((await page.getByTestId("cost-health-chart-detail").innerText()).startsWith("USD $8.50"), `${width}: selected chart reading shows its measured value`);
    dashboard.history.unshift({ checkedAt: new Date(current.getTime() - 3 * 86_400_000).toISOString(), knownSpendUsd: 5 });

    const beforeMinute = costFetches;
    const cachedReload = page.waitForResponse(response => new URL(response.url()).pathname === "/api/owner/cost-health");
    await page.clock.runFor(60_000);
    await cachedReload;
    check(costFetches > beforeMinute && refreshes === 1, `${width}: saved readings reload after one minute without bypassing the provider cooldown`);
    check((await page.getByTestId("cost-health-chart-detail").innerText()).startsWith("USD $8.50"), `${width}: cached history updates preserve the selected reading rather than its old index`);
    const nextProviderCheck = page.waitForResponse(response => new URL(response.url()).pathname === "/api/owner/cost-health/refresh");
    // The focus interval starts before the asynchronous first refresh, so the next
    // eligible one-minute tick can fall just after the five-minute deadline.
    await page.clock.runFor(300_000);
    await nextProviderCheck;
    check(refreshes === 2, `${width}: the visible dashboard checks providers again on the next tick after its five-minute cooldown`);

    const cloudflareGroup = page.getByTestId("cost-health-row-cloudflare-r2");
    check(await page.locator('[data-testid^="cost-health-row-cloudflare-"]').count() === 1, `${width}: the overview groups Cloudflare products into one row`);
    check((await cloudflareGroup.innerText()).includes("1 / 2") && !(await cloudflareGroup.innerText()).includes("3.2"), `${width}: grouped products show reporting coverage without mislabeling one product's storage as provider-wide usage`);
    check((await cloudflareGroup.getAttribute("aria-label")).includes("1 of 2 sources reporting"), `${width}: the grouped row exposes partial source coverage`);
    await tapControl(page, cloudflareGroup, "grouped Cloudflare provider", width);
    await page.getByTestId("cost-health-provider-cloudflare-r2").waitFor();
    check((await page.getByTestId("cost-health-provider-cloudflare-r2").innerText()).includes("3.2 / 10 GB"), `${width}: the grouped provider opens the matching source details`);

    await openTab(page, "providers", width);
    check(await page.getByTestId("cost-health-provider-neon:staging").count() === 0, `${width}: other provider rows stay compact until selected`);
    check(!(await page.getByTestId("cost-health-row-neon:staging").innerText()).includes("$0.00"), `${width}: the partial Neon row does not invent a zero-dollar charge`);
    await tapControl(page, page.getByTestId("cost-health-row-neon:staging"), "Neon provider details", width);
    await page.getByTestId("cost-health-provider-neon:staging").waitFor();
    check((await page.getByTestId("cost-health-cost-neon:staging").innerText()) === "Not available", `${width}: missing Neon cost is not zero`);
    check(await page.getByTestId("cost-health-provider-neon:staging").getByText("Dollar warning target: USD $15.00 / month").count() === 1, `${width}: project cards inherit the saved provider dollar target`);
    check(await page.getByTestId("cost-health-provider-neon:staging").getByText("Dollar alerts unavailable", { exact: false }).count() === 1, `${width}: missing Neon charges are marked reference-only`);
    check((await page.getByTestId("cost-health-provider-neon:staging").innerText()).includes("80.1 / 100 CU-hours"), `${width}: partial coverage still shows the real non-dollar meter`);
    check(await page.getByText("NEON_API_KEY", { exact: false }).count() === 0, `${width}: server connection variables remain collapsed`);
    await tapControl(page, page.getByTestId("cost-health-provider-neon:staging").getByRole("button", { name: "Connection details" }), "Neon connection details", width);
    await page.getByText("NEON_API_KEY", { exact: false }).waitFor();
    check(await page.getByText("NEON_API_KEY", { exact: false }).count() === 1, `${width}: connection details reveal only when requested`);
    await capture(page, "provider-details", width);
    await tapControl(page, page.getByTestId("cost-health-row-railway"), "Railway provider details", width);
    await page.getByTestId("cost-health-provider-railway").waitFor();
    check(await page.getByTestId("cost-health-provider-railway").getByText("Active for reported resource usage").count() === 1, `${width}: current Railway resource dollar warning is active`);
    check(await page.getByTestId("cost-health-provider-railway").getByText("Trend projection (estimate): USD $12.00").count() === 1, `${width}: trend estimate is shown without implying a combined projection`);

    await openTab(page, "alerts", width);
    check(await page.getByText("Neon compute is near its limit", { exact: true }).count() === 1, `${width}: alerts retain the server warning`);
    check(await page.getByText("Neon coverage partial", { exact: true }).count() === 1, `${width}: alerts show the connection-coverage warning once in its own section`);
    await capture(page, "alerts", width);

    await openTab(page, "settings", width);
    check(await page.getByTestId("cost-health-budget-overall").count() === 0, `${width}: overall dollar budget cannot be entered`);
    for (const provider of budgetProviders) check(await page.getByTestId(`cost-health-budget-${provider}`).inputValue() === "15", `${width}: ${provider} retains its own 15-dollar warning target`);
    check(await page.locator('input[data-testid^="cost-health-budget-"]').count() === 4, `${width}: settings contain exactly four provider targets`);
    check(await page.getByTestId("cost-health-budget-livekit").count() === 0 && (await page.getByTestId("cost-health-panel-settings").innerText()).includes("LiveKit is excluded"), `${width}: LiveKit remains exempt`);
    check(!/\$60(?:\.00)?\b/.test(await page.getByTestId("cost-health-panel-settings").innerText()), `${width}: four targets are not misrepresented as a 60-dollar combined cap`);
    check(await page.getByText("Monthly dollar warning targets").count() === 1, `${width}: saved targets are labelled as dollar warnings`);
    await capture(page, "settings", width);

    await page.getByTestId("cost-health-budget-railway").fill("18");
    await tapControl(page, page.getByTestId("cost-health-save-settings"), "save settings", width);
    await page.getByTestId("cost-health-feedback").getByText("Alert settings saved.").waitFor();
    check(saved?.providerBudgetsUsd?.railway === 18 && saved?.providerBudgetsUsd?.brevo === 15 && saved?.monthlyBudgetUsd === null && saved?.emailAlertsEnabled === true, `${width}: edited settings save without inventing a total cap`);
    check(!("livekit" in saved.providerBudgetsUsd), `${width}: saving does not add a LiveKit target`);
    await tapControl(page, page.getByTestId("cost-health-test-email"), "send test email", width);
    await page.getByText("Test email accepted for delivery.", { exact: false }).waitFor();
    check(emailTests === 1, `${width}: email test asks the authenticated server`);

    for (const tab of tabs) await openTab(page, tab, width);
    rejectSave = true;
    await page.getByTestId("cost-health-budget-railway").fill("19");
    await tapControl(page, page.getByTestId("cost-health-save-settings"), "save after owner access is revoked", width);
    await page.getByTestId("cost-health-access-denied").waitFor();
    const requestsAtDenial = privateRequests;
    await page.clock.runFor(300_000);
    check(privateRequests === requestsAtDenial, `${width}: server-denied save stops future private polling and refreshes`);

    rejectSave = false;
    dashboard = structuredClone(initialDashboard);
    dashboard.snapshot.providers = dashboard.snapshot.providers.map(provider => ({ ...provider, cost: null }));
    dashboard.summary = { knownSpendUsd: null, projectedSpendUsd: null, complete: false, note: "No provider dollar readings are available." };
    dashboard.history = [0, 1, 2].map(index => ({ checkedAt: new Date(current.getTime() - (2 - index) * 3_600_000).toISOString(), knownSpendUsd: null }));
    await page.goto(`${base}/(admin)/cost-health`);
    await page.getByTestId("cost-health-chart-empty").waitFor();
    check(await page.getByTestId("cost-health-known-spend").innerText() === "Not available", `${width}: all-null provider costs remain unavailable`);
    check(await page.getByTestId("cost-health-projection").innerText() === "Not available", `${width}: all-null costs do not create a projection`);
    check(await page.locator('[data-testid^="cost-health-chart-point-"]').count() === 0, `${width}: all-null history creates no fabricated chart points`);
    check(!(await page.getByTestId("cost-health-panel-overview").innerText()).includes("$0.00"), `${width}: all-null overview never implies zero spend`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: the empty chart has no horizontal overflow`);
    await capture(page, "empty-chart", width);
    await tapControl(page, page.getByTestId("cost-health-chart-empty").getByRole("button", { name: "Manage connections" }), "empty chart connection action", width);
    await page.getByTestId("cost-health-panel-providers").waitFor({ state: "visible" });
    check(await page.getByTestId("cost-health-tab-providers").getAttribute("aria-selected") === "true", `${width}: the empty chart leads to provider connections`);

    dashboard = structuredClone(initialDashboard);
    dashboard.history = [dashboard.history[0]];
    await page.goto(`${base}/(admin)/cost-health`);
    await page.getByTestId("cost-health-chart-empty").waitFor();
    check((await page.getByTestId("cost-health-chart-empty").innerText()).includes("No dollar readings in this range"), `${width}: an empty range does not imply missing provider connections`);
    check(await page.getByTestId("cost-health-chart-empty").getByRole("button", { name: "Manage connections" }).count() === 0, `${width}: a connected source with older data is not told to reconnect`);
    await tapControl(page, page.getByTestId("cost-health-chart-empty").getByRole("button", { name: "View 30 days" }), "view older chart readings", width);
    check(await page.locator('[data-testid^="cost-health-chart-point-"]').count() === 1, `${width}: widening an empty range reveals its actual older reading`);
    check(errors.length === 0, `${width}: no browser runtime errors`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} Cost & Health browser checks passed.`);
