import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const other = path.resolve(here, "../class-setup");
const work = mkdtempSync(path.join(tmpdir(), "fadko-teaching-classes-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/utils/api": path.join(other, "api.js"),
    "expo-router": path.join(other, "router.js"),
    "react-native-safe-area-context": path.resolve(here, "../batch-planner/native.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
  },
});
assert.ok(built.ok, built.error);

const classItem = (id, title, status, startsAt, enrolledCount, nextLessonAt) => {
  const lessons = [{ id, position: 0, startsAt, durationMinutes: 60 }];
  const batch = {
    id, programId: id, currentProgramVersion: 1, format: "fixed", status,
    capacity: 8, totalTuitionNpr: 7000, version: 1, publishedAt: startsAt,
    lessons, updatedAt: startsAt,
    published: status === "published" ? {
      batchId: id, programId: id, programVersion: 1, version: 1,
      capacity: 8, totalTuitionNpr: 7000, lessons,
    } : null,
  };
  return {
    title, summary: "A helpful class for students.", teachingLanguage: "Nepali", outline: "",
    programUpdatedAt: startsAt, batch, enrolledCount, nextLessonAt,
    publishedDescription: status === "published" ? {
      title, summary: "A helpful class for students.", teachingLanguage: "Nepali", outline: "",
    } : null,
  };
};
const future = "2026-10-05T10:00:00.000Z";
const past = "2026-09-01T10:00:00.000Z";
const fixtures = [
  classItem(1, "Closed Maths", "closed", past, 1, null),
  classItem(2, "Draft Maths", "draft", future, 0, null),
  classItem(3, "Open Maths", "published", future, 0, future),
  classItem(4, "Active Maths", "published", future, 2, future),
  classItem(5, "Past Maths", "published", past, 1, null),
];
const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>';
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript((items) => { window.classHomeFixtures = items; }, fixtures);
    await page.goto(`http://127.0.0.1:${server.address().port}/teaching-classes`);
    await page.getByText("Active Maths", { exact: true }).waitFor();
    const labels = ["Active classes", "Open for bookings", "Past class dates", "Drafts", "Closed listings"];
    const headings = await page.getByRole("heading").allTextContents();
    check(JSON.stringify(headings.filter((label) => labels.includes(label))) === JSON.stringify(labels), `${width}: active and bookable classes precede old listings`);
    check(await page.getByRole("button", { name: /^Class details for Active Maths/ }).count() === 1, `${width}: class details action is clear`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.getByRole("button", { name: /^Class details for Active Maths/ }).click();
    check(await page.evaluate(() => window.lastNavigation?.params?.id === "4"), `${width}: class details opens the right class`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.screenshot({ path: path.join(work, `${width}-classes.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${checks} checks passed. Screenshots: ${work}`);
