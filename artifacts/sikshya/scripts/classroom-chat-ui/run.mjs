/** Rendered checks for the shared teacher/student classroom conversation surface. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const work = mkdtempSync(path.join(tmpdir(), "classroom-chat-ui-"));
let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import { ClassroomChatDrawer } from ${JSON.stringify(path.join(appRoot, "components", "classes", "ClassroomChatDrawer.tsx"))};

const seed = [
  { id: "1", senderName: "Sita", text: "Which page are we on?", time: "9:01", isMe: false },
  { id: "2", senderName: "Sita", text: "I found it now.", time: "9:02", isMe: false },
  { id: "3", senderName: "Teacher", text: "Page twelve.", time: "9:03", isMe: true },
];

function Harness() {
  const [open, setOpen] = React.useState(true);
  const [messages, setMessages] = React.useState(seed);
  const [value, setValue] = React.useState("");
  window.__chat = {
    open: () => setOpen(true),
    push: (message) => setMessages((current) => [...current, message]),
    many: () => setMessages(Array.from({ length: 36 }, (_, index) => ({
      id: "old-" + index,
      senderName: index % 2 ? "Teacher" : "Sita",
      text: "Earlier class message " + index,
      time: "8:" + String(index).padStart(2, "0"),
      isMe: index % 2 === 1,
    }))),
  };
  const send = () => {
    const text = value.trim();
    if (!text) return;
    setMessages((current) => [...current, {
      id: "sent-" + current.length,
      senderName: "Teacher",
      text,
      time: "now",
      isMe: true,
    }]);
    setValue("");
  };
  return React.createElement(ClassroomChatDrawer, {
    open,
    messages,
    value,
    onChangeText: setValue,
    onSend: send,
    onClose: () => setOpen(false),
    placeholder: "Message everyone…",
    emptyText: "Start the class conversation.",
  });
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
`,
);

const fontStub = path.join(work, "expo-font-stub.js");
writeFileSync(
  fontStub,
  `export async function loadAsync(){} export function isLoaded(){return true}
export function isLoading(){return false} export function useFonts(){return [true,null]}
export function processFontFamily(name){return name} export function getLoadedFonts(){return []}
export default {loadAsync,isLoaded,isLoading,useFonts,processFontFamily,getLoadedFonts};`,
);

const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry, outfile: bundle, alias: { "expo-font": fontStub } });
if (!built.ok) {
  console.error(built.error);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
const pagePath = path.join(work, "index.html");
writeFileSync(pagePath, `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);

const chromium = await getChromium();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const viewport of [{ label: "phone", width: 390, height: 844 }, { label: "laptop", width: 1440, height: 900 }]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`file://${pagePath}`);
  await page.waitForTimeout(500);

  console.log(`\n[${viewport.label}] Shared classroom chat`);
  check(`${viewport.label}: the drawer is visible`, (await page.locator('[data-testid="classroom-chat-drawer"]').count()) === 1);
  check(`${viewport.label}: consecutive messages are readable`, (await page.getByText("Which page are we on?").count()) === 1 && (await page.getByText("I found it now.").count()) === 1);
  check(`${viewport.label}: the participant name is grouped once`, (await page.getByText("Sita", { exact: true }).count()) === 1);

  const input = page.locator('[data-testid="chat-input"]');
  await input.fill("A message sent with Enter");
  await input.press("Enter");
  await page.waitForTimeout(350);
  check(`${viewport.label}: Enter sends instead of adding a blank line`, (await page.getByText("A message sent with Enter").count()) === 1);
  check(`${viewport.label}: sending clears the composer`, (await input.inputValue()) === "");

  await page.evaluate(() => window.__chat.many());
  await page.waitForTimeout(350);
  const scroller = page.locator('[data-testid="classroom-chat-drawer"] div').filter({ has: page.locator('text="Earlier class message 0"') }).first();
  await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('[data-testid="classroom-chat-drawer"] div')];
    const target = candidates.find((node) => node.scrollHeight > node.clientHeight + 100);
    if (target) target.scrollTop = 0;
  });
  await page.evaluate(() => window.__chat.push({ id: "new-below", senderName: "Sita", text: "A new message below", time: "now", isMe: false }));
  await page.waitForTimeout(350);
  check(`${viewport.label}: reading older messages is not yanked away`, (await page.locator('[data-testid="classroom-chat-new-messages"]').count()) === 1);
  await page.locator('[data-testid="classroom-chat-new-messages"]').click();
  await page.waitForTimeout(250);
  check(`${viewport.label}: the new-message control jumps to the latest reply`, (await page.getByText("A new message below").count()) === 1 && (await page.locator('[data-testid="classroom-chat-new-messages"]').count()) === 0);

  await page.locator('[data-testid="classroom-chat-close"]').click();
  await page.waitForTimeout(300);
  check(`${viewport.label}: close removes the drawer`, (await page.locator('[data-testid="classroom-chat-drawer"]').count()) === 0);
  check(`${viewport.label}: no browser errors`, errors.length === 0, errors[0] ?? "");
  await context.close();
}

await browser.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failed === 0 ? 0 : 1);
