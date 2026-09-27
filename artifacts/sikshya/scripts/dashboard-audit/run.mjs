import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-dashboard-audit-"));
const bundle = path.join(work, "bundle.js");
const mocks = path.join(here, "mocks.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/context/AuthContext": mocks, "@/context/NotificationContext": mocks, "@/context/DatePreferenceContext": mocks,
  "@/utils/api": mocks, "expo-router": mocks, "@react-navigation/native": mocks, "react-native-safe-area-context": mocks,
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (ok, message) => { assert.ok(ok, message); passed++; console.log("PASS " + message); };
try {
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on("pageerror", e => errors.push(String(e)));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.getByText("No classes coming up", { exact: true }).waitFor();
    const text = await page.locator("body").innerText();
    check(text.includes("Teacher account review") && text.includes("separate private ID status") && text.includes("students cannot book"), `${width}: new teacher sees distinct account and ID reviews`);
    check(!text.includes("Earned · soon") && !text.includes("Single classes"), `${width}: obsolete finance and plan tiles removed`);
    check(text.includes("after your teacher account is approved"), `${width}: first-class guidance does not promise immediate bookings`);
    const create = page.getByRole("button", { name: "New class", exact: true });
    const box = await create.boundingBox();
    check(box && box.width >= 44 && box.height >= 44 && box.y + box.height <= 844, `${width}: primary action is visible and tappable without scrolling`);
    await create.click();
    check(await page.evaluate(() => window.lastNavigation === "/(teacher)/create-class"), `${width}: create opens a fresh class`);
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    check(await page.evaluate(() => window.lastNavigation === "/(teacher)/sessions"), `${width}: schedule is explicitly named`);
    await page.getByTestId("teacher-earnings-entry").click();
    check(await page.evaluate(() => window.lastNavigation === "/payments"), `${width}: earnings opens existing records`);
    check(await page.evaluate(() => !(window.requests || []).some(x => x.includes("allowance"))), `${width}: no retired plan request`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `first-use-${width}.png`), fullPage: true });
    await page.goto(base + "?status=approved&error=1");
    await page.getByText(/Could not refresh your schedule/).waitFor();
    check(await page.getByText("No classes coming up", { exact: true }).count() === 0, `${width}: failed schedule does not claim empty`);
    check(errors.length === 0, `${width}: no browser runtime errors`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
