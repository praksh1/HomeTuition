import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-class-home-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/utils/api": path.join(here, "api.js"),
    "@/utils/programBatches": path.join(here, "programBatches.js"),
    "expo-router": path.join(here, "router.js"),
    "react-native-safe-area-context": path.join(here, "context.js"),
    "@/context/DatePreferenceContext": path.join(here, "context.js"),
    "@/context/NotificationContext": path.join(here, "context.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
  },
});
assert.ok(built.ok, built.error);

const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "application/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? readFileSync(bundle)
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, message) => {
  assert.ok(value, message);
  passed += 1;
  console.log(`PASS ${message}`);
};

try {
  for (const width of [390, 1440]) {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto(base);
    await page.getByText("LESSON TIME NOW", { exact: true }).waitFor();
    const current = await page.locator("body").innerText();
    check(
      current.includes("Lesson 1 of 4"),
      `${width}: current lesson position is clear`,
    );
    check(
      current.includes("4 scheduled dates remaining"),
      `${width}: schedule count is clear`,
    );
    check(
      current.includes("+ 1 more scheduled date"),
      `${width}: long schedule stays compact`,
    );
    check(
      current.includes("Payments & receipts"),
      `${width}: student records are one tap away`,
    );
    check(
      !current.includes("Held by Fadko") && !current.includes("70%"),
      `${width}: no internal allocation copy`,
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${width}: no horizontal overflow`,
    );
    const open = page.getByRole("button", {
      name: "Open this lesson",
      exact: true,
    });
    const openBox = await open.boundingBox();
    check(
      openBox.height >= 44 && openBox.width >= 44,
      `${width}: lesson action meets touch floor`,
    );
    await open.click();
    check(
      await page.evaluate(() => window.lastNavigation?.params?.id === "101"),
      `${width}: current lesson opens the correct session`,
    );
    await page.screenshot({
      path: path.join(work, `${width}-current.png`),
      fullPage: true,
    });

    await page.goto(`${base}?upcoming`);
    await page.getByText("NEXT LESSON", { exact: true }).waitFor();
    check(
      (await page.locator("body").innerText()).includes("Lesson 1 of 4"),
      `${width}: upcoming state is truthful`,
    );

    await page.goto(`${base}?finished`);
    await page.getByText("SCHEDULE COMPLETE", { exact: true }).waitFor();
    const finished = await page.locator("body").innerText();
    check(
      finished.includes("All 4 scheduled dates have passed"),
      `${width}: completed schedule says what passed`,
    );
    check(
      !finished.includes("NEXT LESSON") &&
        !(await page
          .getByRole("button", { name: "Open lesson", exact: true })
          .count()),
      `${width}: completed schedule invents no next lesson`,
    );

    await page.goto(`${base}?teacher`);
    const earnings = page.getByRole("button", { name: /Earnings history/ });
    await earnings.waitFor();
    await earnings.click();
    check(
      await page.evaluate(() => window.lastNavigation === "/subscription"),
      `${width}: teacher earnings destination is correct`,
    );
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
