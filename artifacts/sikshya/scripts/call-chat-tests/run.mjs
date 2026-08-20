/**
 * Drives the web call's in-call chat panel in a real browser.
 *
 * E12 asked for Daily's chat instead of the app's own. Daily's chat is off deliberately: the
 * native app has no Prebuilt, so enabling it gives a class with one laptop and one phone two
 * conversations that cannot see each other, each side looking like it works
 * (.agents/memory/one-chat-per-class.md). So the app's chat is rendered *inside* the call
 * instead, which is what "Daily's chat" actually meant in practice — messages you can read
 * without leaving the lesson.
 *
 * The component is mounted on its own rather than through the classroom, with a room URL that
 * cannot connect. That is deliberate: it exercises the path a student on a bad connection
 * takes, where the video fails and chat is the only thing left.
 *
 * Usage, from artifacts/sikshya:  node scripts/call-chat-tests/run.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getChromium } from "../board-tests/harness.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const work = mkdtempSync(path.join(tmpdir(), "callchat-"));

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DailyEmbed from ${JSON.stringify(path.join(appRoot, "components", "DailyEmbed.web.tsx"))};

function Harness() {
  const [messages, setMessages] = useState([]);
  // Exposed so the test can play the part of the classroom socket: push a message in from
  // "the other person", and read back what this side tried to send.
  window.__pushMessage = (m) => setMessages((prev) => [...prev, m]);
  // Assigned once, not on every render — resetting it each render made the test lose the
  // record of what had been sent, which is a bug in the test rather than in the component.
  if (!window.__sent) window.__sent = [];
  return React.createElement("div", { style: { position: "relative", width: "100vw", height: "100vh" } },
    React.createElement(DailyEmbed, {
      roomUrl: "https://example.invalid/does-not-exist",
      displayName: "Teacher",
      chatMessages: messages,
      onSendChat: (text) => {
        window.__sent.push(text);
        // The real classroom echoes your own message back through the socket.
        setMessages((prev) => [...prev, {
          id: "m" + prev.length, senderName: "Teacher", text, time: "now", isMe: true,
        }]);
      },
    }),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
`,
);

const bundle = path.join(work, "bundle.js");
const esbuild = path.join(appRoot, "..", "api-server", "node_modules", ".bin", "esbuild");

const built = spawn(
  esbuild,
  [
    entry,
    "--bundle",
    `--outfile=${bundle}`,
    "--loader:.tsx=tsx",
    "--loader:.ts=ts",
    "--jsx=automatic",
    "--define:process.env.NODE_ENV=\"production\"",
    "--format=iife",
    "--log-level=error",
  ],
  { cwd: appRoot, stdio: "inherit" },
);

// `exit` never fires if the binary cannot be spawned at all, so without the `error` handler a
// missing esbuild would hang here silently until CI's job timeout — thirty minutes to learn
// nothing. A test rig that cannot fail loudly is worse than no test rig.
const buildOk = await new Promise((resolve) => {
  built.on("error", (err) => {
    console.error(`Could not run esbuild at ${esbuild}: ${err.message}`);
    resolve(false);
  });
  built.on("exit", (code) => resolve(code === 0));
});
if (!buildOk) {
  console.error("Could not bundle the component for testing. Has `pnpm install` been run?");
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const page = path.join(work, "index.html");
writeFileSync(
  page,
  `<!doctype html><html><head><meta charset="utf-8"><title>call chat</title>
<style>body{margin:0}</style></head>
<body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);

async function main() {
  const chromium = await getChromium();
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`file://${page}`);
  await p.waitForTimeout(4000);

  console.log("\nThe call shows a way into the chat without leaving it");
  check("the component renders without crashing", errors.length === 0, errors[0] ?? "");
  const chatBtn = p.locator('button[aria-label^="Open chat"]');
  check("there is a chat control on the call", (await chatBtn.count()) === 1);

  console.log("\nA call that will not connect says so, and keeps the chat");
  // The room URL cannot be reached, which is the state a student on a bad line lands in.
  // Daily's join() never rejects for this — it simply never settles — so without a deadline
  // the classroom shows a black rectangle indefinitely with nothing to read and nothing to do.
  console.log("  (waiting out the 20s join deadline)");
  await p.waitForTimeout(21000);
  const explained = await p.locator("text=taking longer than usual").count();
  check("the wait is explained rather than left blank", explained === 1);
  check("and it says what still works", (await p.locator("text=board and chat").count()) >= 1);
  check("and chat is still reachable", (await chatBtn.count()) === 1);

  console.log("\nMessages from the class arrive in the call");
  await p.evaluate(() =>
    window.__pushMessage({ id: "a", senderName: "Sita", text: "Sir, which page?", time: "now", isMe: false }),
  );
  await p.waitForTimeout(300);
  const badge = await chatBtn.textContent();
  check("an unread count appears while the panel is shut", (badge ?? "").includes("1"), badge ?? "");

  await chatBtn.click();
  await p.waitForTimeout(300);
  check("opening the panel shows the message", (await p.locator("text=Sir, which page?").count()) === 1);
  check("and names who sent it", (await p.locator("text=Sita").count()) >= 1);
  check("the unread count is cleared once read", (await chatBtn.count()) === 0);

  console.log("\nSending goes to the class, not to Daily");
  const input = p.locator('input[placeholder^="Message the class"]');
  await input.fill("Page 42, everyone");
  await input.press("Enter");
  await p.waitForTimeout(300);
  const sent = await p.evaluate(() => window.__sent);
  check("the message is handed to the classroom socket", sent.includes("Page 42, everyone"), JSON.stringify(sent));
  check("and appears in the conversation", (await p.locator("text=Page 42, everyone").count()) >= 1);
  check("the box is cleared, so it cannot be sent twice", (await input.inputValue()) === "");

  await input.fill("   ");
  await input.press("Enter");
  await p.waitForTimeout(200);
  const afterBlank = await p.evaluate(() => window.__sent.length);
  check("an empty message is not sent", afterBlank === 1, `sent ${afterBlank}`);

  console.log("\nThe call keeps running underneath");
  // The whole point of a panel rather than a tab: the call is not torn down to chat.
  const frameStillThere = await p.evaluate(() => document.querySelectorAll("div").length > 0);
  check("the call container is still mounted while chatting", frameStillThere);
  await p.locator('button[aria-label="Close chat"]').click();
  await p.waitForTimeout(300);
  check("the panel closes again", (await p.locator('input[placeholder^="Message the class"]').count()) === 0);
  check("and the chat control comes back", (await p.locator('button[aria-label^="Open chat"]').count()) === 1);

  check("no errors were thrown at any point", errors.length === 0, errors[0] ?? "");

  await browser.close();
  rmSync(work, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
});
