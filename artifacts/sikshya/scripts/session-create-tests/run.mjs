/**
 * The create-session allowance, refusal, and request contracts through the rendered screen.
 *
 * This is database-free and network-write-free. One fail-closed route owns every browser request:
 * local static files may load, every API call is fulfilled in memory regardless of its baked host,
 * and every other origin is blocked.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const port = Number(process.env.SESSION_CREATE_SITE_PORT ?? 8098);
const siteUrl = `http://127.0.0.1:${port}`;
const siteOrigin = new URL(siteUrl).origin;
const allowedApiOrigins = new Set([siteOrigin, "http://127.0.0.1:8080"]);
const shots = process.env.SHOT_DIR ?? path.join(appRoot, "scratch", "session-create-shots");
mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
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

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(siteUrl)).ok) return; } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the local static server did not start");
}

const teacherProfile = {
  id: 91, email: "visual-test@example.invalid", name: "Visual Test Teacher", role: "teacher",
  emailVerified: true, authProviders: ["password"], onboardingComplete: true,
  teacher: {
    id: 45, userId: 91, name: "Visual Test Teacher", email: "visual-test@example.invalid",
    subject: "Mathematics", subjects: ["Mathematics"], bio: "Browser fixture",
    approvalStatus: "approved", languages: ["Nepali"], isOnline: false,
    subscriptionActive: true, subscriptionTier: "base", maxSessionsPerMonth: 10,
    sessionsThisMonth: 0, totalStudents: 0, monthlyEarnings: 0, rating: 0, reviewCount: 0,
  },
};
const allowance = { tier: "base", tierName: "Base", limit: 10, used: 10, remaining: 0, price: 2000 };
const invitableStudents = [
  { id: 201, name: "Invite One", follower: true, pastStudent: false },
  { id: 202, name: "Invite Two", follower: false, pastStudent: true },
];
const json = (route, status, body) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(body),
});
function isCanonicalIso(value) {
  if (typeof value !== "string") return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() === value;
}

async function makeContext(browser, width, scenario) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
    isMobile: width < 600, hasTouch: width < 600, serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    localStorage.setItem("@sikshya_token", "visual-token");
    localStorage.setItem("@sikshya_date_system", JSON.stringify({ system: "ad", nepaliNumerals: false }));
    window.__sessionCreateSocketUrls = [];
    class HarnessWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        this.url = String(url); this.readyState = HarnessWebSocket.CONNECTING;
        this.protocol = ""; this.extensions = ""; this.bufferedAmount = 0; this.binaryType = "blob";
        window.__sessionCreateSocketUrls.push(this.url);
      }
      addEventListener() {} removeEventListener() {}
      send() { throw new Error("WebSocket writes are blocked by the session-create harness"); }
      close() { this.readyState = HarnessWebSocket.CLOSED; }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: HarnessWebSocket });
  });

  const traffic = { api: [], sessionWrites: [], unexpectedApi: [], unexpectedApiOrigins: [], unexpectedExternal: [] };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;

    if (!pathname.startsWith("/api/")) {
      if (url.origin === siteOrigin && (method === "GET" || method === "HEAD")) return route.continue();
      traffic.unexpectedExternal.push({ method, url: request.url() });
      return route.abort("blockedbyclient");
    }

    let body = null;
    try { body = request.postDataJSON(); } catch { /* no JSON body */ }
    const entry = { method, pathname, origin: url.origin, body };
    traffic.api.push(entry);
    if (!allowedApiOrigins.has(url.origin)) traffic.unexpectedApiOrigins.push(entry);

    if (method === "GET" && pathname === "/api/auth/me") return json(route, 200, teacherProfile);
    if (method === "GET" && pathname === "/api/teachers/me/allowance") return json(route, 200, allowance);
    if (method === "GET" && pathname === "/api/sessions/subjects") return json(route, 200, { subjects: ["Mathematics", "Science"] });
    if (method === "GET" && pathname === "/api/sessions/invitable-students") return json(route, 200, { students: invitableStudents });
    if (method === "GET" && pathname === "/api/notification-preferences") return json(route, 200, { emailAvailable: false });

    if (method === "POST" && pathname === "/api/sessions") {
      traffic.sessionWrites.push(entry);
      if (scenario === "locked") return json(route, 402, {
        error: "Your Base plan includes 10 classes every 30 days, and you already have 10 within 30 days of this date. Pick a later date, or upgrade to Tier 1 — 15 classes for NPR 2,800 a month.",
        allowance: { tier: "base", limit: 10, usedNearby: 10, freesAt: "2026-10-05T08:15:00.000Z", upgradeTo: "tier1" },
      });
      const id = scenario === "scheduled" ? 501 : 502;
      return json(route, 201, { id, topic: entry.body.topic, date: entry.body.date });
    }
    if (method === "PATCH" && pathname === "/api/sessions/502" && scenario === "go-live") {
      traffic.sessionWrites.push(entry);
      return json(route, 200, { id: 502, status: "live" });
    }

    // These explicit reads can begin after success navigation. No general API fallback exists.
    if (method === "GET" && pathname === "/api/sessions" && scenario === "scheduled") return json(route, 200, { sessions: [] });
    if (method === "GET" && pathname === "/api/monthly/plan" && scenario === "scheduled") return json(route, 404, { error: "No monthly plan in this fixture" });
    if (method === "GET" && pathname === "/api/sessions/502" && scenario === "go-live") return json(route, 200, { id: 502, status: "live" });
    if (method === "GET" && pathname === "/api/sessions/502/room" && scenario === "go-live") return json(route, 503, { error: "Video is disabled in this fixture" });

    traffic.unexpectedApi.push(entry);
    return json(route, 599, { error: `Blocked unexpected test request: ${method} ${pathname}` });
  });
  return { context, traffic };
}

function checkIsolation(label, traffic) {
  check(`${label}: no unexpected API request`, traffic.unexpectedApi.length === 0, JSON.stringify(traffic.unexpectedApi));
  check(`${label}: no staging or production API origin was baked into the build`, traffic.unexpectedApiOrigins.length === 0, JSON.stringify(traffic.unexpectedApiOrigins));
  check(`${label}: no external HTTP request escaped the local harness`, traffic.unexpectedExternal.length === 0, JSON.stringify(traffic.unexpectedExternal));
}

async function fillCommonForm(page, { topic, description, duration, maxStudents, price, invite }) {
  await page.getByPlaceholder("e.g. Calculus: Introduction to Derivatives").fill(topic);
  await page.getByPlaceholder("What will students learn in this session?").fill(description);
  await page.getByRole("button", { name: `${duration} min`, exact: true }).click();
  await page.getByRole("button", { name: String(maxStudents), exact: true }).click();
  await page.getByPlaceholder("500").fill(String(price));
  await page.getByRole("button", { name: /Notify students who follow you/ }).click();
  if (invite === "all") await page.getByRole("button", { name: "Select all", exact: true }).click();
  else await page.getByRole("checkbox", { name: /Invite One/ }).click();
}

async function openLockedAt(browser, width, label) {
  const { context, traffic } = await makeContext(browser, width, "locked");
  const page = await context.newPage();
  const errors = [];
  const dialogs = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(`${siteUrl}/session-create`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const bodyBefore = await page.locator("body").innerText();
  check(`${label}: real allowance and billing unit are visible`, /Base teaching plan/.test(bodyBefore) && /all 10 classes/.test(bodyBefore) && /NPR 2,000 per 30 days/.test(bodyBefore));
  check(`${label}: unsupported footer claims stay absent`, !/records all sessions|Copyrights belong|processed securely via eSewa\/Khalti/i.test(bodyBefore));
  check(`${label}: full summary does not claim every date is blocked`, /A different date may still fit/.test(bodyBefore));
  await page.getByPlaceholder("e.g. Calculus: Introduction to Derivatives").fill("Allowance browser check");
  await page.getByText("Create & Go Live Now", { exact: true }).click();
  await page.waitForTimeout(500);
  const bodyAfter = await page.locator("body").innerText();
  check(`${label}: exactly one create request`, traffic.sessionWrites.length === 1, `calls=${traffic.sessionWrites.length}`);
  check(`${label}: 402 becomes an in-screen locked state`, /This class does not fit your plan/.test(bodyAfter) && /View teaching-plan options/.test(bodyAfter));
  check(`${label}: 402 does not open an alert`, dialogs.length === 0, dialogs.join(" | "));
  check(`${label}: create actions are replaced while locked`, !/Create & Go Live Now/.test(bodyAfter) && !/Schedule for Later/.test(bodyAfter));
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    buttons: [...document.querySelectorAll('[role="button"]')].map((el) => {
      const rect = el.getBoundingClientRect();
      return { text: el.textContent?.trim() ?? "", width: rect.width, height: rect.height };
    }),
  }));
  check(`${label}: no horizontal overflow`, dimensions.scrollWidth <= dimensions.clientWidth, `${dimensions.scrollWidth}/${dimensions.clientWidth}`);
  const undersized = dimensions.buttons.filter((button) => button.width > 0 && button.height > 0 && (button.width < 44 || button.height < 44));
  check(`${label}: controls meet 44px touch target`, undersized.length === 0, JSON.stringify(undersized));
  check(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
  checkIsolation(label, traffic);
  await page.screenshot({ path: path.join(shots, `${label}-locked.png`), fullPage: true });
  await context.close();
}

async function verifyScheduledContract(browser) {
  const label = "scheduled request";
  const { context, traffic } = await makeContext(browser, 390, "scheduled");
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto(`${siteUrl}/session-create`, { waitUntil: "networkidle" });
  await fillCommonForm(page, { topic: "  Scheduled exact body  ", description: "  Exact scheduled description  ", duration: 45, maxStudents: 15, price: 725, invite: "all" });
  await page.getByTestId("session-date-btn").click();
  await page.getByTestId("bs-next-month").click();
  await page.getByTestId("bs-day-15").click();
  const pickedLabel = await page.getByTestId("bs-picked-echo").innerText();
  await page.getByTestId("bs-confirm").click();
  await page.locator('input[type="time"]').fill("09:30");
  const picked = new Date(pickedLabel);
  picked.setHours(9, 30, 0, 0);
  const expectedDate = picked.toISOString();
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/sessions" && candidate.request().method() === "POST");
  await page.getByRole("button", { name: "Schedule for Later", exact: true }).click();
  await response;
  await page.waitForTimeout(100);
  const writes = traffic.sessionWrites;
  const expectedBody = { subject: "Mathematics", topic: "Scheduled exact body", description: "Exact scheduled description", date: expectedDate, duration: 45, maxStudents: 15, price: 725, inviteStudentIds: [201, 202] };
  check(`${label}: exactly one POST /sessions`, writes.length === 1 && writes[0].method === "POST" && writes[0].pathname === "/api/sessions", JSON.stringify(writes));
  check(`${label}: exact scheduled POST body`, isDeepStrictEqual(writes[0]?.body, expectedBody), JSON.stringify(writes[0]?.body));
  check(`${label}: date is canonical ISO`, isCanonicalIso(writes[0]?.body?.date));
  checkIsolation(label, traffic);
  await context.close();
}

async function verifyGoLiveContract(browser) {
  const label = "go-live request";
  const { context, traffic } = await makeContext(browser, 390, "go-live");
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto(`${siteUrl}/session-create`, { waitUntil: "networkidle" });
  await fillCommonForm(page, { topic: "  Go live exact body  ", description: "  Exact live description  ", duration: 30, maxStudents: 5, price: 900, invite: "one" });
  const earliest = Date.now() - 1000;
  const patchResponse = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/sessions/502" && candidate.request().method() === "PATCH");
  await page.getByRole("button", { name: "Create & Go Live Now", exact: true }).click();
  await patchResponse;
  const latest = Date.now() + 1000;
  const [post, patch] = traffic.sessionWrites;
  const expectedPostBody = { subject: "Mathematics", topic: "Go live exact body", description: "Exact live description", date: post?.body?.date, duration: 30, maxStudents: 5, price: 900, inviteStudentIds: [201] };
  const liveTime = Date.parse(post?.body?.date);
  check(`${label}: POST then PATCH exactly once`, traffic.sessionWrites.length === 2 && post?.method === "POST" && post?.pathname === "/api/sessions" && patch?.method === "PATCH" && patch?.pathname === "/api/sessions/502", JSON.stringify(traffic.sessionWrites));
  check(`${label}: exact create POST body`, isDeepStrictEqual(post?.body, expectedPostBody), JSON.stringify(post?.body));
  check(`${label}: live date is canonical ISO and generated now`, isCanonicalIso(post?.body?.date) && liveTime >= earliest && liveTime <= latest, String(post?.body?.date));
  check(`${label}: exact PATCH status body`, isDeepStrictEqual(patch?.body, { status: "live" }), JSON.stringify(patch?.body));
  checkIsolation(label, traffic);
  await context.close();
}

await waitForSite();
const chromium = await getChromium();
const browser = await chromium.launch();
try {
  await openLockedAt(browser, 390, "phone-390x844");
  await openLockedAt(browser, 1440, "laptop-1440x900");
  await verifyScheduledContract(browser);
  await verifyGoLiveContract(browser);
} finally { await browser.close(); stop(); }

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
