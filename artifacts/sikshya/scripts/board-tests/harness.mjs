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
      // Elements *and* the picture data that goes with them — the classroom hub relays both,
      // and a rig that quietly dropped the pictures would report a passing sync while every
      // student saw empty picture frames.
      await student.evaluate(
        ({ els, files }) =>
          window.postMessage(
            JSON.stringify({ type: "scene_in", delta: { full: false, elements: els, files } }),
            "*",
          ),
        { els: m.elements, files: m.files ?? [] },
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
    let n = 0, left = 0, right = 0, red = 0;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      // A strongly red pixel means a shared picture actually rendered, not its placeholder.
      if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100 && data[i + 3] > 40) red++;
      if (!(data[i] < 128 && data[i + 3] > 40)) continue;
      const p = i / 4, x = p % width, y = Math.floor(p / width);
      n++;
      if (x < width / 2) left++; else right++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { n, left, right, red, minX, minY, maxX, maxY, width, height };
  });
}

/**
 * A solid red 64x64 PNG, as a data URL.
 *
 * Red because Excalidraw draws a *placeholder* for an image element whose picture data never
 * arrived, and a placeholder is grey. Counting red pixels is therefore the difference between
 * "the student got the picture" and "the student got an empty frame where a picture should be"
 * — which is the bug this fixture exists to catch.
 */
export const RED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsEty/UMZxgi+hcEKLNO+FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywLPLIEA68ZURwAAAABJRU5ErkJggg==";

/**
 * A valid two-page PDF, each page a solid red square.
 *
 * Red for the same reason as RED_PNG: it distinguishes a page that was really rasterised and
 * placed from a placeholder, an empty frame, or nothing at all.
 */
export const TWO_PAGE_PDF = "data:application/pdf;base64,JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PC9DcmVhdG9yIChDaHJvbWl1bSkKL1Byb2R1Y2VyIChTa2lhL1BERiBtMTQxKQovQ3JlYXRpb25EYXRlIChEOjIwMjYwODIwMDQzNDM5KzAwJzAwJykKL01vZERhdGUgKEQ6MjAyNjA4MjAwNDM0MzkrMDAnMDAnKT4+CmVuZG9iagozIDAgb2JqCjw8L2NhIDEKL0JNIC9Ob3JtYWw+PgplbmRvYmoKNCAwIG9iago8PC9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9MZW5ndGggMTA0Pj4gc3RyZWFtCnicZUtLCoNAFNvnFFkXfL73hhntCVzbTQ8wqCsLjvcH6VRQaCAhHyIenhVUKhu5RYvKvGLDd0keK8uE94MfbAhiHuvrcnmF9Mk7ilmXTn0N/C/LgnYIXHa40pWWfiwTZowYcQAmMR6WCmVuZHN0cmVhbQplbmRvYmoKNiAwIG9iago8PC9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9MZW5ndGggMTA3Pj4gc3RyZWFtCnicZUvLCoMwELzPV8y54Lq7IbH9gpz14geI9WTB+P9QjBYKDswyjx3x8KqgUtnIn7WonFZsOJrksbLMGB/8YEMQ81hXP9UcD9MKeSbvKGZduu6QeQ/LgjYHLjtc6a60dLLMeKNHjy+hvx9iCmVuZHN0cmVhbQplbmRvYmoKMiAwIG9iago8PC9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwvUHJvY1NldCBbL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSV0KL0V4dEdTdGF0ZSA8PC9HMyAzIDAgUj4+Pj4KL01lZGlhQm94IFswIDAgMTUwIDE1MF0KL0NvbnRlbnRzIDQgMCBSCi9TdHJ1Y3RQYXJlbnRzIDAKL1RhYnMgL1MKL1BhcmVudCA3IDAgUj4+CmVuZG9iago1IDAgb2JqCjw8L1R5cGUgL1BhZ2UKL1Jlc291cmNlcyA8PC9Qcm9jU2V0IFsvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJXQovRXh0R1N0YXRlIDw8L0czIDMgMCBSPj4+PgovTWVkaWFCb3ggWzAgMCAxNTAgMTUwXQovQ29udGVudHMgNiAwIFIKL1N0cnVjdFBhcmVudHMgMQovVGFicyAvUwovUGFyZW50IDcgMCBSPj4KZW5kb2JqCjcgMCBvYmoKPDwvVHlwZSAvUGFnZXMKL0NvdW50IDIKL0tpZHMgWzIgMCBSIDUgMCBSXT4+CmVuZG9iago4IDAgb2JqCjw8L1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDcgMCBSPj4KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwNTQzIDAwMDAwIG4gCjAwMDAwMDAxNTUgMDAwMDAgbiAKMDAwMDAwMDE5MiAwMDAwMCBuIAowMDAwMDAwNzQwIDAwMDAwIG4gCjAwMDAwMDAzNjYgMDAwMDAgbiAKMDAwMDAwMDkzNyAwMDAwMCBuIAowMDAwMDAwOTk4IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA5Ci9Sb290IDggMCBSCi9JbmZvIDEgMCBSPj4Kc3RhcnR4cmVmCjEwNDUKJSVFT0YK"

/** Draws a stroke with the pen, the way a teacher would. */
export async function stroke(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 });
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

/**
 * Draws a freehand path through a list of points, the way a finger would.
 *
 * `stroke` above draws a straight two-point line; recognition needs a shape drawn as a
 * continuous wobbling gesture, which is the only kind it is ever asked about.
 */
export async function drawPath(page, points) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** A rough circle, drawn with a wobble no hand would be without. */
export function roughCircle(cx, cy, r, wobble = 5) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const jitter = Math.sin(i * 2.7) * wobble;
    pts.push([cx + Math.cos(a) * (r + jitter), cy + Math.sin(a) * (r + jitter)]);
  }
  return pts;
}

/** The shape of a written word: open, curved, and none of the board's business. */
export function writingPath(x, y, length = 200) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    pts.push([x + (i / 40) * length, y + Math.sin(i / 2.2) * 26]);
  }
  return pts;
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
