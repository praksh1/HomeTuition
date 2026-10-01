import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

// A structural work budget, not an invented INP score. The real conversation screens and
// formatters render; only authenticated network/storage boundaries use local test fixtures.
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-message-typing-"));
const bundle = path.join(work, "bundle.js");
let entry = path.join(here, "entry.tsx");
if (process.env.FADKO_TYPING_BASELINE) {
  // Optional audit mode loads the exact pre-fix release without rewinding the shared worktree.
  const repo = path.resolve(here, "../../../..");
  const git = process.platform === "win32" ? "C:/Program Files/Git/cmd/git.exe" : "git";
  for (const [filename, source] of [["direct.tsx", "conversation/[id].tsx"], ["class.tsx", "class-chat.tsx"]]) {
    const old = execFileSync(git, ["show", `9f3bc397:artifacts/sikshya/app/${source}`], { cwd: repo, encoding: "utf8" });
    writeFileSync(path.join(work, filename), old);
  }
  entry = path.join(work, "entry.tsx");
  writeFileSync(entry, 'import React from "react"; import { createRoot } from "react-dom/client"; import Direct from "./direct"; import Class from "./class"; createRoot(document.getElementById("root")).render(location.search.includes("class-chat") ? <Class/> : <Direct/>);');
}
const built = await bundleForBrowser({ entry, outfile: bundle, alias: {
  "@": path.resolve(here, "../.."),
  "@/utils/api": path.join(here, "api.js"),
  "@/utils/drafts": path.join(here, "drafts.js"),
  "@/utils/uploadFile": path.join(here, "upload.js"),
  "@/context/AuthContext": path.join(here, "auth.js"),
  "@/context/NotificationContext": path.join(here, "notifications.js"),
  "@/context/DatePreferenceContext": path.join(here, "context.js"),
  "expo-router": path.join(here, "router.js"),
  "react-native-safe-area-context": path.join(here, "context.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
  "expo-document-picker": path.join(here, "document-picker.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript; charset=utf-8"); res.end(readFileSync(bundle)); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}body{overflow:hidden}#root{display:flex;flex:1}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
try {
  for (const width of [390, 1440]) for (const [route, inputId] of [["conversation", "conversation-input"], ["class-chat", "class-chat-input"]]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      const Original = Intl.DateTimeFormat;
      globalThis.messageDateWork = { constructors: 0, formatParts: 0 };
      Intl.DateTimeFormat = new Proxy(Original, { construct(target, args) {
        globalThis.messageDateWork.constructors++;
        return new target(...args);
      } });
      const parts = Original.prototype.formatToParts;
      Original.prototype.formatToParts = function (...args) { globalThis.messageDateWork.formatParts++; return parts.apply(this, args); };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}?${route}`);
    const input = page.getByTestId(inputId);
    try { await input.waitFor(); }
    catch (error) { throw new Error(`${route} did not render: ${await page.locator("body").innerText()} | ${errors.join(" | ")}`, { cause: error }); }
    await page.waitForTimeout(300);
    await page.evaluate(() => { globalThis.messageDateWork = { constructors: 0, formatParts: 0 }; globalThis.draftWriteCalls = 0; });
    const before = performance.now();
    await input.pressSequentially("Testing fast message typing", { delay: 5 });
    const workDone = await page.evaluate(() => ({ ...globalThis.messageDateWork, draftWrites: globalThis.draftWriteCalls }));
    console.log(JSON.stringify({ width, route, elapsedHarnessMs: Math.round(performance.now() - before), ...workDone }));
    if (!process.env.FADKO_TYPING_BASELINE) {
      assert.equal(workDone.formatParts, 0, "Typing must not reformat the message timeline");
      assert.equal(workDone.constructors, 0, "Typing must not recreate Intl formatters");
      assert.equal(workDone.draftWrites, 0, "A typing burst must not write storage on every keystroke");
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => globalThis.draftWriteCalls), 1, "The latest draft is persisted once after typing settles");
    }
    assert.equal(await input.inputValue(), "Testing fast message typing", "No keystrokes are dropped");
    if (!process.env.FADKO_TYPING_BASELINE && width === 390) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("message-test-focus", { detail: false })));
      await page.waitForTimeout(100);
      const reads = await page.evaluate(() => globalThis.messageReadCalls);
      await page.waitForTimeout(8200);
      assert.equal(await page.evaluate(() => globalThis.messageReadCalls), reads, "A hidden conversation must not keep polling");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("message-test-focus", { detail: true })));
      await page.waitForFunction(before => globalThis.messageReadCalls > before, reads);
      console.log(`PASS ${route}: hidden screen pauses reads and focus restores fresh messages`);
    }
    if (!process.env.FADKO_TYPING_BASELINE) {
      await input.fill("Original unsent question");
      await page.evaluate(() => { globalThis.failNextMessageSend = true; });
      await input.press("Enter");
      await page.waitForFunction(() => typeof globalThis.releaseFailedMessageSend === "function");
      await input.fill("The next question I am typing");
      await page.evaluate(() => globalThis.releaseFailedMessageSend());
      await page.getByTestId(`${inputId}-unsent`).waitFor();
      assert.equal(await input.inputValue(), "The next question I am typing", "A failed send must not overwrite the next draft");
      assert.match(await page.getByTestId(`${inputId}-unsent`).innerText(), /Original unsent question/, "The failed outgoing text is not lost");
      assert.ok(await page.evaluate(() => Object.values(globalThis.failedMessageDrafts ?? {}).includes("Original unsent question")), "The failed message is retained privately for returning to this screen");
      const recovery = page.getByTestId(`${inputId}-recover`);
      const recoveryBox = await recovery.boundingBox();
      assert.ok(recoveryBox && recoveryBox.height >= 44, "Recovery retains a usable touch target");
      assert.ok(recoveryBox.x >= 0 && recoveryBox.x + recoveryBox.width <= width, "Recovery stays inside the phone or laptop viewport");
      await page.screenshot({ path: path.join(work, `${width}-${route}-failed-send.png`) });
      await recovery.click();
      assert.equal(await input.inputValue(), "Original unsent question\n\nThe next question I am typing", "Explicit recovery keeps both messages for review");
      console.log(`PASS ${width} ${route}: failed-send recovery preserves both the outgoing and next draft`);
    }
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`Typing and recovery screenshots: ${work}`);
