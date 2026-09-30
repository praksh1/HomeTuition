/** Real navigation rendering with the bundled fonts; no API or real account is accessed. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-typography-ui-"));
const bundle = path.join(work, "bundle.js");
const result = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "expo-router": path.join(here, "router.js"),
  "expo-haptics": path.join(here, "haptics.js"),
  "react-native-safe-area-context": path.resolve(here, "../profile-ui/context.js"),
} });
assert.ok(result.ok, result.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html; charset=utf-8");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
let passed = 0;
const check = (value, message) => { assert.ok(value, message); passed++; console.log(`PASS ${message}`); };
try {
  browser = await (await getChromium()).launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByTestId("primary-navigation-shell").waitFor({ timeout: 10_000 }).catch(error => {
      throw new Error(`Navigation did not render: ${errors.join(" | ") || error.message}`);
    });
    check(await page.evaluate(() => ["Inter_400Regular", "Inter_500Medium", "Inter_600SemiBold", "Inter_700Bold"].every(face => document.fonts.check(`16px ${face}`))), `${width}: all four bundled faces loaded`);
    const selected = page.getByTestId("tab-index").getByText("Discover", { exact: true });
    const unfocused = page.getByTestId("tab-profile").getByText("Profile", { exact: true });
    check((await selected.evaluate(node => getComputedStyle(node).fontFamily)).startsWith("Inter_700Bold"), `${width}: selected label uses real bold face`);
    check((await unfocused.evaluate(node => getComputedStyle(node).fontFamily)).startsWith("Inter_500Medium"), `${width}: unselected label uses real medium face`);
    check(await selected.evaluate(node => getComputedStyle(node).fontWeight === "400"), `${width}: bold is not synthesized on a medium face`);
    check(await page.getByTestId("tab-messages").getByText("11", { exact: true }).evaluate(node => getComputedStyle(node).fontVariantNumeric.includes("tabular-nums")), `${width}: unread count uses stable-width figures`);
    check(await page.getByTestId("typography-numeric").evaluate(node => getComputedStyle(node).fontVariantNumeric.includes("tabular-nums")), `${width}: money and clocks use stable-width figures`);
    check(await page.getByTestId("typography-nepali").evaluate(node => getComputedStyle(node).fontFamily.includes("Nirmala UI") && node.textContent.includes("नेपाली")), `${width}: mixed Nepali text preserves local fallback stack`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal page overflow`);
    check(await page.getByTestId("primary-navigation-shell").evaluate(shell => [...shell.querySelectorAll('[role="tab"]')].every(tab => {
      const box = tab.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth;
    })), `${width}: navigation remains tappable and within viewport`);
    await page.getByTestId("tab-sessions").click();
    check(await page.getByTestId("tab-sessions").getAttribute("aria-current") === "page", `${width}: tap changes destination without layout change`);
    check((await page.getByTestId("tab-sessions").getByText("Classes", { exact: true }).evaluate(node => getComputedStyle(node).fontFamily)).startsWith("Inter_700Bold"), `${width}: new selection switches to genuine bold face`);
    check(errors.length === 0, `${width}: no browser runtime errors`);
    await page.waitForTimeout(450); // Capture the settled selection spring, not its first frame.
    await page.screenshot({ path: path.join(work, `typography-${width}.png`) });
    await page.close();
  }
  console.log(`${passed} assertions passed. Screenshots: ${work}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
