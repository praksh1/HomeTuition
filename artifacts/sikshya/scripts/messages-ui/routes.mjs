/** Actual Expo export; intercepted synthetic messages only. No service or real account. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(appRoot, process.env.MESSAGE_ROUTE_UI_BUILD || "web-build");
assert.ok(output.startsWith(appRoot + path.sep), "Serve only this app's local export");
const index = await readFile(path.join(output, "index.html"));
const screenshots = await mkdtemp(path.join(tmpdir(), "fadko-message-routes-"));
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const file = path.resolve(output, "." + new URL(req.url || "/", "http://localhost").pathname);
  if (!file.startsWith(output + path.sep)) return res.writeHead(403).end();
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(index); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (ok, label) => { assert.ok(ok, label); passed++; console.log(`PASS ${label}`); };
try {
  for (const role of ["teacher", "student"]) for (const width of [320, 390, 1440]) for (const kind of ["direct", "class"]) {
    const height = width === 1440 ? 900 : 844;
    if (process.env.MESSAGE_ROUTE_UI_CASE && process.env.MESSAGE_ROUTE_UI_CASE !== `${role} ${width} ${kind}`) continue;
    const userId = role === "teacher" ? 7 : 11, otherId = role === "teacher" ? 11 : 7;
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: 1000 + i, senderId: i % 2 ? 11 : 7, receiverId: i % 2 ? 7 : 11,
      senderName: i % 2 ? "Synthetic Student" : "Synthetic Teacher", senderRole: i % 2 ? "student" : "teacher",
      body: i === 249 ? "Newest synthetic message" : `Earlier message ${i + 1}. ${"An explanation and a student's question. ".repeat(i % 7 + 1)}`,
      read: true, reactions: [], createdAt: new Date(Date.parse("2026-09-27T12:00:00Z") + i * 60_000).toISOString(),
      ...(i % 13 === 0 ? { attachments: [{ fileKey: `synthetic-photo-${i}`, fileType: "image/png", fileName: "Working.png" }], file: { fileKey: `synthetic-photo-${i}`, fileType: "image/png", fileName: "Working.png" } } : {}),
    }));
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1024, serviceWorkers: "block" });
    page.setDefaultTimeout(15_000);
    const errors = [], blocked = [], reads = [], sends = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem("@sikshya_token", "synthetic-message-route-token");
      class BlockedSocket extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3; readyState = 3; bufferedAmount = 0;
        constructor(url) { super(); this.url = String(url); } send() {} close() {}
      }
      window.WebSocket = BlockedSocket;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error("Synthetic fixture blocks media"); };
      const original = setInterval;
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 8000) window.__messageRecovery = () => callback(...args);
        return original(callback, delay, ...args);
      };
      const Original = Intl.DateTimeFormat;
      window.__messageDateWork = { constructors: 0, parts: 0 };
      Intl.DateTimeFormat = new Proxy(Original, { construct(target, args) { window.__messageDateWork.constructors++; return new target(...args); } });
      const parts = Original.prototype.formatToParts;
      Original.prototype.formatToParts = function (...args) { window.__messageDateWork.parts++; return parts.apply(this, args); };
    });
    if (page.routeWebSocket) await page.routeWebSocket("**", socket => socket.close());
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) {
        if (url.origin === base || url.protocol === "data:") return route.continue();
        blocked.push(url.origin); return route.abort();
      }
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      const endpoint = url.pathname.slice(4);
      if (endpoint === "/auth/me") return json({ id: userId, name: role === "teacher" ? "Synthetic Teacher" : "Synthetic Student", email: "synthetic@example.invalid", role, emailVerified: true, onboardingComplete: true, ...(role === "teacher" ? { teacher: { id: 51, approvalStatus: "approved", subject: "Math" } } : { student: { id: 52, grade: "Class 10" } }) });
      if (endpoint === "/notification-events") return json({ events: [], readState: {} });
      if (endpoint === "/notification-preferences") return json({ emailAvailable: false });
      if (endpoint.includes("unread")) return json({ count: 0 });
      if (endpoint === "/owner/access" || endpoint === "/identity-review/access") return json({ allowed: false });
      if (endpoint === "/notification-events/read" || endpoint.endsWith("/messages/read")) return json({});
      if (endpoint === "/message-inbox") return json({
        direct: [{ otherUserId: otherId, otherUserName: role === "teacher" ? "Synthetic Student" : "Synthetic Teacher", otherUserRole: role === "teacher" ? "student" : "teacher", lastMessage: "Newest synthetic message", lastMessageAt: rows.at(-1).createdAt, unreadCount: 1 }],
        classes: [{ batchId: 71, title: "Synthetic Maths Class", lastMessage: "Newest synthetic message", lastMessageAt: rows.at(-1).createdAt, lastSenderName: "Synthetic Student", unreadCount: 1 }],
      });
      if (endpoint.startsWith("/storage/file")) return json({ url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" });
      if (endpoint.endsWith("/access")) return json({ canSend: true, blockedByYou: false, reason: null, otherUserName: role === "teacher" ? "Synthetic Student" : "Synthetic Teacher" });
      if (endpoint === `/messages/${otherId}` || endpoint === "/class-groups/71/messages") {
        if (request.method() === "GET") {
          reads.push(endpoint);
          return json(kind === "direct" ? rows : { title: "Synthetic Maths Class", isTeacher: role === "teacher", messages: rows, pinned: [], hasEarlier: false });
        }
        if (request.method() === "POST") {
          const body = request.postDataJSON(); sends.push(body.body);
          const sent = { id: 1250 + sends.length, senderId: userId, receiverId: otherId, senderName: role === "teacher" ? "Synthetic Teacher" : "Synthetic Student", senderRole: role, body: body.body, read: false, createdAt: new Date().toISOString() };
          rows.push(sent); return json(sent, 201);
        }
      }
      return json({ error: "Unavailable in this isolated messaging fixture" }, 403);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(`${base}/messages`);
    const conversation = page.getByTestId(kind === "direct" ? `conversation-row-${otherId}` : "class-conversation-row-71");
    await conversation.click();
    const input = page.getByTestId(kind === "direct" ? "conversation-input" : "class-chat-input");
    await input.waitFor();
    const newest = page.getByText("Newest synthetic message", { exact: true });
    await newest.last().waitFor(); await page.waitForTimeout(700);
    const prefix = `${role} ${width} ${kind}`;
    const visibleLatest = async () => {
      const bubble = page.getByTestId(kind === "direct" ? "message-bubble-1249" : "class-message-1249");
      const box = await bubble.boundingBox(), compose = await input.boundingBox();
      return box && compose && box.y > 50 && box.y + box.height <= compose.y && box.x >= -1 && box.x + box.width <= width + 1;
    };
    check(await visibleLatest(), `${prefix}: actual export lands at newest of 250 messages`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${prefix}: no horizontal overflow`);
    // Focus/virtualized row measurement may finish after route navigation at 4× CPU. Wait
    // for observable formatter quiescence, not an arbitrary pause; then measure typing
    // separately. Every-character latency remains strict and independent of this wait.
    await input.focus();
    await page.evaluate(() => { window.__messageQuiet = { work: "", changedAt: performance.now() }; });
    await page.waitForFunction(() => {
      const work = JSON.stringify(window.__messageDateWork);
      if (window.__messageQuiet.work !== work) window.__messageQuiet = { work, changedAt: performance.now() };
      return performance.now() - window.__messageQuiet.changedAt >= 600;
    }, undefined, { timeout: 15_000, polling: 100 });
    await page.evaluate(() => {
      window.__messageDateWork = { constructors: 0, parts: 0 }; window.__typedPaints = [];
      const input = [...document.querySelectorAll("textarea")].find(el => el.getBoundingClientRect().height > 0);
      input.addEventListener("input", () => { const at = performance.now(); requestAnimationFrame(() => window.__typedPaints.push(performance.now() - at)); });
    });
    await input.pressSequentially("Actual route typing stays responsive", { delay: 5 });
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => ({ ...window.__messageDateWork, paints: window.__typedPaints }));
    console.log(JSON.stringify({ role, width, kind, constructorsDuringTyping: metrics.constructors, partsDuringTyping: metrics.parts }));
    check(await input.inputValue() === "Actual route typing stays responsive", `${prefix}: every keystroke appears`);
    check(metrics.constructors === 0 && metrics.parts === 0, `${prefix}: typing does not repeat timeline date work`);
    check(metrics.paints.length > 0 && Math.max(...metrics.paints) < 250, `${prefix}: four-times-slowed synthetic input paints under 250 ms`);
    console.log(JSON.stringify({ role, width, kind, maxSyntheticPaintMs: Math.round(Math.max(...metrics.paints)) }));
    await input.press("Shift+Enter");
    check((await input.inputValue()).endsWith("\n"), `${prefix}: Shift+Enter adds a deliberate line`);
    await input.press("Enter");
    await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.value === "", kind === "direct" ? "conversation-input" : "class-chat-input");
    check(sends.length === 1 && sends[0] === "Actual route typing stays responsive", `${prefix}: Enter sends once through the actual route`);
    await page.screenshot({ path: path.join(screenshots, `${role}-${width}-${kind}.png`) });
    const back = page.getByTestId(kind === "direct" ? "conversation-back-btn" : "class-chat-back");
    await back.click(); await conversation.waitFor(); await conversation.click(); await input.waitFor(); await page.waitForTimeout(600);
    const sent = page.getByText("Actual route typing stays responsive", { exact: true }).last();
    const sentBox = await sent.boundingBox(), inputBox = await input.boundingBox();
    check(sentBox && inputBox && sentBox.y > 50 && sentBox.y + sentBox.height < inputBox.y, `${prefix}: retained route reopens at the latest sent message`);
    check(errors.length === 0, `${prefix}: no browser exceptions`);
    check(blocked.length === 0, `${prefix}: no unexpected external resources attempted`);
    check(reads.length > 0, `${prefix}: intercepted synthetic read actually supplied the route`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
assert.ok(passed > 0, "The selected route fixture must execute at least one case");
console.log(`${passed} actual-export messaging checks passed. Synthetic screenshots: ${screenshots}`);
