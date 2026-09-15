import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-notifications-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/context/AuthContext": path.join(here, "auth.js"),
    "@/context/DatePreferenceContext": path.join(here, "context.js"),
    "@/context/NotificationContext": path.join(here, "context.js"),
    "expo-router": path.join(here, "router.js"),
    "expo-haptics": path.join(here, "haptics.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
    "react-native-safe-area-context": path.join(here, "context.js"),
  },
});
assert.ok(built.ok, built.error);

const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.end(req.url === "/bundle.js"
    ? readFileSync(bundle)
    : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, message) => { assert.ok(value, message); passed += 1; console.log(`PASS ${message}`); };

try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText("What needs your attention", { exact: true }).waitFor();

    const body = await page.locator("body").innerText();
    check(body.includes("30 updates are waiting for you."), `${width}: truthful unread summary is prominent`);
    check(body.includes("All 60") && body.includes("Unread 30"), `${width}: All and Unread counts are visible`);
    check(body.includes("Nepal time"), `${width}: notification times are explicitly Nepal time`);
    check(body.toLowerCase().includes("message"), `${width}: event type uses a human label`);
    check((await page.getByTestId("notifications-back").boundingBox()).height >= 44, `${width}: Back meets the touch floor`);
    check((await page.getByTestId("notification-settings").boundingBox()).height >= 44, `${width}: Settings meets the touch floor`);
    check(await page.getByTestId("notification-show-older").isVisible(), `${width}: long history is intentionally paged`);
    await page.screenshot({ path: path.join(work, `${width}-notifications-initial.png`), fullPage: true });

    await page.getByTestId("notification-n-0").click();
    await page.getByText("29 updates are waiting for you.", { exact: true }).waitFor();
    check(await page.evaluate(() => window.notificationRows.find((item) => item.id === "n-0").read), `${width}: opening an item marks that item read`);
    check(!(await page.evaluate(() => window.notificationRows.find((item) => item.id === "n-2").read)), `${width}: opening one item does not clear another unread item`);
    check(await page.evaluate(() => window.lastNavigation?.pathname === "/class-chat" && window.lastNavigation?.params?.id === "18"), `${width}: message notification opens its class conversation`);

    await page.getByTestId("notification-filter-unread").click();
    check((await page.getByTestId("notification-n-0").count()) === 0, `${width}: read item leaves the Unread view`);
    check(await page.getByTestId("notification-n-2").isVisible(), `${width}: unread item remains in the Unread view`);
    await page.getByTestId("notification-mark-all-read").click();
    await page.getByText("Nothing unread", { exact: true }).waitFor();
    check((await page.locator("body").innerText()).includes("You are all caught up."), `${width}: all-read state is calm and explicit`);

    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.screenshot({ path: path.join(work, `${width}-notifications-empty.png`), fullPage: true });

    await page.goto(`http://127.0.0.1:${server.address().port}?settings`);
    await page.getByText("Notifications & dates", { exact: true }).waitFor();
    check((await page.getByTestId("notification-settings-back").boundingBox()).height >= 44, `${width}: settings Back meets the touch floor`);
    check((await page.getByTestId("date-system-bs").boundingBox()).height >= 44, `${width}: calendar choice meets the touch floor`);
    const settingsBody = await page.locator("body").innerText();
    check(settingsBody.includes("In the app") && settingsBody.includes("By email"), `${width}: channels are clearly separated`);
    check(!settingsBody.includes("New bookings") && !settingsBody.includes("New followers"), `${width}: student does not see teacher-only switches`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: settings have no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-settings.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
