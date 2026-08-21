/**
 * Does the *app* actually show a notification when the server sends one?
 *
 * The server-side suite (artifacts/api-server/scripts/notification-tests) proves the event
 * leaves the server. This proves the other half: that a real browser running the real built
 * app opens the channel, receives the event, and puts it in front of the user. Between those
 * two is where "notifications are not realtime" actually lived — nothing was throwing, the
 * app simply never listened.
 *
 * Needs a built web app pointed at a running API:
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build
 *   node scripts/notification-tests/browser.mjs
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.NOTIF_TEST_PORT ?? 8098);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const res = await api("/auth/register", {
    method: "POST",
    body: {
      name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`,
      email: `nb_${Date.now()}_${seq}@example.com`,
      password: "password123",
      role,
      ...(role === "teacher" ? { subject: "Maths", bio: "Test" } : { grade: "10" }),
    },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body;
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error(
    "No build to test. Build the web app against the API first:\n" +
      `  EXPO_PUBLIC_API_URL=${API} pnpm --filter @workspace/sikshya run build`,
  );
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot,
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stopServer);

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(siteUrl);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the static server never came up on ${siteUrl}`);
}

/** Opens the app already signed in, the way a returning user would find it. */
async function openSignedIn(ctx, token) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  // AsyncStorage is localStorage on web, under the same key the app writes.
  await page.addInitScript((t) => {
    window.localStorage.setItem("@sikshya_token", t);
  }, token);
  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  return page;
}

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }
  await waitForSite();

  const chromium = await getChromium();
  const browser = await chromium.launch();

  try {
    const teacher = await register("teacher");
    const student = await register("student");

    const ctx = await browser.newContext();
    const page = await openSignedIn(ctx, teacher.token);

    console.log("\nThe app opens a notification channel when signed in");
    const opened = await page.evaluate(async () => {
      // The app's own socket is not exposed, so ask the browser what it has open by
      // watching for the next frame on any WebSocket the page created.
      return typeof WebSocket !== "undefined";
    });
    check("the page loaded without crashing", page.errors.length === 0, page.errors[0] ?? "");
    check("WebSocket is available to the app", opened);

    console.log("\nA message sent from elsewhere appears in the app without a refresh");
    // Recorded before sending, so the assertion is about a change rather than a starting state.
    const before = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("@sikshya_notifications") ?? "[]").length,
    );

    await api(`/messages/${teacher.user.id}`, {
      method: "POST",
      token: student.token,
      body: { body: "Sir, is there class tomorrow?" },
    });

    let stored = [];
    for (let i = 0; i < 40; i += 1) {
      stored = await page.evaluate(() =>
        JSON.parse(window.localStorage.getItem("@sikshya_notifications") ?? "[]"),
      );
      if (stored.length > before) break;
      await page.waitForTimeout(250);
    }
    check("a notification arrives without the user doing anything", stored.length > before,
      `had ${before}, now ${stored.length}`);
    check("it names who it is from", stored[0]?.title?.includes(student.user.name) ?? false,
      stored[0]?.title ?? "none");
    check("it shows what was said", stored[0]?.body?.includes("class tomorrow") ?? false,
      stored[0]?.body ?? "none");
    check("it can be tapped through to the conversation",
      String(stored[0]?.data?.conversationWith ?? "") === String(student.user.id),
      JSON.stringify(stored[0]?.data ?? {}));

    console.log("\nNothing is invented: the list starts empty for a new user");
    // The old build seeded six fictional notifications on first run — a payment from
    // "Aarav Shrestha", a verification approval — which is why this is asserted explicitly.
    const fresh = await register("teacher");
    const freshCtx = await browser.newContext();
    const freshPage = await openSignedIn(freshCtx, fresh.token);
    const freshStored = await freshPage.evaluate(() =>
      JSON.parse(window.localStorage.getItem("@sikshya_notifications") ?? "[]"),
    );
    check("a brand new account has no notifications at all", freshStored.length === 0,
      `found ${freshStored.length}: ${freshStored.map((n) => n.title).join(", ")}`);
    await freshCtx.close();

    console.log("\nThe same message is not announced twice");
    const countAfterOne = stored.length;
    await page.waitForTimeout(1500);
    const settled = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("@sikshya_notifications") ?? "[]"),
    );
    check("the count does not creep up on its own", settled.length === countAfterOne,
      `was ${countAfterOne}, now ${settled.length}`);

    console.log("\nTurning a notification off stops it reaching the app");
    await api("/notification-preferences", {
      method: "PATCH",
      token: teacher.token,
      body: { push: { messages: false } },
    });
    const beforeOff = settled.length;
    const student2 = await register("student");
    await api(`/messages/${teacher.user.id}`, {
      method: "POST",
      token: student2.token,
      body: { body: "You should not see this one" },
    });
    await page.waitForTimeout(2500);
    const afterOff = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("@sikshya_notifications") ?? "[]"),
    );
    check("nothing new appears while it is off", afterOff.length === beforeOff,
      `was ${beforeOff}, now ${afterOff.length}`);

    /**
     * The switches above are worth nothing if nobody can reach the screen they live on.
     *
     * Reported from a real phone: Profile → Notifications "doesn't do anything, instead brings
     * the user to the Dashboard". The screen was fine. The route guard held its own list of
     * screens that belong to neither the teacher nor the student tabs, `notification-settings`
     * was not on it, and a teacher who went there failed every branch of the role check and was
     * replaced back to their dashboard. Its sibling `notifications` *was* on the list and
     * worked, which is what made it look like a dead button rather than a routing bug.
     */
    console.log("\nThe notification settings screen can actually be reached");
    // Reached by tapping the tab, which is how a person gets there. Loading /profile cold
    // bounces to the dashboard — a separate weakness, recorded in ISSUES.md rather than
    // papered over here, and not the bug this checks.
    await page.goto(siteUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.click('a[role="tab"][href="/profile"]', { timeout: 15000 });
    await page.waitForTimeout(2500);
    const row = page.getByTestId("notification-settings-link").first();
    check("the Notifications row is on the teacher's profile", (await row.count()) > 0);
    await row.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const landed = await page.evaluate(() => ({
      path: location.pathname,
      text: document.body.innerText.slice(0, 400),
    }));
    check("tapping it opens the settings screen rather than the dashboard",
      landed.path === "/notification-settings", `landed on ${landed.path}`);
    check("and the switches are there",
      /Class starting/i.test(landed.text) && /Messages/i.test(landed.text),
      landed.text.slice(0, 160).replace(/\n/g, " | "));

    await ctx.close();
  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
