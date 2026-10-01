/**
 * Verify the real Expo export, not an isolated component fixture.
 * Run after exporting the desired app target. All API responses are synthetic;
 * external HTTP traffic is blocked and no account or provider is contacted.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(appRoot, process.env.MAKEUPS_ROUTE_UI_BUILD || "web-build");
const screenshots = await mkdtemp(path.join(tmpdir(), "fadko-makeups-routes-"));
await readFile(path.join(output, "index.html"));
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".ico": "image/x-icon" };
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = path.resolve(output, "." + (requested === "/" ? "/index.html" : requested));
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(await readFile(path.join(output, "index.html")));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
let browser;
let passed = 0;
const check = (ok, label) => { assert.ok(ok, label); passed++; console.log("PASS " + label); };

try {
  browser = await (await getChromium()).launch({ headless: true });
  for (const width of [320, 390, 1440]) {
    for (const role of ["student", "teacher", "admin"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 768 });
      page.setDefaultTimeout(10_000);
      const requests = [];
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;
        if (!pathname.startsWith("/api/")) {
          if (url.origin === base || url.protocol === "data:") return route.continue();
          return route.abort();
        }
        requests.push(pathname);
        const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        if (pathname === "/api/auth/me") return json({
          id: 91, email: "synthetic@example.invalid", name: "Synthetic " + role,
          role, emailVerified: true, onboardingComplete: true,
          teacher: { id: 7, subject: "Math", approvalStatus: "approved" },
          student: { id: 8, grade: "10" },
        });
        if (pathname === "/api/operator/me") return json({ loginId: "synthetic", name: "Synthetic Operator", mustChangePassword: false, isAdministrator: true });
        if (pathname === "/api/admin/lesson-remedies" && role !== "admin") return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Operator access required."}' });
        if (pathname.endsWith("/lesson-remedies") || pathname.endsWith("/remedies")) return json({ enabled: true, role, serverNow: new Date().toISOString(), lessons: [], quotas: [] });
        if (pathname === "/api/owner/access" || pathname === "/api/identity-review/access") return json({ allowed: false });
        if (pathname === "/api/admin/tickets") return json({ tickets: [] });
        if (pathname === "/api/admin/overview") return json({ known: true, openTickets: 0, pendingTeachers: 0, openModeration: 0, suspendedAccounts: 0 });
        if (pathname.includes("notifications")) return json({ notifications: [], unreadCount: 0 });
        if (pathname.includes("unread")) return json({ count: 0 });
        return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Unavailable in this synthetic route test."}' });
      });
      await page.addInitScript(() => localStorage.setItem("@sikshya_token", "synthetic-route-token"));
      const expectedPath = role === "admin" ? "/operator-makeups" : "/makeups";
      const expectedApi = role === "admin" ? "/api/admin/lesson-remedies" : "/api/lesson-remedies";
      const expectedEyebrow = role === "admin" ? "Support review" : role === "teacher" ? "Teaching · Make-ups" : "My learning · Make-ups";
      const label = width + " " + role;
      async function ready(phase) {
        await page.getByText(expectedEyebrow, { exact: true }).waitFor({ state: "visible" });
        // A deep link opens the original lesson picker; the ordinary route is a request inbox.
        await page.getByText(new URL(page.url()).searchParams.has("sessionId") ? "Nothing here right now" : "No requests to arrange", { exact: true }).waitFor({ state: "visible" });
        check(new URL(page.url()).pathname === expectedPath, label + " " + phase + " keeps the intended public route");
        check(requests.includes(expectedApi), label + " " + phase + " uses the correct role API");
        check(!requests.includes(role === "admin" ? "/api/lesson-remedies" : "/api/admin/lesson-remedies"), label + " " + phase + " never selects the other role workspace");
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + " " + phase + " has no horizontal overflow");
      }
      await page.goto(base + expectedPath);
      await ready("direct");
      requests.length = 0;
      await page.reload();
      await ready("reload");

      if (role === "admin") {
        requests.length = 0;
        await page.goto(base + "/(admin)/operator-makeups?sessionId=105");
        await ready("explicit operator deep link");
        await page.getByRole("button", { name: "Show all lessons in this class", exact: true }).click();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("sessionId"));
        check(new URL(page.url()).pathname === expectedPath, label + " clearing a lesson filter keeps operator mode");
        requests.length = 0;
        await page.reload();
        await ready("cleared-filter reload");

        requests.length = 0;
        await page.goto(base + "/(admin)");
        await page.getByRole("button", { name: "Review make-up lessons and held payments", exact: true }).click();
        await ready("dashboard navigation");
        requests.length = 0;
        await page.reload();
        await ready("dashboard navigation reload");
      } else {
        await page.goto(base + "/operator-makeups");
        await page.waitForFunction(() => !location.pathname.includes("operator-makeups"));
        check(await page.getByText("Support review", { exact: true }).count() === 0, label + " is redirected away from the operator workspace");
        await page.goto(base + "/makeups");
        requests.length = 0;
        await page.reload();
        await ready("after operator denial");
      }
      check(errors.length === 0, label + " has no uncaught browser errors");
      await page.screenshot({ path: path.join(screenshots, width + "-" + role + ".png") });
      await page.close();
    }
  }
  console.log("PASS " + passed + " real-export make-up route assertions. Synthetic accounts only. Screenshots: " + screenshots);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
