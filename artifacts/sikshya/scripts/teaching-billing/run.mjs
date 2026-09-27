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
    check(text.includes("Fadko commission (30%)") && text.includes("Your share (70%)"), `${width}: fee split appears on a specific receipt`);
    check(text.includes("estimated earnings") && text.includes("before applicable taxes"), `${width}: overview sends price-specific estimates to class setup`);
    check(text.includes("When will I get paid?") && text.includes("not money you can withdraw") && text.includes("Eligible earnings are not yet a bank transfer") && text.includes("publish the payout schedule"), `${width}: payout expectations distinguish simulation from real transfers`);
    check(text.includes("Pending test earnings") && text.includes("Transaction history"), `${width}: earnings statement is on the Profile destination`);
    check(text.includes("SEE Maths") && text.includes("Asha") && text.includes("TEST-TEACH-1"), `${width}: receipt identifies class and paying student`);
    check(!text.includes("Held by Fadko") && !text.includes("Fadko earned"), `${width}: receipt does not claim platform custody or earned fees`);
    check(text.includes("Listings only") && text.includes("does not yet collect payment"), `${width}: no fake checkout promise`);
    check(!text.includes("Tier 1") && !text.includes("Choose a plan"), `${width}: old tier picker hidden`);
    check(!text.includes("Open existing monthly class") && !text.includes("View existing sessions"), `${width}: obsolete teaching shortcuts hidden`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-billing.png`), fullPage: true });
    for (const [label, destination] of [["Prepare a class", "/(teacher)/create-class"]]) {
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
  const many = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await many.goto(`http://127.0.0.1:${server.address().port}/?many`);
  await many.getByText("Showing 8 of 25 matching loaded receipts", { exact: true }).waitFor();
  check(await many.getByTestId(/^teacher-receipt-/).count() === 8, "many receipts initially stay compact");
  await many.getByRole("button", { name: "Show more receipts (17)", exact: true }).click();
  check(await many.getByTestId(/^teacher-receipt-/).count() === 16, "teacher can progressively reveal more receipts");
  await many.getByLabel("Search receipts by class, student or reference", { exact: true }).fill("Special Student");
  check(await many.getByTestId(/^teacher-receipt-/).count() === 1 && await many.getByText("Showing 1 of 1 matching loaded receipts", { exact: true }).isVisible(), "teacher can find a specific student's receipt");
  await many.getByLabel("Search receipts by class, student or reference", { exact: true }).fill("not a real class");
  check(await many.getByText("No loaded receipts match that search.", { exact: true }).isVisible(), "receipt search has a clear empty state");
  check(await many.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "large receipt list fits a phone");
  await many.close();
  const paged = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await paged.goto(`http://127.0.0.1:${server.address().port}/?paged`);
  await paged.getByRole("button", { name: "Load older receipts", exact: true }).waitFor();
  check(await paged.getByText(/Amounts and search below cover loaded records only/).isVisible(), "partial totals are disclosed before older history loads");
  await paged.getByRole("button", { name: "Load older receipts", exact: true }).click();
  await paged.getByText("Showing 8 of 55 matching loaded receipts", { exact: true }).waitFor();
  check(await paged.getByRole("button", { name: "Load older receipts", exact: true }).count() === 0, "receipt pagination reaches older records without silently truncating history");
  await paged.getByLabel("Search receipts by class, student or reference", { exact: true }).fill("Oldest Student");
  check(await paged.getByText("Showing 1 of 1 matching loaded receipts", { exact: true }).isVisible(), "older receipt is searchable after loading");
  await paged.close();
} finally { await browser.close(); server.close(); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
