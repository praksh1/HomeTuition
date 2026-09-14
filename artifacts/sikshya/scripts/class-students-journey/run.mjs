import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-class-students-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/utils/api": path.join(here, "api.js"),
    "expo-router": path.resolve(here, "../class-home-journey/router.js"),
    "react-native-safe-area-context": path.resolve(here, "../class-home-journey/context.js"),
    "@/context/DatePreferenceContext": path.resolve(here, "../class-home-journey/context.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
  },
});
assert.ok(built.ok, built.error);

const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, message) => { assert.ok(value, message); passed++; console.log(`PASS ${message}`); };

try {
  for (const width of [390, 1440]) {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(base);
    await page.getByText("2 students", { exact: true }).waitFor();
    const text = await page.locator("body").innerText();
    check(text.includes("Anisha Rai") && text.includes("Bikash Thapa"), `${width}: enrolled students are named`);
    check(text.includes("2 of 12 lessons joined · 91 min recorded"), `${width}: recorded presence is concise`);
    check(text.includes("No lesson presence recorded yet"), `${width}: no presence is not called absence`);
    check(!text.includes("email") && !text.includes("Held by Fadko") && !text.includes("70%"), `${width}: roster reveals no contact or internal money`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-roster.png`), fullPage: true });

    await page.goto(`${base}?unknown`);
    await page.getByText("Attendance record unavailable", { exact: true }).first().waitFor();
    check((await page.locator("body").innerText()).includes("Attendance record unavailable"), `${width}: failed evidence is not shown as zero attendance`);
    await page.goto(`${base}?empty`);
    await page.getByText("No students yet", { exact: true }).waitFor();
    check((await page.locator("body").innerText()).includes("Students who join this class will appear here."), `${width}: empty roster explains itself`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
