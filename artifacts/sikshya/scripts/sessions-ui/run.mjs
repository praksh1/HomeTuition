import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-sessions-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/context/AuthContext": path.join(here, "auth.js"),
    "@/context/DatePreferenceContext": path.join(here, "context.js"),
    "@/utils/api": path.join(here, "api.js"),
    "@react-navigation/native": path.join(here, "navigation.js"),
    "expo-router": path.join(here, "router.js"),
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

    await page.goto(`http://127.0.0.1:${server.address().port}?role=teacher`);
    await page.getByText("Teaching schedule", { exact: true }).waitFor();
    const teacherBody = await page.locator("body").innerText();
    check(teacherBody.includes("Each lesson, in the order you will teach it."), `${width}: teacher sees a lesson agenda`);
    check(teacherBody.includes("One-time lesson") && !teacherBody.includes("NPR 6,000"), `${width}: schedule is not a price catalogue`);
    check(!teacherBody.includes("Monthly"), `${width}: retired Monthly product stays hidden`);
    for (const id of ["upcoming", "live", "history"]) {
      const box = await page.getByTestId(`teacher-group-${id}`).boundingBox();
      check(box && box.height >= 44, `${width}: teacher ${id} filter meets the touch floor`);
    }
    const teacherContent = await page.getByTestId("teacher-schedule-content").boundingBox();
    check(
      teacherContent && (width >= 1024
        ? teacherContent.width >= 1000 && teacherContent.width <= 1120
        : teacherContent.width <= 760),
      `${width}: teacher agenda uses the right phone or laptop workspace`,
    );
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: teacher agenda has no horizontal overflow`);
    await page.getByTestId("teacher-group-history").click();
    await page.getByText("Final revision", { exact: true }).waitFor();
    const historyBody = await page.locator("body").innerText();
    const historyCopy = historyBody.toLowerCase();
    check(
      historyCopy.includes("not held") && historyCopy.includes("completed") && historyCopy.includes("cancelled"),
      `${width}: history separates factual outcomes (${historyBody.replace(/\n/g, " | ").slice(0, 700)})`,
    );
    await page.screenshot({ path: path.join(work, `${width}-teacher-history.png`), fullPage: true });

    await page.goto(`http://127.0.0.1:${server.address().port}?role=student`);
    await page.getByText("My classes", { exact: true }).waitFor();
    check(await page.getByTestId("student-class-group-701").count() === 1, `${width}: thirty lessons remain one student class card`);
    const studentBody = await page.locator("body").innerText();
    check(studentBody.includes("30 of 30 lessons remaining"), `${width}: class progress is concise and truthful`);
    check(!studentBody.includes("Monthly Classes"), `${width}: student library has no retired product`);
    for (const id of ["upcoming", "live", "history"]) {
      const box = await page.getByTestId(`student-group-${id}`).boundingBox();
      check(box && box.height >= 44, `${width}: student ${id} filter meets the touch floor`);
    }
    const studentContent = await page.getByTestId("student-classes-content").boundingBox();
    check(
      studentContent && (width >= 1024
        ? studentContent.width >= 1000 && studentContent.width <= 1120
        : studentContent.width <= 760),
      `${width}: student classes use the right phone or laptop workspace`,
    );
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: student classes have no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-student-classes.png`), fullPage: true });

    await page.goto(`http://127.0.0.1:${server.address().port}?role=student&fail=1`);
    await page.getByText("Your classes could not be loaded", { exact: true }).waitFor();
    const failureBody = await page.locator("body").innerText();
    check(!failureBody.includes("No upcoming classes"), `${width}: a connection failure never pretends the student owns nothing`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
