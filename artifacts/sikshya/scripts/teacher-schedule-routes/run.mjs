/** Actual Expo-export Teacher Schedule, synthetic records only; never contact a service. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(appRoot, process.env.TEACHER_SCHEDULE_ROUTE_UI_BUILD || "web-build");
assert.ok(output.startsWith(appRoot + path.sep), "Serve only a local app export");
const index = await readFile(path.join(output, "index.html"));
const screenshots = await mkdtemp(path.join(tmpdir(), "fadko-teacher-schedule-routes-"));
const types = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".woff": "font/woff",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = path.resolve(output, "." + (requested === "/" ? "/index.html" : requested));
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(index); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const hour = 3_600_000;
const row = (id, offset, status = "upcoming", extra = {}) => ({
  id, teacherId: 81, teacherName: "Synthetic Schedule Teacher", subject: "Mathematics",
  topic: `Synthetic lesson ${id}`, date: new Date(NOW + offset * hour).toISOString(),
  duration: 60, maxStudents: 50, enrolledCount: 24, price: 0, status, ...extra,
});
const collections = {
  upcoming: Array.from({ length: 251 }, (_, i) => row(1 + i, i + 1)),
  // Existing API returns only one live row per teacher. This larger fixture verifies
  // the UI contract without changing that server rule or creating overlapping lessons.
  live: Array.from({ length: 131 }, (_, i) => row(501 + i, i + 1, "live")),
  completed: Array.from({ length: 220 }, (_, i) => row(1001 + i, -i, "completed")),
  cancelled: Array.from({ length: 130 }, (_, i) => row(2001 + i, -500 - i, "cancelled")),
  missed: Array.from({ length: 105 }, (_, i) => row(3001 + i, -1000 - i, "upcoming", { expired: true })),
};
let browser, passed = 0;
const check = (ok, label) => { assert.ok(ok, label); passed++; console.log(`PASS ${label}`); };
const expectCount = (page, expected) => page.waitForFunction(expected =>
  document.querySelector('[data-testid="teacher-schedule-count"]')?.textContent?.trim() === expected, expected);
async function waitPending(page, controls) {
  const end = Date.now() + 15_000;
  while (!controls.pending.length && Date.now() < end) await page.waitForTimeout(20);
  assert.ok(controls.pending.length, "Expected synthetic held page request arrived before deadline");
}
async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, "Touch target is inside the viewport");
  assert.ok(await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  }), "Real navigation does not cover the action center");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

try {
  browser = await (await getChromium()).launch({ headless: true });
  for (const width of [320, 390, 1440]) {
    const viewport = { width, height: width === 1440 ? 900 : 844 };
    const page = await browser.newPage({ viewport, hasTouch: width < 1024, serviceWorkers: "block" });
    page.setDefaultTimeout(15_000);
    const requests = [], errors = [];
    const controls = { fail: null, failuresLeft: 0, hold: null, changed: null, pending: [] };
    page.on("pageerror", error => errors.push(String(error)));
    await page.addInitScript(({ now }) => {
      localStorage.setItem("@sikshya_token", "synthetic-teacher-schedule-token");
      Date.now = () => now;
      const original = window.setInterval;
      window.setInterval = (fn, delay, ...args) => {
        if (delay === 15_000 && typeof fn === "function") { window.__teacherScheduleTick = () => fn(...args); return -1; }
        return original(fn, delay, ...args);
      };
      class NoNetworkSocket extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3; readyState = 3; bufferedAmount = 0;
        constructor(url) { super(); this.url = String(url); }
        send() {} close() { this.readyState = 3; }
      }
      window.WebSocket = NoNetworkSocket;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("Fixture blocks media"); };
    }, { now: NOW });
    if (typeof page.routeWebSocket === "function") await page.routeWebSocket("**", socket => socket.close());
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return url.origin === base ? route.continue() : route.abort();
      requests.push({ path: url.pathname, method: request.method(), query: url.search });
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (request.method() !== "GET") return json({ error: "All fixture mutations are denied." }, 403);
      if (url.pathname === "/api/auth/me") return json({ id: 81, email: "synthetic-schedule@example.invalid",
        name: "Synthetic Schedule Teacher", role: "teacher", emailVerified: true, onboardingComplete: true,
        teacher: { id: 7, subject: "Math", approvalStatus: "approved" } });
      if (url.pathname === "/api/sessions") {
        assert.equal(url.searchParams.get("teacherId"), "81", "Only synthetic teacher schedule is read");
        const status = url.searchParams.get("agenda") === "missed" ? "missed" : url.searchParams.get("status");
        const number = Number(url.searchParams.get("page") ?? 1), limit = Number(url.searchParams.get("limit"));
        const key = `${status}:${number}`;
        assert.equal(limit, 100);
        if (controls.hold === key) { controls.hold = null; await new Promise(resolve => controls.pending.push(resolve)); }
        if (controls.fail === key && controls.failuresLeft > 0) { controls.failuresLeft--; return json({ error: "Synthetic connection failure" }, 503); }
        const rows = collections[status];
        assert.ok(rows, "Existing teacher status/agenda query is preserved");
        const changed = controls.changed === key;
        if (changed) controls.changed = null;
        return json({ sessions: rows.slice((number - 1) * limit, number * limit), total: rows.length + (changed ? 1 : 0), page: number, limit });
      }
      if (url.pathname === "/api/notification-events") return json({ events: [], readState: {} });
      if (url.pathname === "/api/notification-preferences") return json({ emailAvailable: false });
      if (url.pathname.includes("unread")) return json({ count: 0 });
      if (url.pathname.includes("notifications")) return json({ notifications: [], unreadCount: 0 });
      if (url.pathname === "/api/owner/access" || url.pathname === "/api/identity-review/access") return json({ allowed: false });
      return json({ error: "Unavailable in this synthetic route fixture." }, 403);
    });
    const scheduleReads = () => requests.filter(request => request.path === "/api/sessions");
    await page.goto(`${base}/sessions`);
    await expectCount(page, "100 of 251 lessons");
    check(scheduleReads().length === 1, `${width}: actual export initially reads one of three Upcoming pages`);
    check((await page.locator('[data-testid^="teacher-session-"]').first().getAttribute("data-testid")) === "teacher-session-1", `${width}: actual export keeps Upcoming nearest first`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: actual export has no horizontal overflow`);
    await page.screenshot({ path: path.join(screenshots, `${width}-upcoming.png`) });
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "200 of 251 lessons");
    check(scheduleReads().length === 2, `${width}: actual Load more is reachable above navigation and reads only page two`);
    controls.fail = "upcoming:3"; controls.failuresLeft = 2;
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check((await page.getByTestId("teacher-schedule-count").innerText()).trim() === "200 of 251 lessons", `${width}: failed GET and its bounded retry preserve 200 loaded dates`);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "251 of 251 lessons");
    check(await page.getByTestId("teacher-load-more-lessons").count() === 0, `${width}: actual retry shows all 251 and removes Load more`);
    let before = scheduleReads().length;
    await page.evaluate(() => window.__teacherScheduleTick());
    await page.waitForFunction(() => document.querySelector('[data-testid="teacher-schedule-count"]')?.textContent?.trim() === "251 of 251 lessons");
    await page.waitForTimeout(350);
    check(scheduleReads().length === before + 3, `${width}: polling rereads precisely the loaded three-page depth`);
    controls.fail = "upcoming:2"; controls.failuresLeft = 2;
    await page.evaluate(() => window.__teacherScheduleTick());
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check((await page.getByTestId("teacher-schedule-count").innerText()).trim() === "251 of 251 lessons", `${width}: failed actual refresh leaves all loaded lessons intact`);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor({ state: "hidden" });
    // Clearing an error begins the refresh; it does not prove that its two pages
    // have committed. Let this local immediate-response fixture finish before
    // installing the following held-request scenario.
    await page.waitForTimeout(200);
    await tap(page, page.getByTestId("teacher-group-live"));
    await expectCount(page, "100 of 131 lessons");
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "131 of 131 lessons");
    check(await page.getByTestId("teacher-load-more-lessons").count() === 0, `${width}: actual Live UI reads both synthetic response pages`);
    await tap(page, page.getByTestId("teacher-group-history"));
    await expectCount(page, "100 of 455 lessons");
    check((await page.locator('[data-testid^="teacher-session-"]').first().getAttribute("data-testid")) === "teacher-session-1001", `${width}: actual History merges only the complete common time frontier`);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "200 of 455 lessons");
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "455 of 455 lessons");
    check(await page.getByTestId("teacher-load-more-lessons").count() === 0, `${width}: all 455 actual-export History dates are accessible`);
    await page.screenshot({ path: path.join(screenshots, `${width}-history.png`) });
    await tap(page, page.getByTestId("teacher-group-upcoming"));
    await expectCount(page, "100 of 251 lessons");
    controls.hold = "upcoming:2";
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await waitPending(page, controls);
    await tap(page, page.getByTestId("teacher-group-live"));
    await expectCount(page, "100 of 131 lessons");
    controls.pending.splice(0).forEach(resolve => resolve());
    await page.waitForTimeout(100);
    check((await page.getByTestId("teacher-schedule-count").innerText()).trim() === "100 of 131 lessons", `${width}: late actual Upcoming response cannot replace Live`);
    before = scheduleReads().length;
    controls.hold = "live:1";
    await page.evaluate(() => { window.__teacherScheduleTick(); window.__teacherScheduleTick(); window.__teacherScheduleTick(); });
    await waitPending(page, controls);
    check(scheduleReads().length === before + 1, `${width}: actual periodic refreshes coalesce while a request is pending`);
    controls.pending.splice(0).forEach(resolve => resolve());
    await page.waitForTimeout(100);

    before = scheduleReads().length;
    controls.hold = "live:1";
    await page.evaluate(() => window.__teacherScheduleTick());
    await waitPending(page, controls);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    check((await page.getByTestId("teacher-load-more-lessons").innerText()).includes("Loading lessons"), `${width}: actual queued next-page tap gives immediate busy feedback`);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    controls.pending.splice(0).forEach(resolve => resolve());
    await expectCount(page, "131 of 131 lessons");
    check(scheduleReads().length === before + 2, `${width}: actual repeated next-page taps queue exactly one offset after refresh`);

    await tap(page, page.getByTestId("teacher-group-upcoming"));
    await expectCount(page, "100 of 251 lessons");
    controls.hold = "upcoming:1"; controls.fail = "upcoming:1"; controls.failuresLeft = 2;
    before = scheduleReads().length;
    await page.evaluate(() => window.__teacherScheduleTick());
    await waitPending(page, controls);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    controls.pending.splice(0).forEach(resolve => resolve());
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check(scheduleReads().length === before + 2 && !scheduleReads().slice(before).some(request => new URLSearchParams(request.query).get("page") === "2"), `${width}: actual failed refresh and bounded retry cancel queued offset`);
    check((await page.getByTestId("teacher-schedule-count").innerText()).trim() === "100 of 251 lessons", `${width}: actual failed queued refresh keeps loaded dates`);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor({ state: "hidden" });
    await page.waitForTimeout(200);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "200 of 251 lessons");

    controls.hold = "upcoming:2"; controls.changed = "upcoming:2";
    before = scheduleReads().length;
    await page.evaluate(() => window.__teacherScheduleTick());
    await waitPending(page, controls);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    controls.pending.splice(0).forEach(resolve => resolve());
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check(!scheduleReads().slice(before).some(request => new URLSearchParams(request.query).get("page") === "3"), `${width}: actual changed-total refresh cancels queued page three`);
    check((await page.getByTestId("teacher-schedule-count").innerText()).trim() === "200 of 251 lessons", `${width}: actual changed queued refresh keeps prior count and dates`);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor({ state: "hidden" });
    await page.waitForTimeout(200);

    controls.hold = "upcoming:1";
    before = scheduleReads().length;
    await page.evaluate(() => window.__teacherScheduleTick());
    await waitPending(page, controls);
    await tap(page, page.getByTestId("teacher-load-more-lessons"));
    await tap(page, page.getByTestId("teacher-group-live"));
    await expectCount(page, "100 of 131 lessons");
    controls.pending.splice(0).forEach(resolve => resolve());
    await page.waitForTimeout(100);
    check(!scheduleReads().slice(before).some(request => new URLSearchParams(request.query).get("status") === "upcoming" && new URLSearchParams(request.query).get("page") === "2"), `${width}: actual filter change discards queued next-page intent`);
    check(requests.every(request => request.method === "GET"), `${width}: fixture made no mutation, booking, message or payment request`);
    check(errors.length === 0, `${width}: actual exported Schedule has no browser exceptions`);
    await page.close();
  }
  console.log(`${passed} actual-export teacher Schedule checks passed. Screenshots: ${screenshots}`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
