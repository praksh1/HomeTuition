/**
 * The whiteboard on a slow phone.
 *
 * CLAUDE.md: "Design for a cheap Android phone on a poor connection, not for a developer's
 * laptop." Every board test so far has run on a fast machine at full speed, which measures the
 * one device nobody in this market owns. This one throttles the processor to what a budget
 * Android actually manages, at a phone's screen size, and loads a lesson's worth of work.
 *
 * It reports numbers rather than passing or failing on most of them, because "is 300ms too
 * slow" is a judgement and the useful output is the measurement. Two things do fail: the board
 * not becoming usable at all, and an update taking so long the lesson would be unusable.
 *
 * Usage, from `artifacts/sikshya`:
 *   pnpm.cmd run test:perf
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.PERF_TEST_PORT ?? 8084);
const baseUrl = `http://localhost:${PORT}`;

/**
 * How much slower to make the processor.
 *
 * A budget Android of the kind this product is aimed at runs roughly four to six times slower
 * than a development machine on single-threaded work, which is what canvas rendering is. Six
 * is the pessimistic end and the right one to design against.
 */
const CPU_SLOWDOWN = Number(process.env.CPU_SLOWDOWN ?? 6);

/** A lesson's worth of work. An hour of teaching is a few hundred strokes, not a few thousand. */
const LESSON_SIZES = [50, 200, 500];

/** Past this an update is not slow, it is broken — the board would visibly stall mid-lesson. */
const UNUSABLE_MS = 3000;

let failed = 0;
const failures = [];
function must(name, ok, detail = "") {
  if (ok) console.log(`   PASS  ${name}`);
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const report = (label, value) => console.log(`   ....  ${label}: ${value}`);

if (!existsSync(path.join(appRoot, "web-build", "index.html"))) {
  console.error("No build to test. Build the web app first:\n  pnpm.cmd --filter @workspace/sikshya run build");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], {
  cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stopServer);

async function waitForSite() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${baseUrl}/board`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the static server never came up on ${baseUrl}`);
}

/** A lesson: freehand strokes, some shapes, some text — what a teacher actually leaves behind. */
function lessonElements(count) {
  const elements = [];
  for (let i = 0; i < count; i += 1) {
    const kind = i % 5;
    const base = {
      id: `perf-${i}`,
      version: 1,
      versionNonce: i + 1,
      seed: i + 7,
      x: (i * 37) % 1600,
      y: (i * 53) % 1200,
      width: 60 + (i % 40),
      height: 30 + (i % 25),
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      boundElements: [],
      updated: 1,
      link: null,
      locked: false,
      isDeleted: false,
    };
    if (kind === 0) {
      elements.push({
        ...base,
        type: "freedraw",
        points: Array.from({ length: 24 }, (_, k) => [k * 3, Math.sin(k / 3) * 12]),
        pressures: [],
        simulatePressure: true,
      });
    } else if (kind === 1) {
      elements.push({ ...base, type: "rectangle" });
    } else if (kind === 2) {
      elements.push({ ...base, type: "ellipse" });
    } else if (kind === 3) {
      elements.push({
        ...base, type: "text", text: `Step ${i}`, originalText: `Step ${i}`,
        fontSize: 20, fontFamily: 1, textAlign: "left", verticalAlign: "top",
        containerId: null, lineHeight: 1.25,
      });
    } else {
      elements.push({ ...base, type: "line", points: [[0, 0], [base.width, base.height]] });
    }
  }
  return elements;
}

async function openThrottledBoard(browser, { readOnly }) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  page.errors = errors;
  await page.addInitScript(() => {
    window.__out = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__out.push(JSON.parse(s)) };
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });

  await page.goto(`${baseUrl}/board?readOnly=${readOnly ? 1 : 0}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  return { ctx, page, cdp };
}

async function main() {
  await waitForSite();
  const chromium = await getChromium();
  const browser = await chromium.launch();

  console.log(`\nProcessor throttled ${CPU_SLOWDOWN}x, screen 393x852 — a budget Android, roughly.`);

  try {
    for (const size of LESSON_SIZES) {
      console.log(`\na lesson of ${size} things on the board`);
      const { ctx, page } = await openThrottledBoard(browser, { readOnly: true });

      const elements = lessonElements(size);

      // A student joining mid-lesson: the whole board arrives at once.
      const arrival = await page.evaluate(async (els) => {
        const start = performance.now();
        window.postMessage(JSON.stringify({ type: "scene_in", delta: { full: true, elements: els, files: [] } }), "*");
        // Wait until the canvas has actually painted something, not just until the message was
        // handed over — the delay a student feels is the one that ends in pixels.
        const deadline = start + 30000;
        while (performance.now() < deadline) {
          await new Promise((r) => requestAnimationFrame(r));
          const canvas = document.querySelector("canvas");
          if (canvas) {
            const ctx2d = canvas.getContext("2d");
            if (ctx2d && canvas.width > 0) {
              const d = ctx2d.getImageData(0, 0, canvas.width, canvas.height).data;
              let ink = 0;
              for (let i = 0; i < d.length; i += 4 * 200) {
                if (d[i + 3] > 10 && !(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) ink += 1;
              }
              if (ink > 5) return { ms: Math.round(performance.now() - start), ink };
            }
          }
        }
        return { ms: -1, ink: 0 };
      }, elements);

      must(
        "a student joining sees the lesson",
        arrival.ms > 0,
        arrival.ms < 0 ? "nothing was ever drawn" : "",
      );
      report("time until the board shows the lesson", `${arrival.ms} ms`);

      // Then the thing that happens all lesson: the teacher adds one more stroke.
      const singleUpdate = await page.evaluate(async (nextId) => {
        const times = [];
        for (let n = 0; n < 5; n += 1) {
          const el = {
            id: `${nextId}-${n}`, type: "freedraw", version: 1, versionNonce: n + 99, seed: n + 3,
            x: 100 + n * 20, y: 100 + n * 20, width: 80, height: 40, angle: 0,
            strokeColor: "#c41e3a", backgroundColor: "transparent", fillStyle: "solid",
            strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
            frameId: null, roundness: null, boundElements: [], updated: 1, link: null,
            locked: false, isDeleted: false,
            points: Array.from({ length: 20 }, (_, k) => [k * 4, Math.cos(k / 2) * 10]),
            pressures: [], simulatePressure: true,
          };
          const start = performance.now();
          window.postMessage(JSON.stringify({ type: "scene_in", delta: { full: false, elements: [el], files: [] } }), "*");
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { median: Math.round(times[2]), worst: Math.round(times[times.length - 1]) };
      }, `late-${size}`);

      report("one new stroke arriving (median)", `${singleUpdate.median} ms`);
      report("one new stroke arriving (worst of 5)", `${singleUpdate.worst} ms`);
      must(
        "the board keeps up with the teacher drawing",
        singleUpdate.worst < UNUSABLE_MS,
        `${singleUpdate.worst} ms for one stroke`,
      );

      const memory = await page.evaluate(() =>
        performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
      );
      if (memory > 0) report("memory in use", `${memory} MB`);

      must("nothing threw", page.errors.length === 0, page.errors[0] ?? "");
      await ctx.close();
    }

    // The teacher's side: does drawing itself stay responsive with a full board?
    console.log("\nthe teacher drawing on a full board");
    const { ctx, page } = await openThrottledBoard(browser, { readOnly: false });
    await page.evaluate((els) => {
      window.postMessage(JSON.stringify({ type: "scene_in", delta: { full: true, elements: els, files: [] } }), "*");
    }, lessonElements(300));
    await page.waitForTimeout(4000);

    await page.click('.App-toolbar [title^="Draw"]').catch(() => {});
    await page.waitForTimeout(400);
    const canvas = await page.$("canvas");
    const box = await canvas.boundingBox();

    const drawStart = Date.now();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4);
    await page.mouse.down();
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.move(box.x + box.width * (0.25 + i * 0.04), box.y + box.height * (0.4 + Math.sin(i) * 0.03));
    }
    await page.mouse.up();
    const drawMs = Date.now() - drawStart;
    report("drawing a stroke, start to finish", `${drawMs} ms`);

    await page.waitForTimeout(1200);
    const sent = await page.evaluate(() =>
      window.__out.filter((m) => m.type === "scene_out").length,
    );
    must("the stroke reaches the class", sent > 0, `${sent} scene messages`);
    must("nothing threw while drawing", page.errors.length === 0, page.errors[0] ?? "");
    await ctx.close();
  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\n${failed === 0 ? "No blocking problems" : `${failed} blocking problem(s)`} at ${CPU_SLOWDOWN}x slowdown.`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
