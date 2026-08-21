/**
 * What a "leave" from the video call is allowed to mean.
 *
 * The teacher's classroom treats a leave as *end this class for everyone and go back*. Daily
 * emits `left-meeting` when a join **fails** as well as when somebody hangs up — so a room that
 * could not be reached silently marked the lesson finished and threw the teacher out of their
 * own class, with "Class ended" as the only explanation.
 *
 * This was invisible from the sandbox these tests are usually written in, because it cannot
 * reach Daily at all: the call never runs, so it never fails. CI can reach Daily, and failed
 * there — twice, identically — on the classroom test, with the class ending itself seconds
 * after the teacher walked in. So the SDK is replaced here with one this test drives directly,
 * which makes the two orderings that matter reproducible anywhere:
 *
 *   join fails            → left-meeting with no join before it → the class must survive
 *   teacher hangs up      → joined-meeting then left-meeting    → the class must end
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const work = mkdtempSync(path.join(tmpdir(), "callleave-"));

/**
 * A stand-in for Daily's SDK that does nothing until the test tells it to.
 *
 * Deliberately faithful about the one thing under test: `join()` never settles when the room
 * cannot be reached — measured against the real SDK and noted in DailyEmbed — so a failed join
 * is a promise that hangs, followed by `left-meeting`.
 */
const fakeDaily = path.join(work, "fake-daily.js");
writeFileSync(
  fakeDaily,
  `
const handlers = {};
window.__calls = [];
let destroyed = false;
const frame = {
  on(event, fn) { (handlers[event] ||= []).push(fn); return frame; },
  join() { return new Promise(() => {}); },
  leave() { window.__calls.push("leave"); return Promise.resolve(); },
  destroy() { window.__calls.push("destroy"); destroyed = true; return Promise.resolve(); },
  iframe() { return null; },
  setLocalAudio() {}, setLocalVideo() {}, startScreenShare() {}, stopScreenShare() {},
};
window.__emit = (event, payload) => { for (const fn of handlers[event] ?? []) fn(payload); };
// Daily keeps its own pointer to the one frame a page may have, and returns null once it has
// been destroyed. That is what lets an abandoned frame be found and released.
const stub = { createFrame: () => frame, getCallInstance: () => (destroyed ? null : frame) };
// So the test can ask what Daily itself still holds, rather than taking the app's word.
window.__callInstanceGone = () => stub.getCallInstance() === null;
export default stub;
`,
);

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import DailyEmbed from ${JSON.stringify(path.join(appRoot, "components", "DailyEmbed.web.tsx"))};

window.__lefts = 0;
const root = createRoot(document.getElementById("root"));
function Harness() {
  const [inCall, setInCall] = React.useState(true);
  // The classroom clears the room URL when the teacher ends the class, which unmounts this.
  window.__endCall = () => setInCall(false);
  return inCall
    ? React.createElement(DailyEmbed, {
        roomUrl: "https://example.invalid/room-that-is-not-there",
        displayName: "Ram Prasad",
        onLeft: () => { window.__lefts += 1; },
      })
    : React.createElement("div", null, "call over");
}
root.render(React.createElement(Harness));
`,
);

const bundle = path.join(work, "bundle.js");
const esbuild = path.join(appRoot, "..", "api-server", "node_modules", ".bin", "esbuild");
const built = spawn(
  esbuild,
  [
    entry, "--bundle", `--outfile=${bundle}`,
    "--loader:.tsx=tsx", "--loader:.ts=ts", "--jsx=automatic",
    // The whole point: DailyEmbed's `import("@daily-co/daily-js")` resolves to the fake above.
    `--alias:@daily-co/daily-js=${fakeDaily}`,
    '--define:process.env.NODE_ENV="production"',
    "--format=iife", "--log-level=error",
  ],
  { cwd: appRoot, stdio: "inherit" },
);
const buildOk = await new Promise((resolve) => {
  built.on("error", (err) => { console.error(`Could not run esbuild at ${esbuild}: ${err.message}`); resolve(false); });
  built.on("exit", (code) => resolve(code === 0));
});
if (!buildOk) {
  console.error("Could not bundle the component for testing. Has `pnpm install` been run?");
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const pageFile = path.join(work, "index.html");
writeFileSync(
  pageFile,
  `<!doctype html><html><head><meta charset="utf-8"><title>call leave</title></head>
   <body><div id="root"></div><script src="./bundle.js"></script></body></html>`,
);

const browser = await (await getChromium()).launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`file://${pageFile}`);
  await page.waitForFunction(() => typeof window.__emit === "function", undefined, { timeout: 15000 });
  await page.waitForTimeout(500);

  console.log("\nA call that never comes up does not end the class");
  await page.evaluate(() => window.__emit("left-meeting"));
  await page.waitForTimeout(500);
  check(
    "a leave with no join before it is not reported",
    (await page.evaluate(() => window.__lefts)) === 0,
    `onLeft called ${await page.evaluate(() => window.__lefts)} time(s)`,
  );

  // Twice, because a flapping connection produces more than one.
  await page.evaluate(() => { window.__emit("left-meeting"); window.__emit("left-meeting"); });
  await page.waitForTimeout(500);
  check("nor is a second or third one", (await page.evaluate(() => window.__lefts)) === 0);

  console.log("\nA teacher who hangs up still ends the class");
  await page.evaluate(() => { window.__emit("joined-meeting"); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__emit("left-meeting"));
  await page.waitForTimeout(500);
  check("a leave after a join is reported", (await page.evaluate(() => window.__lefts)) === 1,
    `onLeft called ${await page.evaluate(() => window.__lefts)} time(s)`);

  // The connection drops again after the class has already been ended once.
  await page.evaluate(() => window.__emit("left-meeting"));
  await page.waitForTimeout(400);
  check("and is not reported twice for the same call",
    (await page.evaluate(() => window.__lefts)) === 1,
    `onLeft called ${await page.evaluate(() => window.__lefts)} time(s)`);

  console.log("\nEnding the class hands the camera back");
  /**
   * Reported from a real session: the teacher ended the class, went back to their session
   * list, and the webcam light was still on with the browser's camera indicator showing.
   * Nothing in the app was using the camera — the abandoned call was. `destroy()` removes the
   * iframe but does not reliably end the call inside it, and a frame still in a call keeps its
   * devices, so the order here is the fix.
   */
  await page.evaluate(() => { window.__calls = []; window.__endCall(); });
  await page.waitForTimeout(800);
  const calls = await page.evaluate(() => window.__calls);
  check("the call is left, not just torn down", calls.includes("leave"), JSON.stringify(calls));
  check("and the frame is destroyed after that", calls.includes("destroy"), JSON.stringify(calls));
  check(
    "in that order — a frame still in a call keeps the camera",
    calls.indexOf("leave") < calls.indexOf("destroy"),
    JSON.stringify(calls),
  );
  check(
    "and Daily itself is left holding no call",
    await page.evaluate(() => window.__callInstanceGone()),
    "the SDK still has a call instance, which is a frame nobody will ever release",
  );

  check("no errors were thrown", errors.length === 0, errors[0] ?? "");
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
process.exit(failed === 0 ? 0 : 1);
