import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-simple-class-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "api.js"),
  "expo-router": path.join(here, "router.js"),
  "@react-navigation/native": path.join(here, "router.js"),
  "@/context/AuthContext": path.join(here, "router.js"),
  "expo-crypto": path.join(here, "router.js"),
  "react-native-safe-area-context": path.resolve(here, "../batch-planner/native.js"),
  "@react-native-community/datetimepicker": path.resolve(here, "../batch-planner/native.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
  "@/hooks/useLeaveGuard": path.resolve(here, "../../hooks/useLeaveGuard.web.ts"),
} });
assert.ok(built.ok, built.error);
const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? readFileSync(bundle) : html); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
try {
  for (const [width, height, timezoneId] of [[360, 640, "Asia/Kathmandu"], [390, 844, "America/Chicago"], [1440, 900, "America/Chicago"]]) {
    const page = await browser.newPage({ viewport: { width, height }, timezoneId });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/create-class`);
    const button = (name) => page.getByRole("button", { name, exact: true });
    await button("Continue").click();
    check(await page.getByText("Class name needs a little more detail.", { exact: true }).isVisible(), `${width}: meaningful details required`);
    await page.getByLabel("Class name", { exact: true }).fill("SEE Maths evening tuition");
    await page.getByLabel("Tell students about your class", { exact: true }).fill("We solve school exercises together and make time for questions.");
    await page.getByLabel("Teaching language", { exact: true }).fill("Nepali and English");
    check(await button("Add a teaching plan (optional)").isVisible(), `${width}: formal learning path optional`);
    await page.screenshot({ path: path.join(work, `${width}-description.png`), fullPage: true });
    await button("Continue").click();
    await page.getByRole("button", { name: /^Date:/ }).click();
    await page.getByTestId("bs-next-month").click(); await page.getByTestId("bs-day-3").click(); await page.getByTestId("bs-confirm").click();
    await page.getByTestId("class-time-0").fill("16:15");
    await button("Prepare my timetable").click();
    check(await page.getByText(/lesson dates ready/).isVisible(), `${width}: actual calendar and time generate lessons`);
    await page.screenshot({ path: path.join(work, `${width}-schedule.png`), fullPage: true });
    await button("Continue").click();
    await page.getByLabel("Maximum students", { exact: true }).fill("6");
    await page.getByLabel("Price for 30 days (NPR)", { exact: true }).fill("3000");
    await button("Review my class").click();
    check(await page.getByText("NPR 3,000 per student for these 30 days", { exact: true }).isVisible(), `${width}: price has full scope`);
    check((await page.evaluate(() => window.classRequests)).length === 0, `${width}: review creates no hidden parents`);
    const footer = await button("Save draft").boundingBox();
    check(footer.y >= 0 && footer.y + footer.height <= height, `${width}: save remains visible`);
    await button("My classes").click();
    await page.getByTestId("batch-confirmation").waitFor();
    const modal = await page.getByTestId("batch-confirmation").boundingBox();
    check(modal.y >= 0 && modal.y + modal.height <= height, `${width}: leave confirmation fits viewport`);
    await page.getByTestId("warning-cancel").click();
    await page.evaluate(() => { window.failClassSave = true; });
    await button("Save draft").click();
    await page.getByText("Connection lost. Your entries are still here.", { exact: true }).waitFor();
    check(await button("Save draft").isEnabled(), `${width}: failed save keeps entries and allows retry`);
    await page.evaluate(() => { window.failClassSave = false; });
    await button("Save draft").click();
    await button("Publish class").waitFor();
    const writes = await page.evaluate(() => window.classRequests);
    check(writes.length === 2 && writes[0].input.requestKey === writes[1].input.requestKey, `${width}: retries share creation key`);
    check(writes[1].url === "/teaching-classes" && writes[1].input.outline === "" && writes[1].input.lessons.every((l) => l.time === "16:15"), `${width}: single endpoint carries description and exact Nepal timetable`);
    check((await page.evaluate(() => window.lastNavigation))?.params?.id === "1", `${width}: saved class receives stable URL`);
    await button("Publish class").click();
    check((await page.evaluate(() => window.classRequests)).length === 2, `${width}: opening confirmation is not a publish`);
    await page.screenshot({ path: path.join(work, `${width}-confirm.png`) });
    await page.getByTestId("warning-confirm").click();
    await button("Published — up to date").waitFor();
    check(await button("Published — up to date").isDisabled(), `${width}: unchanged republish disabled`);
    await page.screenshot({ path: path.join(work, `${width}-published.png`) });
    await button("Edit details").click();
    await page.getByLabel("Class name", { exact: true }).fill("SEE Maths tuition revised");
    await button("My classes").click();
    await page.getByTestId("batch-confirmation").waitFor();
    check(await page.getByText("Leave without saving?", { exact: true }).isVisible(), `${width}: leave guard rearms after saved URL navigation`);
    await page.getByTestId("warning-cancel").click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal scroll`);
    check(errors.length === 0, `${width}: no browser exceptions ${errors.join("; ")}`);
    const savedClass = await page.evaluate(() => window.savedClassFixture);
    await page.close();
    const home = await browser.newPage({ viewport: { width, height }, timezoneId });
    // A 03:00 Nepal boundary would be the previous calendar date in Chicago if formatted directly.
    const start = "2026-09-14T21:15:00.000Z", end = "2026-10-14T21:15:00.000Z";
    savedClass.batch.tuitionPeriod = { groupId: 1, index: 0, startsAt: start, endsAt: end };
    const next = structuredClone(savedClass); next.batch.id = 2; next.batch.status = "draft"; next.batch.published = null;
    next.batch.tuitionPeriod = { groupId: 1, index: 1, startsAt: end, endsAt: "2026-11-13T21:15:00.000Z" };
    await home.addInitScript((fixtures) => { window.classHomeFixtures = fixtures; }, [next, savedClass]);
    await home.goto(`http://127.0.0.1:${server.address().port}/teaching-classes`);
    await home.getByText("SEE Maths evening tuition", { exact: true }).waitFor();
    check(await home.getByText("SEE Maths evening tuition", { exact: true }).count() === 1, `${width}: one class name for current and next dates`);
    check(await home.getByRole("button", { name: /^Continue setup for/ }).count() === 1 && await home.getByRole("button", { name: /^View dates for/ }).count() === 1, `${width}: both date sets remain accessible`);
    check(await home.getByText(/Sep 15, 2026.*03:00 Nepal time until/).count() > 0, `${width}: class list pins early-morning boundaries to Nepal, not viewer timezone`);
    check(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: grouped class list fits`);
    await home.screenshot({ path: path.join(work, `${width}-classes.png`) });
    await home.close();
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
console.log(`${checks} checks passed. Screenshots: ${work}`);
