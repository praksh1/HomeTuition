/**
 * Actual participant Expo export, not an extracted component or fake screen.
 * Synthetic API contracts; deny all mutations, external HTTP, sockets and media.
 * The batch /drop-info branch is deliberately enrolled:true with NO price quote.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(appRoot, process.env.LESSON_DROP_ROUTE_UI_BUILD || "web-build");
assert.ok(output.startsWith(appRoot + path.sep), "Only a local app export can be served");
const index = await readFile(path.join(output, "index.html"));
const screenshots = await mkdtemp(path.join(tmpdir(), "fadko-lesson-drop-routes-"));
const types = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  const file = path.resolve(output, "." + (requested === "/" ? "/index.html" : requested));
  if (!file.startsWith(output + path.sep)) return res.writeHead(403).end();
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(index); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const NOW = Date.parse("2026-10-01T12:00:00Z");
const M = 60_000;
const scenarios = [
  { name: "batch-upcoming", kind: "linked", status: "upcoming", offset: 2, label: "Join the Class", enabled: true },
  { name: "batch-live", kind: "linked", status: "live", offset: -5, label: "Join the Class", enabled: true },
  { name: "batch-early", kind: "linked", status: "upcoming", offset: 25, label: "Not open yet", enabled: false },
  { name: "batch-finished", kind: "linked", status: "completed", offset: -75, label: "Session expired", enabled: false },
  { name: "batch-cancelled", kind: "linked", status: "cancelled", offset: 2, label: "Session cancelled", enabled: false },
  { name: "batch-makeup", kind: "linked", makeup: true, status: "upcoming", offset: 2, label: "Join the Class", enabled: true },
  { name: "legacy-quote", kind: "quote", status: "upcoming", offset: 25, label: "Not open yet", enabled: false },
  { name: "quote-unavailable", kind: "invalid", status: "upcoming", offset: 25, label: "Not open yet", enabled: false },
  { name: "not-enrolled", kind: "none", status: "upcoming", offset: 25, label: "Not open yet", enabled: false },
  { name: "departed-receipt", kind: "left", status: "upcoming", offset: 25, label: "Not open yet", enabled: false },
];
const viewports = [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 844, height: 390 }];
let browser;
let passed = 0;
const check = (ok, label) => { assert.ok(ok, label); passed++; console.log("PASS " + label); };
try {
  browser = await (await getChromium()).launch({ headless: true });
  for (const viewport of viewports) for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport, serviceWorkers: "block", hasTouch: viewport.width < 1024 });
    page.setDefaultTimeout(12_000);
    const requests = [];
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.addInitScript(({ now }) => {
      localStorage.setItem("@sikshya_token", "synthetic-lesson-drop-token");
      Date.now = () => now;
      class BlockedSocket extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3; readyState = 3;
        constructor(url) { super(); this.url = String(url); }
        send() {} close() {}
      }
      window.WebSocket = BlockedSocket;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic fixture denies media"); };
    }, { now: NOW });
    if (typeof page.routeWebSocket === "function") await page.routeWebSocket("**", socket => socket.close());
    await page.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return url.origin === base ? route.continue() : route.abort();
      requests.push({ path: url.pathname, method: request.method() });
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (request.method() !== "GET") return json({ error: "Synthetic test denies mutations" }, 403);
      if (url.pathname === "/api/auth/me") return json({ id: 92, name: "Synthetic Student", email: "synthetic@example.invalid", role: "student", emailVerified: true, onboardingComplete: true, student: { id: 8, grade: "10" } });
      if (url.pathname === "/api/sessions/501") return json({
        id: 501, teacherId: 91, teacherName: "Synthetic Teacher", subject: "Math", topic: "Synthetic lesson contract", description: null,
        date: new Date(NOW + scenario.offset * M).toISOString(), duration: 60, price: 501, maxStudents: 10, enrolledCount: 1,
        status: scenario.status, startedAt: scenario.status === "live" ? new Date(NOW - 5 * M).toISOString() : null,
        endedAt: scenario.status === "completed" ? new Date(NOW - M).toISOString() : null,
        classGroup: scenario.kind === "linked" ? { batchId: 701, title: "Synthetic class", lessonPosition: 3, lessonCount: 30, ...(scenario.makeup ? { makeup: true, originalSessionId: 451 } : {}) } : undefined,
      });
      if (url.pathname === "/api/sessions/501/attendance") return json({ role: "student", serverTime: new Date(NOW).toISOString(), known: true, teacherJoinedAt: null, teacherIsLate: false, teacherLateBy: null, you: { presentMs: 0 }, attendeeCount: 0 });
      if (url.pathname === "/api/sessions/501/messages") return json({ messages: [], readOnly: scenario.kind === "left" });
      if (url.pathname === "/api/sessions/501/drop-info") {
        if (scenario.kind === "linked") return json({ enrolled: true, canDrop: false, originalSessionId: scenario.makeup ? 451 : 501, bookingId: 801, position: scenario.name === "batch-upcoming" ? 0 : 3, reason: "This lesson belongs to your class purchase. Request make-up or refund review from the lesson's Help options; its original payment allocation stays linked." });
        if (scenario.kind === "quote") return json({ enrolled: true, canDrop: false, reason: "The cancellation deadline has passed.", pricePaid: 501, studentRefund: 251, teacherShare: 125, platformShare: 125, full: false, known: true, headline: "Confirmed synthetic server quote", detail: "No actual payment is used.", deadlineHours: 24 });
        if (scenario.kind === "invalid") return json({ enrolled: true, canDrop: false, reason: "Quote unavailable" });
        if (scenario.kind === "left") return json({ enrolled: false, canDrop: false, left: true, refundAmount: 251, refundPaid: false, businessDaysLeft: 3, headline: "You left this lesson.", detail: "Your refund is requested." });
        return json({ enrolled: false, canDrop: false });
      }
      if (url.pathname === "/api/notification-events") return json({ events: [], readState: {} });
      if (url.pathname === "/api/notification-preferences") return json({ emailAvailable: false });
      if (url.pathname.includes("unread")) return json({ count: 0 });
      if (url.pathname.includes("notifications")) return json({ notifications: [], unreadCount: 0 });
      if (url.pathname === "/api/owner/access" || url.pathname === "/api/identity-review/access") return json({ allowed: false });
      return json({ error: "Synthetic route unavailable" }, 403);
    });
    const label = `${viewport.width}x${viewport.height} ${scenario.name}`;
    await page.goto(`${base}/session/501`);
    try {
      await page.getByTestId("session-start-btn").waitFor({ state: "attached" });
      if (scenario.kind === "linked") await page.getByTestId("drop-linked-lesson").waitFor({ state: "attached" });
      if (scenario.kind === "quote") await page.getByTestId("drop-class").waitFor({ state: "attached" });
      if (scenario.kind === "invalid") await page.getByTestId("drop-quote-unavailable").waitFor({ state: "attached" });
      if (scenario.kind === "left") await page.getByTestId("drop-class-left").waitFor({ state: "attached" });
    } catch (error) {
      console.error("Actual exported lesson failed", JSON.stringify({ label, errors, body: await page.locator("body").innerText(), requests, screenshots }));
      await page.screenshot({ path: path.join(screenshots, `${viewport.width}-${scenario.name}-failed.png`) });
      throw error;
    }
    const body = await page.locator("body").innerText();
    check(errors.length === 0 && !body.includes("Something went wrong") && !body.includes("Reload app"), `${label}: real exported lesson remains rendered without fallback`);
    check(await page.getByTestId("session-start-btn").count() === 1, `${label}: single original Join control survives sparse response`);
    check(await page.getByTestId("session-start-btn").isEnabled() === scenario.enabled, `${label}: timing and disabled entry are unchanged`);
    check(await page.getByTestId("session-start-btn").getByText(scenario.label, { exact: true }).count() === 1, `${label}: original entry wording remains correct`);
    check(await page.getByTestId("drop-class-btn").count() === 0, `${label}: viewing a lesson never invents a cancellation action`);
    check(requests.every(row => row.method === "GET"), `${label}: no mutation while opening lesson details`);
    check(!requests.some(row => /\/(room|entry|join)$/.test(row.path)), `${label}: details never start a video call`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
    if (scenario.kind === "linked") {
      const action = page.getByTestId("drop-linked-remedies");
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      const hit = await action.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target === element || element.contains(target);
      });
      check(box && box.height >= 44 && box.y >= -1 && box.y + box.height <= viewport.height + 1 && hit, `${label}: original-lesson remedy action is visible and unobscured`);
    }
    if (scenario.name === "batch-upcoming") await page.screenshot({ path: path.join(screenshots, `${viewport.width}-batch-upcoming.png`) });
    await page.close();
  }
  console.log(`PASS ${passed} actual-export lesson/drop contract assertions across ${viewports.length * scenarios.length} cases. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
