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
    "@/utils/uploadFile": path.join(here, "upload.js"),
    "@/context/AuthContext": path.join(here, "auth.js"),
    "@/context/NotificationContext": path.join(here, "notifications.js"),
    "@/context/DatePreferenceContext": path.join(here, "context.js"),
    "expo-router": path.join(here, "router.js"),
    "react-native-safe-area-context": path.join(here, "context.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
    "expo-document-picker": path.join(here, "document-picker.js"),
    "@/components/PdfViewer": path.resolve(here, "../../components/PdfViewer.web.tsx"),
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
    check(body.includes("Class conversations, together in one place."), `${width}: message list explains itself briefly`);
    check(!/\bInbox\b|\bSent\b|\bDrafts\b/.test(body), `${width}: message threads are not split into email folders`);
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
    await page.screenshot({ path: path.join(work, `${width}-picker.png`), fullPage: true });

    await page.goto(`${base}?conversation`);
    await page.getByText("Fadko conversation", { exact: true }).waitFor();
    await page.waitForFunction(() => globalThis.lastNotificationReadTarget?.kind === "direct_message");
    check(await page.evaluate(() => globalThis.lastNotificationReadTarget?.kind === "direct_message"
      && globalThis.lastNotificationReadTarget?.conversationWith === "11"),
    `${width}: opening a conversation clears its matching notification`);
    const chat = await page.locator("body").innerText();
    check(chat.includes("Can we review question four tomorrow?"), `${width}: incoming message is visible`);
    check(chat.includes("Yes, I added it to our lesson plan."), `${width}: outgoing message is visible`);
    check(chat.includes("Seen"), `${width}: latest outgoing message shows its read state`);
    check(chat.includes("Today"), `${width}: conversation has a quiet Nepal-day divider`);
    check((await page.getByTestId("conversation-back-btn").boundingBox()).height >= 44, `${width}: conversation back meets the touch floor`);
    check((await page.getByTestId("conversation-attach-btn").boundingBox()).height >= 44, `${width}: attachment action meets the touch floor`);
    check((await page.getByTestId("conversation-send-btn").boundingBox()).height >= 44, `${width}: send action meets the touch floor`);
    await page.locator('[data-testid="attachment-image-message-photo"], [data-testid="attachment-file-message-photo"]').click();
    await page.getByTestId("attachment-viewer").waitFor();
    check((await page.getByTestId("attachment-viewer-download").boundingBox()).height >= 44, `${width}: in-app file viewer keeps a clear download action`);
    check((await page.getByTestId("attachment-viewer-close").boundingBox()).height >= 44, `${width}: in-app file viewer has a reachable close action`);
    let attachmentOpenedPopup = false;
    page.once("popup", () => { attachmentOpenedPopup = true; });
    await page.getByTestId("attachment-viewer-download").click();
    await page.waitForTimeout(100);
    check(!attachmentOpenedPopup, `${width}: downloading from the viewer does not open another window`);
    await page.screenshot({ path: path.join(work, `${width}-attachment-viewer.png`), fullPage: true });
    await page.locator('[data-testid="attachment-viewer-close"]:visible').click();
    await page.locator('[data-testid="attachment-viewer"]:visible').waitFor({ state: "hidden" });
    check(await page.getByText("Fadko conversation", { exact: true }).isVisible(), `${width}: closing a file returns to the same conversation`);
    await page.getByTestId("attachment-file-study-guide").click();
    await page.getByTestId("attachment-viewer").waitFor();
    await page.locator('iframe[title="PDF document"]').waitFor({ state: "attached" });
    check((await page.locator('iframe[title="PDF document"]').count()) === 1, `${width}: PDFs stay in the in-app viewer`);
    await page.locator('[data-testid="attachment-viewer-close"]:visible').click();
    await page.locator('[data-testid="attachment-viewer"]:visible').waitFor({ state: "hidden" });
    await page.getByTestId("attachment-file-lesson-plan").click();
    await page.getByText("Fadko keeps this file private.", { exact: false }).waitFor();
    check((await page.locator("body").innerText()).includes("Word"), `${width}: Word files get an honest private download view`);
    await page.locator('[data-testid="attachment-viewer-close"]:visible').click();
    await page.locator('[data-testid="attachment-viewer"]:visible').waitFor({ state: "hidden" });
    await page.getByTestId("attachment-file-marks-sheet").click();
    await page.getByText("Fadko keeps this file private.", { exact: false }).waitFor();
    check((await page.locator("body").innerText()).includes("Excel"), `${width}: Excel files get an honest private download view`);
    await page.locator('[data-testid="attachment-viewer-close"]:visible').click();
    await page.locator('[data-testid="attachment-viewer"]:visible').waitFor({ state: "hidden" });
    await page.getByTestId("conversation-input").fill("See you in class.");
    await page.getByTestId("conversation-send-btn").click();
    await page.getByText("See you in class.", { exact: true }).waitFor();
    check((await page.locator("body").innerText()).includes("Sent"), `${width}: newly sent message shows pending read state`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: conversation has no horizontal overflow`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    await page.screenshot({ path: path.join(work, `${width}-conversation.png`), fullPage: true });

    await page.goto(`${base}?class-chat`);
    await page.getByText("IELTS evening class", { exact: true }).waitFor();
    await page.waitForFunction(() => globalThis.lastNotificationReadTarget?.kind === "class_message");
    check(await page.evaluate(() => globalThis.lastNotificationReadTarget?.kind === "class_message"
      && globalThis.lastNotificationReadTarget?.batchId === 11),
    `${width}: opening class chat clears its matching notification`);
    const classChat = await page.locator("body").innerText();
    check(classChat.includes("Everyone enrolled in this class"), `${width}: class chat identifies its audience`);
    check(classChat.includes("Pinned by your teacher") && classChat.includes("Bring the practice sheet"), `${width}: pinned teacher update stays above the timeline`);
    check(classChat.includes("Anisha Rai") && classChat.includes("Can we review question four tomorrow?"), `${width}: classmate identity and message are visible`);
    check(classChat.includes("Teacher"), `${width}: teacher messages have an honest role marker`);
    check(classChat.includes("Today"), `${width}: class chat uses Nepal-day dividers`);
    check(await page.getByTestId("class-chat-load-earlier").isVisible(), `${width}: busy class chats expose earlier history without one long page`);
    check((await page.getByTestId("class-chat-back").boundingBox()).height >= 44, `${width}: class-chat back action meets the touch floor`);
    check((await page.getByTestId("class-chat-attach").boundingBox()).height >= 44, `${width}: class-chat attachment action meets the touch floor`);
    check((await page.getByTestId("class-chat-send").boundingBox()).height >= 44, `${width}: class-chat send action meets the touch floor`);
    await page.getByTestId("class-chat-input").fill("I will send the worksheet now.");
    await page.getByTestId("class-chat-send").click();
    await page.getByText("I will send the worksheet now.", { exact: true }).waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: class chat has no horizontal overflow`);
    check(errors.length === 0, `${width}: class chat has no browser exceptions`);
    await page.screenshot({ path: path.join(work, `${width}-class-chat.png`), fullPage: true });

    await page.goto(`${base}?expired-class`);
    await page.getByText("This class has ended", { exact: true }).waitFor();
    const expired = await page.locator("body").innerText();
    check(expired.includes("This lesson has already ended."), `${width}: Fadko explains an expired lesson before a video provider can`);
    check(expired.includes("Returning to your dashboard") && expired.includes("10"), `${width}: expired lesson shows its ten-second destination`);
    check((await page.getByTestId("expired-class-dashboard").boundingBox()).height >= 44, `${width}: immediate dashboard action meets the touch floor`);
    await page.getByTestId("expired-class-dashboard").click();
    check(await page.evaluate(() => window.lastNavigation === "/student"), `${width}: expired lesson can leave for the dashboard immediately`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: expired lesson has no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-expired-class.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
