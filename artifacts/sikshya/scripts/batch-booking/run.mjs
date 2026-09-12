import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-test-booking-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "api.js"),
  "expo-router": path.resolve(here, "../class-setup/router.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0}#root{padding:16px;box-sizing:border-box;max-width:760px;margin:auto}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await (await getChromium()).launch({ headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
let passed = 0;
function check(name, condition) { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); }
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base);
    await page.getByRole("button", { name: "Try test checkout", exact: true }).click();
    await page.getByRole("button", { name: "Cancel checkout", exact: true }).click();
    check(`${width}: cancel writes nothing`, await page.evaluate(() => !window.bookingRequests));
    await page.getByRole("button", { name: "Try test checkout", exact: true }).click();
    await page.getByRole("button", { name: "Try declined payment", exact: true }).click();
    await page.getByText("Test payment declined. No money moved and no place was booked. You can try again.", { exact: true }).waitFor();
    check(`${width}: decline has no booked message`, !(await page.locator("body").innerText()).includes("Test place booked"));
    await page.getByRole("button", { name: "Try test checkout", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Simulate successful payment", exact: true });
    await confirm.waitFor();
    check(`${width}: checkout clearly says pretend and quoted value`, (await page.locator("body").innerText()).includes("Pretend payment only") && (await page.locator("body").innerText()).includes("NPR 6,000"));
    check(`${width}: no wallet or password fields`, await page.locator("input").count() === 0);
    const box = await confirm.boundingBox();
    check(`${width}: confirmation is thumb sized`, box.height >= 44 && box.width >= 44);
    await page.screenshot({ path: path.join(work, `${width}-confirm.png`), fullPage: true });
    await confirm.click();
    await page.getByRole("button", { name: "Open lesson 1", exact: true }).waitFor();
    check(`${width}: explicit test confirmation`, (await page.locator("body").innerText()).includes("Test place booked — no payment taken."));
    check(`${width}: Nepal calendar and timezone`, (await page.locator("body").innerText()).includes("2083") && (await page.locator("body").innerText()).includes("16:00 Nepal time"));
    check(`${width}: only quote and simulated outcome submitted, never client price`, await page.evaluate(() => JSON.stringify(window.bookingPayload.body)) === JSON.stringify({ quoteKey: "a".repeat(64), gateway: "fadko_test", outcome: "success" }));
    check(`${width}: receipt shows allocated money, not earnings`, (await page.locator("body").innerText()).includes("Teacher allocation: NPR 4,200") && (await page.locator("body").innerText()).includes("Not earned or paid out"));
    await page.getByRole("button", { name: "Open lesson 1", exact: true }).click();
    check(`${width}: existing session page, no time bypass`, await page.evaluate(() => JSON.stringify(window.lastNavigation)) === JSON.stringify({ pathname: "/session/[id]", params: { id: "125" } }));
    check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(work, `${width}-booked.png`), fullPage: true });
    await page.goto(base + "?teacher");
    await page.getByRole("button", { name: "Open test lessons", exact: true }).click();
    await page.getByText("Waiting for a test student", { exact: true }).waitFor();
    check(`${width}: teacher never gets student confirm control`, await page.getByRole("button", { name: "Simulate successful payment", exact: true }).count() === 0);
    await page.goto(base + "?stale");
    await page.getByRole("button", { name: "Try test checkout", exact: true }).click();
    await page.getByRole("button", { name: "Simulate successful payment", exact: true }).click();
    await page.getByText("Test booking unavailable", { exact: true }).waitFor();
    check(`${width}: failed booking never claims success`, !(await page.locator("body").innerText()).includes("Test place booked"));
    check(`${width}: stale quote cannot be resubmitted without refresh`, await page.getByRole("button", { name: "Simulate successful payment", exact: true }).count() === 0);
    await page.goto(base + "?operator");
    await page.getByRole("button", { name: "Show test receipts", exact: true }).click();
    await page.getByText("Synthetic SEE Maths", { exact: true }).waitFor();
    check(`${width}: operator sees student and test allocations`, (await page.locator("body").innerText()).includes("Synthetic Student") && (await page.locator("body").innerText()).includes("4,200 / Fadko 1,800"));
    check(`${width}: operator ledger fits screen`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(work, `${width}-operator.png`), fullPage: true });
    check(`${width}: no browser exceptions`, errors.length === 0);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
