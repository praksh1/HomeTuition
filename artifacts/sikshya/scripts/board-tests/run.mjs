/**
 * Runs the whiteboard tests against a built copy of the web app.
 *
 * Usage, from `artifacts/sikshya`:
 *   pnpm.cmd run test:board
 *
 * It serves `web-build/` itself and tears the server down afterwards, so the only prerequisite
 * is that a build exists. Exits non-zero on the first failed assertion so this can gate a
 * deploy.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "./harness.mjs";
import { tests } from "./tests.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.BOARD_TEST_PORT ?? 8099);
const baseUrl = `http://localhost:${PORT}`;

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error(
    "No build to test. Build the web app first:\n" +
      "  pnpm.cmd --filter @workspace/sikshya run build\n" +
      "(any EXPO_PUBLIC_API_URL will do — these tests never call the API.)",
  );
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot,
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
const stopServer = () => { try { server.kill(); } catch {} };
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${baseUrl}/board`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the static server never came up on ${baseUrl}`);
}

const chromium = await getChromium();
await waitForServer();

const browser = await chromium.launch();
let failures = 0;
let checks = 0;

for (const test of tests) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const failedHere = [];
  const assert = (what, ok) => {
    checks++;
    if (!ok) { failures++; failedHere.push(what); }
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${what}`);
  };

  console.log(`\n${test.name}`);
  try {
    await test.run(ctx, baseUrl, assert);
  } catch (err) {
    failures++;
    console.log(`   ERROR ${err.message}`);
  }
  // A page error means something threw in the board itself, which no pixel check would catch.
  for (const page of ctx.pages()) {
    for (const e of page.errors ?? []) {
      failures++;
      console.log(`   FAIL  the board threw: ${e}`);
    }
  }
  if (failedHere.length > 0) console.log(`   why this matters: ${test.why}`);
  await ctx.close();
}

await browser.close();
stopServer();

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log("Something the whiteboard has to get right is broken. Do not deploy.");
  process.exit(1);
}
console.log("The board is in step: erasures, viewport, clear, catch-up and controls.");
