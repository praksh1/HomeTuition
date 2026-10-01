/** Synthetic rendered server-contract regression. No real records, API or cash. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), "fadko-lesson-drop-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "api.js"),
  "expo-router": path.join(here, "router.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
} });
assert.ok(built.ok, built.error);
const bytes = await readFile(bundle);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bytes : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{padding:16px;box-sizing:border-box}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const scenarios = ["linked", "linked-first", "linked-zero-fields", "quote", "full", "blocked", "left", "left-no-amount", "not-enrolled", "missing-quote", "null-price", "string-price", "negative-refund", "too-large-refund", "missing-teacher-share", "unknown-quote", "fetch-failure"];
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; console.log("PASS " + label); };
try {
  for (const width of [320, 390, 1440]) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await page.goto(`${base}/?case=${scenario}`);
      await page.waitForFunction(() => window.__dropFixtureRequests?.length > 0);
      await page.waitForTimeout(120);
      const crash = await page.getByTestId("fixture-crash").count() ? await page.getByTestId("fixture-crash").innerText() : null;
      check(crash === null && errors.length === 0, `${width} ${scenario}: no render crash (${crash || errors.join(", ")})`);
      const body = await page.locator("body").innerText();
      check(!body.includes("undefined") && !body.includes("NaN"), `${width} ${scenario}: no invented/invalid amount`);
      if (scenario.startsWith("linked")) {
        check(await page.getByTestId("drop-linked-lesson").count() === 1, `${width} ${scenario}: class allocation has its own presentation`);
        check(await page.getByTestId("drop-class-btn").count() === 0 && !body.includes("half of") && !body.includes("Changed your mind"), `${width} ${scenario}: no legacy cancellation offer`);
        const link = page.getByTestId("drop-linked-remedies");
        const box = await link.boundingBox();
        check(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `${width} ${scenario}: remedy action is a reachable 44px hit target`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        check(await page.evaluate(() => window.__dropFixtureNavigation?.params?.sessionId === "451"), `${width} ${scenario}: remedy link keeps the original lesson`);
      } else if (["quote", "full", "blocked"].includes(scenario)) {
        check(await page.getByTestId("drop-class").count() === 1, `${width} ${scenario}: complete legacy server quote still renders`);
        check(await page.getByTestId("drop-class-btn").count() === (scenario === "blocked" ? 0 : 1), `${width} ${scenario}: existing canDrop still controls the action`);
      } else if (scenario.startsWith("left")) {
        check(await page.getByTestId("drop-class-left").count() === 1 && await page.getByTestId("drop-class-btn").count() === 0, `${width} ${scenario}: departed receipt stays read-only`);
      } else if (!["not-enrolled", "fetch-failure"].includes(scenario)) {
        check(await page.getByTestId("drop-quote-unavailable").count() === 1 && await page.getByTestId("drop-class-btn").count() === 0, `${width} ${scenario}: incomplete or untrusted quote fails closed`);
      }
      check(await page.evaluate(() => window.__dropFixtureRequests.every(row => row.method === "GET")), `${width} ${scenario}: rendering never attempts a mutation`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${scenario}: no horizontal overflow`);
      if (scenario === "linked") await page.screenshot({ path: path.join(work, `${width}-linked.png`) });
      await page.close();
    }
  }
  console.log(`PASS ${passed} synthetic DropClass contract assertions. Screenshots: ${work}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
