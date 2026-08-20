/**
 * Shared rig for the whiteboard tests.
 *
 * These tests drive the *real* board page in a *real* browser. They deliberately do not import
 * SmartBoard and call its functions: every whiteboard bug this project has had lived in the gap
 * between "the code looks right" and "the two screens actually agree", and only a rendered
 * canvas can settle that. So a test opens two board pages, plays the part of the classroom
 * WebSocket between them, and then compares pixels.
 *
 * The server is replaced rather than run: `pump()` carries the exact messages the app carries
 * (`scene_out` -> `scene_in`, `view_out` -> `view_in`, `clear_out` -> `clear`), so the sync
 * rules are under test without needing a database, a login or a live class.
 */
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Playwright is deliberately not a project dependency: it pulls a browser download into every
 * `pnpm install`, on every machine, for a test suite most contributors will never run. It is
 * found wherever it happens to be installed instead.
 */
export async function getChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {}
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    const entry = pathToFileURL(path.join(globalRoot, "playwright", "index.mjs")).href;
    return (await import(entry)).chromium;
  } catch {}
  throw new Error(
    "Playwright not found. Install it first:\n" +
      "  npm.cmd i -g playwright && npx.cmd playwright install chromium",
  );
}

/** Pretends to be the host app, so the page's outgoing messages can be read back. */
const stubHost = () => {
  window.__out = [];
  window.ReactNativeWebView = { postMessage: (s) => window.__out.push(JSON.parse(s)) };
};

export async function openBoard(ctx, baseUrl, { readOnly }) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  await page.addInitScript(stubHost);
  await page.goto(`${baseUrl}/board?readOnly=${readOnly ? 1 : 0}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  return page;
}

/**
 * Carries one round of messages from the teacher's board to the student's, the way the
 * classroom hub would. Returns the message types seen, which is itself worth asserting on —
 * a deletion that produces no `scene_out` is the bug that started all this.
 */
export async function pump(teacher, student) {
  const msgs = await teacher.evaluate(() => {
    const out = window.__out;
    window.__out = [];
    return out;
  });
  for (const m of msgs) {
    if (m.type === "scene_out") {
      await student.evaluate(
        (els) =>
          window.postMessage(
            JSON.stringify({ type: "scene_in", delta: { full: false, elements: els } }),
            "*",
          ),
        m.elements,
      );
    } else if (m.type === "view_out") {
      await student.evaluate(
        (v) => window.postMessage(JSON.stringify({ type: "view_in", view: v }), "*"),
        m.view,
      );
    } else if (m.type === "clear_out") {
      // What the hub does with a clear: tell everyone else to wipe.
      await student.evaluate(() => window.postMessage(JSON.stringify({ type: "clear" }), "*"));
    }
  }
  await student.waitForTimeout(350);
  return msgs.map((m) => m.type);
}

/**
 * Ink on the board, read straight off the canvas.
 *
 * Counting dark pixels and their bounding box is crude and exactly right for this: it cannot be
 * fooled by an element that exists in the scene but renders nowhere, which is precisely what an
 * un-synced deletion looks like from the code's point of view.
 */
export function ink(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas.excalidraw__canvas.static");
    const { data, width, height } = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height);
    let n = 0, left = 0, right = 0;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i] < 128 && data[i + 3] > 40)) continue;
      const p = i / 4, x = p % width, y = Math.floor(p / width);
      n++;
      if (x < width / 2) left++; else right++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { n, left, right, minX, minY, maxX, maxY, width, height };
  });
}

/** Draws a stroke with the pen, the way a teacher would. */
export async function stroke(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 });
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

export const PEN = "7";
export const ERASER = "0";

/** Picks a tool by its keyboard shortcut, after focusing the canvas. */
export async function selectTool(page, key) {
  await page.mouse.click(450, 400);
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
}

export const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance;
