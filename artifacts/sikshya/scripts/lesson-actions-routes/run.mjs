/**
 * Exercise the actual participant Expo export's lesson action dock.
 * Run only after rebuilding web-build (or LESSON_ACTION_ROUTE_UI_BUILD).
 * All accounts, attendance and messages are synthetic. Every API request is
 * intercepted; external HTTP, WebSockets and device media are blocked. No API
 * server, database, provider, real account, booking or payment is used.
 * Chromium viewports are layout evidence, not physical iOS/Android evidence.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(appRoot, process.env.LESSON_ACTION_ROUTE_UI_BUILD || "web-build");
assert.ok(output.startsWith(appRoot + path.sep), "Only a local app export can be served");
const index = await readFile(path.join(output, "index.html"));
const screenshots = await mkdtemp(path.join(tmpdir(), "fadko-lesson-actions-routes-"));
const types = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".ttf": "font/ttf",
  ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = path.resolve(output, "." + (requested === "/" ? "/index.html" : requested));
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
  } catch {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(index);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const MINUTE = 60_000;
const SERVER_NOW = Date.parse("2026-10-01T12:00:00.000Z");
const SESSION_ID = 501;
const OWNER_ID = 91;
const STUDENT_ID = 92;
const viewports = [
  { name: "320-phone", width: 320, height: 740 },
  { name: "390-phone", width: 390, height: 844 },
  { name: "1440-desktop", width: 1440, height: 900 },
  { name: "844-phone-landscape", width: 844, height: 390 },
];
const scenarios = [
  { name: "teacher-open", role: "teacher", offset: 2, label: "Open the Session", enabled: true, long: true, navigate: true },
  { name: "student-open", role: "student", offset: 2, label: "Join the Class", enabled: true, long: true, navigate: true },
  { name: "teacher-live", role: "teacher", offset: -5, status: "live", label: "Rejoin the session", enabled: true },
  { name: "teacher-early", role: "teacher", offset: 25, label: "Not open yet", enabled: false },
  { name: "student-early", role: "student", offset: 25, label: "Not open yet", enabled: false },
  { name: "teacher-cancelled", role: "teacher", offset: 2, status: "cancelled", label: "Session cancelled", enabled: false },
  { name: "student-cancelled", role: "student", offset: 2, status: "cancelled", label: "Session cancelled", enabled: false },
  { name: "teacher-expired", role: "teacher", offset: -75, status: "completed", label: "Session expired", enabled: false },
  { name: "student-expired", role: "student", offset: -75, status: "completed", label: "Session expired", enabled: false },
  { name: "teacher-completed-recovery", role: "teacher", offset: -62, status: "completed", label: "Reopen the session", enabled: true, navigate: true },
  { name: "student-completed-grace", role: "student", offset: -62, status: "completed", label: "Join the Class", enabled: true, navigate: true },
  { name: "teacher-at-cutoff", role: "teacher", offset: -70, status: "completed", label: "Reopen the session", enabled: true },
  { name: "student-at-cutoff", role: "student", offset: -65, status: "completed", label: "Join the Class", enabled: true },
  { name: "teacher-one-ms-past-cutoff", role: "teacher", offset: -70, serverExtra: 1, status: "completed", label: "Session expired", enabled: false },
  { name: "student-one-ms-past-cutoff", role: "student", offset: -65, serverExtra: 1, status: "completed", label: "Session expired", enabled: false },
  { name: "teacher-fast-phone-clock", role: "teacher", offset: 25, deviceOffset: 40, label: "Not open yet", enabled: false },
  { name: "student-fast-phone-clock", role: "student", offset: 25, deviceOffset: 40, label: "Not open yet", enabled: false },
  { name: "teacher-profile-not-lesson-owner", role: "teacher", userId: 93, offset: 2, label: "Join the Class", enabled: true, noAttendance: true },
];

let browser;
let passed = 0;
const check = (ok, label) => { assert.ok(ok, label); passed++; console.log("PASS " + label); };
const rectWithin = (box, viewport) => box && box.x >= -1 && box.y >= -1 && box.width >= 44 && box.height >= 44 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
function previousActionIsInactive() {
  const button = document.querySelector('[data-testid="session-details-page"] [data-testid="session-start-btn"]');
  if (!button) return true;
  const rect = button.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return true;
  const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return target !== button && !button.contains(target);
}
const fixtureSession = scenario => ({
  id: SESSION_ID, teacherId: OWNER_ID, teacherName: "Synthetic Teacher",
  subject: "Mathematics", topic: "Synthetic lesson with a large class",
  description: "A synthetic lesson for the local action-dock layout test. No real class is accessed.",
  date: new Date(SERVER_NOW + scenario.offset * MINUTE).toISOString(), duration: 60,
  price: 500, maxStudents: 50, enrolledCount: 50, status: scenario.status ?? "upcoming",
  startedAt: scenario.status === "completed" || scenario.status === "live"
    ? new Date(SERVER_NOW + scenario.offset * MINUTE).toISOString() : null,
  endedAt: scenario.status === "completed" ? new Date(SERVER_NOW - MINUTE).toISOString() : null,
  serverTime: new Date(SERVER_NOW + (scenario.serverExtra ?? 0)).toISOString(),
  classGroup: { batchId: 701, title: "Synthetic Maths Class", lessonPosition: 1, lessonCount: 30 },
});
const roster = Array.from({ length: 50 }, (_, index) => ({
  userId: 1000 + index, name: `Synthetic student ${String(index + 1).padStart(2, "0")}`,
  attended: index % 2 === 0, presentMs: index % 2 === 0 ? 15 * MINUTE : 0,
  joinCount: index % 2 === 0 ? 1 : 0, firstJoinedAt: null, lastSeenAt: null,
  enrolledAt: new Date(SERVER_NOW - 24 * 60 * MINUTE).toISOString(),
}));
const messages = Array.from({ length: 16 }, (_, index) => ({
  id: 2000 + index, senderId: index % 2 === 0 ? OWNER_ID : STUDENT_ID,
  senderName: index % 2 === 0 ? "Synthetic Teacher" : "Synthetic Student",
  senderRole: index % 2 === 0 ? "teacher" : "student", mine: false,
  body: `Synthetic message ${String(index + 1).padStart(2, "0")}. ${"This longer message checks that the class conversation stays readable and reachable above the lesson dock. ".repeat(3)}`,
  createdAt: new Date(SERVER_NOW - (16 - index) * MINUTE).toISOString(),
}));

async function fixturePage(viewport, scenario) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.width < 1024, serviceWorkers: "block" });
  page.setDefaultTimeout(12_000);
  const requests = [];
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.addInitScript(({ deviceNow }) => {
    localStorage.setItem("@sikshya_token", "synthetic-lesson-action-token");
    // Both heardAt and tick stay on the same synthetic device clock. The API's
    // serverTime remains independent, so a fast handset cannot open early doors.
    Date.now = () => deviceNow;
    window.__lessonActionFixture = { mediaCalls: 0, sockets: [], navigations: [] };
    const fixture = window.__lessonActionFixture;
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method].bind(history);
      history[method] = (state, title, url) => {
        fixture.navigations.push({ method, url: String(url ?? ""), state });
        return original(state, title, url);
      };
    }
    // No socket constructor ever reaches the network. Constants/event hooks
    // match the surface used by Fadko's reconnecting notification channel.
    class BlockedWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3;
      readyState = 3; bufferedAmount = 0; extensions = ""; protocol = ""; binaryType = "blob";
      constructor(url) {
        super(); this.url = String(url); fixture.sockets.push(this.url);
        queueMicrotask(() => {
          const error = new Event("error"); this.onerror?.(error); this.dispatchEvent(error);
          const closed = new CloseEvent("close", { code: 1006, reason: "Synthetic fixture blocks all WebSockets" });
          this.onclose?.(closed); this.dispatchEvent(closed);
        });
      }
      send() {} close() { this.readyState = 3; }
    }
    window.WebSocket = BlockedWebSocket;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => {
        fixture.mediaCalls++;
        throw new Error("Synthetic lesson fixture blocks device media");
      };
    }
  }, { deviceNow: SERVER_NOW + (scenario.deviceOffset ?? 0) * MINUTE });
  if (typeof page.routeWebSocket === "function") await page.routeWebSocket("**", socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      if (url.origin === base || url.protocol === "data:") return route.continue();
      return route.abort();
    }
    requests.push({ path: url.pathname, method: request.method(), query: url.search });
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") return json({ error: "All mutations are denied by this synthetic fixture." }, 403);
    const pathname = url.pathname;
    if (pathname === "/api/auth/me") return json({
      id: scenario.userId ?? (scenario.role === "teacher" ? OWNER_ID : STUDENT_ID),
      email: "synthetic-lesson@example.invalid", name: `Synthetic ${scenario.role}`,
      role: scenario.role, emailVerified: true, onboardingComplete: true,
      teacher: { id: 7, subject: "Math", approvalStatus: "approved" }, student: { id: 8, grade: "10" },
    });
    if (pathname === `/api/sessions/${SESSION_ID}`) return json(fixtureSession(scenario));
    if (pathname === `/api/sessions/${SESSION_ID}/attendance`) {
      if (scenario.noAttendance) return json({ error: "Synthetic non-member has no register access." }, 403);
      return json({
        role: scenario.role, serverTime: new Date(SERVER_NOW + (scenario.serverExtra ?? 0)).toISOString(),
        known: true, teacherJoinedAt: null, teacherIsLate: false, teacherLateBy: null,
        enrolled: scenario.role === "teacher" ? roster : undefined, findings: [],
        teacher: null, you: { presentMs: 0 }, attendeeCount: 0,
      });
    }
    if (pathname === `/api/sessions/${SESSION_ID}/messages`) return json({ messages, readOnly: false });
    if (pathname === `/api/sessions/${SESSION_ID}/schedule-info`) return json({
      canMove: false, reason: "This synthetic lesson is too close to move.", editsUsed: 0,
      editsAllowed: 5, editsLeft: 5, lockHours: 24, minNoticeHours: 24, lastMovedAt: null, paidStudents: 50, priceLocked: true,
    });
    if (pathname === `/api/sessions/${SESSION_ID}/drop-info`) return json(scenario.role === "student" ? {
      // Match the actual batch-allocation branch in routes/drops.ts. An enrolled
      // class-purchase lesson is not a legacy single-session cancellation quote.
      enrolled: true, canDrop: false, originalSessionId: SESSION_ID,
      bookingId: 801, position: 0,
      reason: "This lesson belongs to your class purchase. Request make-up or refund review from the lesson's Help options; its original payment allocation stays linked.",
    } : { enrolled: false, canDrop: false });
    if (pathname === `/api/sessions/${SESSION_ID}/room`) return json({
      error: "Synthetic classroom entry stopped without creating a video room.", code: "finished", expired: true,
    }, 409);
    if (pathname === "/api/notification-events") return json({ events: [], readState: {} });
    if (pathname === "/api/notification-preferences") return json({ emailAvailable: false });
    if (pathname.includes("unread")) return json({ count: 0 });
    if (pathname.includes("notifications")) return json({ notifications: [], unreadCount: 0 });
    if (pathname === "/api/owner/access" || pathname === "/api/identity-review/access") return json({ allowed: false });
    return json({ error: "Unavailable in this synthetic lesson route fixture." }, 403);
  });
  return { page, requests, errors };
}

async function assertDock(page, viewport, label, expectedY = null) {
  const dock = page.getByTestId("session-action-dock");
  const button = page.getByTestId("session-start-btn");
  const scroll = page.getByTestId("session-details-scroll");
  const buttonBox = await button.boundingBox();
  const dockBox = await dock.boundingBox();
  const scrollBox = await scroll.boundingBox();
  check(await button.count() === 1, `${label}: only one lesson action exists`);
  check(rectWithin(buttonBox, viewport), `${label}: action is fully inside the viewport and at least 44px high`);
  check(dockBox && scrollBox && scrollBox.y + scrollBox.height <= dockBox.y + 1, `${label}: dock never overlaps the scrollable register or conversation`);
  const structure = await dock.evaluate(element => {
    const scroll = document.querySelector('[data-testid="session-details-scroll"]');
    const style = getComputedStyle(element);
    return { siblings: scroll?.parentElement === element.parentElement, position: style.position };
  });
  check(structure.siblings && !["absolute", "fixed", "sticky"].includes(structure.position), `${label}: dock stays an in-flow sibling, not a canvas overlay`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
  if (expectedY !== null) check(Math.abs(buttonBox.y - expectedY) <= 1, `${label}: scrolling does not move the lesson action`);
  const hit = await button.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return target === element || element.contains(target);
  });
  check(hit, `${label}: the action center is an unobscured hit target`);
  return buttonBox;
}

try {
  browser = await (await getChromium()).launch({ headless: true });
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const label = `${viewport.name} ${scenario.name}`;
      const { page, requests, errors } = await fixturePage(viewport, scenario);
      await page.goto(`${base}/session/${SESSION_ID}`);
      const button = page.getByTestId("session-start-btn");
      await button.waitFor({ state: "visible" });
      try {
        await page.waitForFunction(({ label, enabled }) => {
          const button = document.querySelector('[data-testid="session-start-btn"]');
          const disabled = button?.matches(":disabled") || button?.getAttribute("aria-disabled") === "true";
          // The icon contributes a private-use glyph to textContent; the label
          // is the separate last child. RN Web omits aria-disabled=false on an
          // enabled native button, so test semantic disabled state instead.
          return button?.lastElementChild?.textContent?.trim() === label && disabled === !enabled;
        }, { label: scenario.label, enabled: scenario.enabled });
      } catch (error) {
        const diagnostic = await button.evaluate(element => ({
          text: element.textContent, html: element.outerHTML,
          ariaDisabled: element.getAttribute("aria-disabled"),
          role: element.getAttribute("role"), tabIndex: element.getAttribute("tabindex"),
          pointerEvents: getComputedStyle(element).pointerEvents,
        }));
        await page.screenshot({ path: path.join(screenshots, `${viewport.name}-${scenario.name}-readiness-failure.png`) });
        console.error("Synthetic action readiness diagnostic:", JSON.stringify({ label, diagnostic, errors, requests, screenshots }));
        throw error;
      }
      check(await button.getByText(scenario.label, { exact: true }).count() === 1, `${label}: existing timing/owner action label is preserved`);
      check(await button.isEnabled() === scenario.enabled, `${label}: native/accessible enabled and disabled timing state is preserved`);
      const box = await assertDock(page, viewport, `${label} initial`);
      check(!requests.some(row => /\/(room|entry|join)$/.test(row.path) || row.method !== "GET"), `${label}: viewing lesson details never starts classroom/media or mutates data`);
      check(await page.evaluate(() => window.__lessonActionFixture.mediaCalls === 0), `${label}: no device media was requested`);
      if (!scenario.enabled) {
        const reason = page.getByTestId("session-start-reason");
        check(await reason.isVisible() && (await reason.innerText()).trim().length > 0, `${label}: disabled action gives its existing explanation`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        check(new URL(page.url()).pathname === `/session/${SESSION_ID}`, `${label}: disabled coordinate tap cannot enter a classroom`);
      }
      if (scenario.long) {
        await page.getByTestId("session-thread-input").waitFor({ state: "attached" });
        if (scenario.role === "teacher") {
          const lastStudent = page.getByText("Synthetic student 50", { exact: true });
          check(await lastStudent.count() === 1, `${label}: all 50 synthetic register entries render`);
          await lastStudent.scrollIntoViewIfNeeded();
          const studentBox = await lastStudent.boundingBox();
          const dockBox = await page.getByTestId("session-action-dock").boundingBox();
          check(studentBox && dockBox && studentBox.y >= 0 && studentBox.y + studentBox.height <= dockBox.y + 1, `${label}: last register entry is reachable above the dock`);
          await assertDock(page, viewport, `${label} at last student`, box.y);
        }
        const lastMessage = page.getByText(messages.at(-1).body, { exact: true });
        await lastMessage.scrollIntoViewIfNeeded();
        const messageBox = await lastMessage.boundingBox();
        const dockBox = await page.getByTestId("session-action-dock").boundingBox();
        check(messageBox && dockBox && messageBox.y >= 0 && messageBox.y + messageBox.height <= dockBox.y + 1, `${label}: long final message is reachable without the dock covering it`);
        const composer = page.getByTestId("session-thread-input");
        await composer.scrollIntoViewIfNeeded();
        const composerBox = await composer.boundingBox();
        check(composerBox && dockBox && composerBox.y >= 0 && composerBox.y + composerBox.height <= dockBox.y + 1, `${label}: message composer remains reachable above the dock`);
        await assertDock(page, viewport, `${label} after conversation scroll`, box.y);
        await page.screenshot({ path: path.join(screenshots, `${viewport.name}-${scenario.name}.png`) });
      }
      if (scenario.navigate) {
        const target = await button.boundingBox();
        // Expo's public URL drops route-group names. Observe the actual entry
        // branch too: teacher recovery PATCHes first; student entry never does.
        // Both are denied locally before a room/token can ever be supplied.
        const expectedEntryMethod = scenario.name === "teacher-completed-recovery" ? "PATCH" : "GET";
        const expectedEntryPath = expectedEntryMethod === "PATCH" ? `/api/sessions/${SESSION_ID}` : `/api/sessions/${SESSION_ID}/room`;
        const entryResponse = page.waitForResponse(response => {
          const request = response.request();
          return request.method() === expectedEntryMethod && new URL(response.url()).pathname === expectedEntryPath;
        });
        // A normal coordinate tap tests the actual center hit target. It is not
        // a forced DOM click and does not scroll the action into view for us.
        await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
        await page.waitForFunction(() => window.__lessonActionFixture.navigations.some(row => /\/classroom\/501(?:[/?#]|$)/.test(row.url)));
        const navigations = await page.evaluate(() => window.__lessonActionFixture.navigations);
        check(navigations.some(row => /\/classroom\/501(?:[/?#]|$)/.test(row.url)), `${label}: unforced action tap reaches the existing classroom route`);
        await entryResponse;
        check(requests.some(row => row.method === expectedEntryMethod && row.path === expectedEntryPath), `${label}: the existing role-specific classroom entry branch runs`);
        if (scenario.role === "student") check(!requests.some(row => row.method !== "GET"), `${label}: student classroom entry never attempts teacher start/recovery`);
        // Expo's Stack can retain the previous detail DOM behind the active
        // screen. Its removal is not the navigation contract; the changed URL
        // and real classroom entry request are the evidence we need here.
        await page.waitForURL(url => /\/classroom\/501(?:\/|$)/.test(url.pathname));
        check(new URL(page.url()).pathname !== `/session/${SESSION_ID}`, `${label}: classroom becomes the active route without requiring old Stack DOM removal`);
        await page.waitForFunction(previousActionIsInactive);
        check(await page.evaluate(previousActionIsInactive), `${label}: a retained Stack detail action is hidden or cannot intercept a classroom tap`);
        check(await page.evaluate(() => window.__lessonActionFixture.mediaCalls === 0), `${label}: fixture never grants a real call or asks for media after navigation`);
      }
      check(errors.length === 0, `${label}: no uncaught browser errors`);
      await page.close();
    }
  }
  console.log(`PASS ${passed} actual-export lesson-action assertions. Synthetic accounts only. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
