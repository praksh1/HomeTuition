import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-messages-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/utils/api": path.join(here, "api.js"),
    "@/utils/drafts": path.join(here, "drafts.js"),
    "@/context/AuthContext": path.join(here, "auth.js"),
    "@/context/DatePreferenceContext": path.join(here, "context.js"),
    "expo-router": path.join(here, "router.js"),
    "react-native-safe-area-context": path.join(here, "context.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
  },
});
assert.ok(built.ok, built.error);

const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, message) => { assert.ok(value, message); passed += 1; console.log(`PASS ${message}`); };

try {
  for (const width of [390, 1440]) {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(base);
    await page.waitForTimeout(1000);
    if ((await page.getByTestId("conversation-filter-all").count()) === 0) {
      throw new Error(`Inbox did not render: ${await page.locator("body").innerText()} | ${errors.join(" | ")}`);
    }
    const body = await page.locator("body").innerText();
    check(body.includes("Class conversations, together in one place."), `${width}: inbox explains itself briefly`);
    check(body.includes("Draft: I will send the practice sheet"), `${width}: draft stays with its conversation`);
    check(body.includes("Unread 1") && body.includes("3"), `${width}: unread conversations are counted`);
    check((await page.getByTestId("new-message-button").boundingBox()).height >= 44, `${width}: new-message action meets the touch floor`);
    await page.getByTestId("conversation-filter-unread").click();
    check(await page.getByTestId("conversation-row-11").isVisible(), `${width}: unread filter keeps unread conversation`);
    check((await page.getByTestId("conversation-row-12").count()) === 0, `${width}: unread filter removes read conversations`);
    await page.getByTestId("conversation-filter-all").click();
    await page.getByTestId("conversation-search").fill("bik tha");
    check(await page.getByTestId("conversation-row-12").isVisible(), `${width}: spaced name search finds a conversation`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: inbox has no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-inbox.png`), fullPage: true });

    await page.goto(`${base}?picker`);
    await page.getByText("Who would you like to message?", { exact: true }).waitFor();
    check((await page.getByTestId("new-message-back").boundingBox()).height >= 44, `${width}: picker back action meets the touch floor`);
    await page.getByTestId("recipient-search").fill("IELTS");
    check(await page.getByTestId("recipient-11").isVisible(), `${width}: picker searches class context as well as names`);
    await page.getByTestId("recipient-11").click();
    check(await page.evaluate(() => window.lastNavigation?.pathname === "/conversation/[id]"), `${width}: choosing a person opens their conversation`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: picker has no horizontal overflow`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.screenshot({ path: path.join(work, `${width}-picker.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
