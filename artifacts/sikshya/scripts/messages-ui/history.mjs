import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-message-history-"));
const bundle = path.join(work, "bundle.js");
let direct = path.resolve(here, "../../app/conversation/[id].tsx");
let klass = path.resolve(here, "../../app/class-chat.tsx");
if (process.env.FADKO_HISTORY_BASELINE) {
  const git = process.platform === "win32" ? "C:/Program Files/Git/cmd/git.exe" : "git";
  const repo = path.resolve(here, "../../../..");
  for (const [file, source] of [["direct.tsx", "conversation/[id].tsx"], ["class.tsx", "class-chat.tsx"]]) {
    writeFileSync(path.join(work, file), execFileSync(git, ["show", `a30e7b99:artifacts/sikshya/app/${source}`], { cwd: repo, encoding: "utf8" }));
  }
  direct = path.join(work, "direct.tsx"); klass = path.join(work, "class.tsx");
}
const entry = path.join(work, "entry.tsx");
writeFileSync(entry, `import React from "react"; import { createRoot } from "react-dom/client"; import Direct from ${JSON.stringify(direct.replaceAll("\\", "/"))}; import Class from ${JSON.stringify(klass.replaceAll("\\", "/"))}; createRoot(document.getElementById("root")).render(location.search.includes("class-chat") ? <Class/> : <Direct/>);`);
const built = await bundleForBrowser({ entry, outfile: bundle, alias: {
  "@": path.resolve(here, "../.."), "@/utils/api": path.join(here, "history-api.js"),
  "@/utils/drafts": path.join(here, "drafts.js"), "@/utils/uploadFile": path.join(here, "upload.js"),
  "@/context/AuthContext": path.join(here, "auth.js"), "@/context/NotificationContext": path.join(here, "notifications.js"),
  "@/context/DatePreferenceContext": path.join(here, "context.js"), "expo-router": path.join(here, "router.js"),
  "react-native-safe-area-context": path.join(here, "context.js"), "expo-font": path.resolve(here, "../batch-planner/font.js"),
  "expo-document-picker": path.join(here, "document-picker.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}body{overflow:hidden}#root{display:flex;flex:1}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (ok, label) => { assert.ok(ok, label); passed++; console.log(`PASS ${label}`); };
try {
  for (const width of [390, 1440]) for (const [route, inputId] of [["conversation", "conversation-input"], ["class-chat", "class-chat-input"]]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(`http://127.0.0.1:${server.address().port}?${route}`);
    await page.getByTestId(inputId).waitFor();
    const latest = page.getByText(/^History 250:/);
    await latest.waitFor();
    await page.waitForTimeout(900);
    let latestBox = await latest.boundingBox();
    check(latestBox && latestBox.y >= 64 && latestBox.y + latestBox.height < 792, `${width} ${route}: 250 varied rows open at newest, not estimated older position`);
    const previous = page.getByText(/^History 249:/);
    const previousBox = await previous.boundingBox();
    check(previousBox && previousBox.y < latestBox.y, `${width} ${route}: visual chronological order remains oldest above newest`);
    await page.screenshot({ path: path.join(work, `${width}-${route}-newest.png`) });
    await page.evaluate(() => {
      const input = document.querySelector("textarea");
      globalThis.typedPaints = [];
      input.addEventListener("input", () => {
        const start = performance.now(), text = input.value;
        requestAnimationFrame(() => globalThis.typedPaints.push({ ms: performance.now() - start, text }));
      });
    });
    const input = page.getByTestId(inputId);
    await input.pressSequentially("Message with realistic long history", { delay: 5 });
    await page.waitForTimeout(100);
    const paint = await page.evaluate(() => globalThis.typedPaints);
    check(await input.inputValue() === "Message with realistic long history", `${width} ${route}: every character appears with long history`);
    check(paint.length > 0 && Math.max(...paint.map(sample => sample.ms)) < 250, `${width} ${route}: synthetic four-times-slowed input paints stay under 250 ms`);
    console.log(JSON.stringify({ width, route, paintSamples: paint.length, maxPaintMs: Math.round(Math.max(...paint.map(sample => sample.ms))) }));
    // Expo retains a pushed screen. Reopening must reset an old scroll position even when
    // the refresh fails; hasLoaded from the earlier visit must not suppress the jump.
    await page.evaluate(() => {
      const candidates = [...document.querySelectorAll("div")].filter(el => el.scrollHeight > el.clientHeight + 300 && ["auto", "scroll"].includes(getComputedStyle(el).overflowY));
      const list = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      const inverted = getComputedStyle(list).transform !== "none";
      list.scrollTop = inverted ? list.scrollHeight : 0;
      list.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new CustomEvent("message-test-focus", { detail: false }));
      globalThis.failHistoryRead = true;
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("message-test-focus", { detail: true })));
    await page.waitForTimeout(1000);
    await latest.waitFor();
    latestBox = await latest.boundingBox();
    check(latestBox && latestBox.y >= 64 && latestBox.y + latestBox.height < 792, `${width} ${route}: reopen jumps to cached newest even when network fails`);
    await page.evaluate(() => {
      globalThis.failHistoryRead = false;
      window.dispatchEvent(new CustomEvent("message-test-focus", { detail: false }));
      globalThis.holdHistoryRead = true;
      globalThis.historyExtra = [{ id: 1300, senderId: 11, receiverId: 7, senderName: "Anisha Rai", senderRole: "student", body: "Stale history snapshot", read: true, createdAt: "2026-09-28T12:00:00Z" }];
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("message-test-focus", { detail: true })));
    await page.waitForFunction(() => typeof globalThis.releaseHistoryRead === "function");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("message-test-focus", { detail: false })));
    await page.waitForFunction(() => window.messageFixtureFocused === false);
    await page.evaluate(() => { globalThis.holdHistoryRead = false; globalThis.releaseHistoryRead(); });
    await page.waitForTimeout(150);
    check(await page.getByText("Stale history snapshot", { exact: true }).count() === 0, `${width} ${route}: an off-focus response cannot mutate retained history`);
    await page.evaluate(() => {
      globalThis.historyExtra = [{ id: 1301, senderId: 11, receiverId: 7, senderName: "Anisha Rai", senderRole: "student", body: "Newest after return", read: true, createdAt: "2026-09-28T12:01:00Z" }];
      window.dispatchEvent(new CustomEvent("message-test-focus", { detail: true }));
    });
    await page.getByText("Newest after return", { exact: true }).waitFor();
    await page.waitForTimeout(400);
    const returnedBox = await page.getByText("Newest after return", { exact: true }).boundingBox();
    check(returnedBox && returnedBox.y >= 64 && returnedBox.y + returnedBox.height < 792, `${width} ${route}: refocused fresh reply remains visible at newest`);
    check(errors.length === 0, `${width} ${route}: no browser exceptions`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} history checks passed; synthetic-only screenshots ${work}`);
