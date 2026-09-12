import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-teaching-billing-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "mocks.js"),
  "@/components/legacy/LegacyTeacherPlans": path.join(here, "mocks.js"),
  "react-native-safe-area-context": path.join(here, "mocks.js"),
  "expo-router": path.resolve(here, "../class-setup/router.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
function check(value, message) { assert.ok(value, message); passed++; console.log(`PASS ${message}`); }
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.getByRole("button", { name: "Prepare a class", exact: true }).waitFor();
    const text = await page.locator("body").innerText();
    check(text.includes("70%") && !text.includes("30%"), `${width}: teacher share is visible without Fadko's internal share`);
    check(text.includes("Expected test earnings") && text.includes("Pending test earnings"), `${width}: earnings history is on the Profile destination`);
    check(!text.includes("Held by Fadko") && !text.includes("Fadko earned") && !text.includes("Fadko fee"), `${width}: participant view exposes no platform custody or earnings`);
    check(text.includes("Listings only") && text.includes("does not yet collect payment"), `${width}: no fake checkout promise`);
    check(text.includes("homework") && text.includes("messages"), `${width}: existing learning tools preserved in copy`);
    check(!text.includes("Tier 1") && !text.includes("Choose a plan"), `${width}: old tier picker hidden`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-billing.png`), fullPage: true });
    for (const [label, destination] of [["Prepare a class", "/(teacher)/create-class"], ["Open existing monthly class", "/(teacher)/monthly"], ["View existing sessions", "/(teacher)/sessions"]]) {
      const control = page.getByRole("button", { name: label, exact: true });
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      check(box.height >= 44 && box.width >= 44, `${width}: ${label} touch target`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      check(await page.evaluate(() => window.lastNavigation) === destination, `${width}: ${label} destination`);
    }
    await page.goto(base + "?failed");
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    check(!await page.getByText("70%", { exact: true }).count(), `${width}: failed policy fetch invents no percentage`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
