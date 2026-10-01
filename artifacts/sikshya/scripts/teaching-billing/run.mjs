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
const homeSource = readFileSync(path.resolve(here, "../../app/(teacher)/index.tsx"), "utf8");
const earningsSource = readFileSync(path.resolve(here, "../../components/commerce/TeachingEarnings.tsx"), "utf8");
const monthlySource = readFileSync(path.resolve(here, "../../app/(teacher)/monthly.tsx"), "utf8");
assert.doesNotMatch(homeSource, /subscriptionActive|teachers\/me\/allowance|allowance\.|Teaching access|existing access/, "Home must not advertise a paid teacher-plan allowance");
assert.doesNotMatch(earningsSource, /LegacyTeacherPlans|Choose a plan/, "The main earnings route must not render a paid-plan picker");
assert.doesNotMatch(monthlySource, /cannot take payments or start lessons yet/, "Retired monthly entry must not contradict working practice classrooms");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "mocks.js"),
  "@/context/AuthContext": path.join(here, "mocks.js"),
  "@/context/NotificationContext": path.join(here, "mocks.js"),
  "@/context/DatePreferenceContext": path.resolve(here, "../sessions-ui/context.js"),
  "@react-navigation/native": path.resolve(here, "../sessions-ui/navigation.js"),
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
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.getByRole("button", { name: "Prepare a class", exact: true }).waitFor();
    const text = await page.locator("body").innerText();
    check(!text.includes("70%") && !text.includes("30%"), `${width}: overview advertises no percentage split`);
    check(text.includes("estimated earnings") && (text.includes("before applicable taxes") || text.includes("Live tax deductions are not configured yet")), `${width}: overview sends price-specific estimates to class setup`);
    check(text.includes("Pending test earnings") && text.includes("Transaction history"), `${width}: earnings statement is on the Profile destination`);
    check(!text.includes("Held by Fadko") && !text.includes("Fadko earned"), `${width}: participant view exposes no platform custody or earnings`);
    check((text.includes("Payments are not open yet") && text.includes("New paid enrollment will open when payment processing is ready")) || (text.includes("Listings only for now") && text.includes("does not yet collect payment")), `${width}: no fake checkout promise`);
    check(text.includes("When will I get paid?") && text.includes("48-hour") && text.includes("fresh 48-hour review") && text.includes("on hold"), `${width}: original and replacement payment reviews are explained before a first booking`);
    check(text.includes("not yet a bank transfer") || text.includes("does not mean paid or transferred to your bank"), `${width}: eligibility is not presented as a completed transfer`);
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
    await page.goto(base + "?practice&no-receipts&legacy-flag");
    await page.getByRole("button", { name: "Prepare a class", exact: true }).waitFor();
    const firstBooking = await page.locator("body").innerText();
    check(firstBooking.includes("48-hour") && firstBooking.includes("payout schedule"), `${width}: a teacher without receipts still learns payment timing`);
    check(firstBooking.includes("No money is collected or paid out") || firstBooking.includes("Test activity creates no real earnings or payouts"), `${width}: practice mode keeps the no-real-money disclosure`);
    check(!firstBooking.includes("Choose a plan") && !firstBooking.includes("Tier 1"), `${width}: an old backend plan flag never reopens the plan picker`);
    await page.goto(base + "?home&legacy-flag");
    await page.getByText("Next 5 of 27 lessons", { exact: true }).waitFor();
    const homeText = await page.locator("body").innerText();
    check(!/allowance|existing access|Teaching access|999999|Single classes/.test(homeText), `${width}: Home has no obsolete paid-plan or invented earnings metric`);
    check(await page.evaluate(() => !(window.billingReads || []).some((url) => url.includes("/allowance"))), `${width}: Home never requests retired plan limits`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: Home has no horizontal overflow`);
    await page.getByTestId("teacher-earnings-entry").click();
    check(await page.evaluate(() => window.lastNavigation === "/(teacher)/subscription"), `${width}: Home opens the real earnings history route`);
    await page.screenshot({ path: path.join(work, `${width}-home.png`), fullPage: true });
    await page.goto(base + "?failed");
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    check(!await page.getByText("70%", { exact: true }).count(), `${width}: failed policy fetch invents no percentage`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
