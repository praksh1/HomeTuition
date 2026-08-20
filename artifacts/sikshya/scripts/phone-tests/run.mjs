/**
 * The board, at the size it is actually taught on.
 *
 * Every one of these comes from a recording made on a real iPhone. The whiteboard tests drive
 * a desktop-sized window, which is exactly the window in which none of this shows up: the
 * board looked correct on a laptop and was missing its most important tool on a phone.
 *
 * "Design for a cheap Android phone on a poor connection, not for a developer's laptop"
 * is in CLAUDE.md. This is that sentence, as a test.
 *
 * Usage, from `artifacts/sikshya`:
 *   pnpm.cmd run test:phone
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.PHONE_TEST_PORT ?? 8093);
const baseUrl = `http://localhost:${PORT}`;

/** Widths that matter: iPhone 14/15, iPhone SE and older small Androids, a cheap Android. */
const PHONES = [
  { name: "iPhone 14 Pro", width: 393, height: 852 },
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "small Android", width: 360, height: 740 },
];

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`   PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first:\n  pnpm.cmd --filter @workspace/sikshya run build");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stopServer);

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${baseUrl}/board`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the static server never came up on ${baseUrl}`);
}

async function openPhoneBoard(browser, phone) {
  const ctx = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  page.on("pageerror", () => {});
  await page.addInitScript(() => {
    window.__out = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__out.push(JSON.parse(s)) };
  });
  await page.goto(`${baseUrl}/board?readOnly=0`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

async function main() {
  await waitForServer();
  const chromium = await getChromium();
  const browser = await chromium.launch();

  try {
    for (const phone of PHONES) {
      console.log(`\non a ${phone.name} (${phone.width}px)`);
      const { ctx, page } = await openPhoneBoard(browser, phone);

      const layout = await page.evaluate(() => {
        const inView = (el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= window.innerWidth && r.width > 0;
        };
        const label = (el) =>
          (el.getAttribute("title") || el.getAttribute("aria-label") || "?").split("—")[0].trim();
        // Only what is actually displayed. The toolbar also holds a hidden mobile menu
        // (Edit / Duplicate / Delete) which is off screen by design until it is opened.
        const tools = [...document.querySelectorAll(".App-toolbar button, .App-toolbar label")]
          .filter((el) => el.offsetParent !== null);
        const container = document.querySelector(".App-toolbar-container");
        const box = container ? container.getBoundingClientRect() : null;
        return {
          isMobileLayout: document.querySelector(".excalidraw")?.classList.contains("excalidraw--mobile") ?? false,
          toolCount: tools.length,
          offscreen: tools.filter((t) => !inView(t)).map(label),
          names: tools.map(label),
          container: box ? { left: Math.round(box.left), right: Math.round(box.right) } : null,
          viewportWidth: window.innerWidth,
          bodyOverflows: document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      check("the editor uses its phone layout", layout.isMobileLayout);
      // The one that matters: without Selection a teacher cannot move, resize or rearrange
      // anything they have drawn, which is most of what an object board is for.
      check(
        "every tool is on screen",
        layout.offscreen.length === 0,
        layout.offscreen.length ? `off screen: ${layout.offscreen.join(", ")}` : "",
      );
      check(
        "the Selection tool is present and reachable",
        layout.names.some((n) => n.toLowerCase().startsWith("selection")) &&
          !layout.offscreen.some((n) => n.toLowerCase().startsWith("selection")),
        `tools: ${layout.names.join(" | ")}`,
      );
      check(
        "the toolbar sits inside the screen",
        layout.container !== null &&
          layout.container.left >= 0 &&
          layout.container.right <= layout.viewportWidth,
        JSON.stringify(layout.container),
      );
      check("the page does not scroll sideways", !layout.bodyOverflows);

      // Drawing still has to work at this size — a toolbar that fits but cannot draw is no use.
      // The board opens on Selection, where a drag selects rather than draws, so pick the pen.
      await page.click('.App-toolbar [title^="Draw"]');
      await page.waitForTimeout(200);
      const canvas = await page.$("canvas");
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const drew = await page.evaluate(() =>
        window.__out.some((m) => m.type === "scene_out" && (m.elements ?? []).length > 0),
      );
      check("a teacher can still draw", drew);

      await ctx.close();
    }
  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
