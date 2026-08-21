/**
 * A phone photo, dropped on the board the way Excalidraw's own image button does it.
 *
 * This is the bug a teacher reported from an iPhone: the picture appeared on their board and
 * reached the class as an empty frame. The cause was that Excalidraw's image button does not
 * go through our upload path, so the original file went on the wire untouched — and measured
 * against the real server, a 2 MB photo has its picture dropped and a 3 MB photo closes the
 * teacher's board connection outright.
 *
 * The fixture is deliberately the size a phone camera actually produces. A small test image
 * is exactly what let this through in the first place.
 *
 * Usage, from `artifacts/sikshya`:
 *   pnpm.cmd run test:photo
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const PORT = Number(process.env.PHOTO_TEST_PORT ?? 8092);
const baseUrl = `http://localhost:${PORT}`;
/**
 * Generated rather than committed: an 8 MB binary in the repository to prove a size limit is
 * its own kind of silly, and generating it means the fixture is always the size the test
 * claims. Override with PHONE_PHOTO to try a real photo from a real phone.
 */
async function makePhonePhoto(browser) {
  if (process.env.PHONE_PHOTO) return process.env.PHONE_PHOTO;
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(() => {
    // 12 megapixels, the resolution a current iPhone shoots at, filled with noise so it
    // cannot compress down to nothing the way a flat colour would.
    const c = document.createElement("canvas");
    c.width = 3024;
    c.height = 4032;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, 64);
    for (let band = 0; band < c.height; band += 64) {
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = Math.random() * 255;
        img.data[i + 1] = Math.random() * 255;
        img.data[i + 2] = Math.random() * 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, band);
    }
    return c.toDataURL("image/jpeg", 0.95);
  });
  await page.close();
  const file = path.join(mkdtempSync(path.join(tmpdir(), "phone-photo-")), "phone-photo.jpg");
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return file;
}

/**
 * What the server will actually accept. Mirrors MAX_MATERIAL_CHARS in classroomHub.ts, and
 * the frame limit that closes the socket above it.
 */
const SERVER_CHAR_LIMIT = 2_500_000;
const SOCKET_FRAME_LIMIT = 4 * 1024 * 1024;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`   PASS  ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
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

async function openBoard(browser, { readOnly, phone }) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1200, height: 860 } },
  );
  const page = await ctx.newPage();
  page.on("pageerror", () => {});
  await page.addInitScript(() => {
    window.__out = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__out.push(JSON.parse(s)) };
  });
  await page.goto(`${baseUrl}/board?readOnly=${readOnly ? 1 : 0}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

/** Ink on the canvas: anything that is not the white board. */
async function ink(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    let best = 0;
    for (const c of canvases) {
      const ctx = c.getContext("2d");
      if (!ctx || !c.width || !c.height) continue;
      let n = 0;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4 * 40) {
        if (d[i + 3] > 10 && !(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) n += 1;
      }
      best = Math.max(best, n);
    }
    return best;
  });
}

async function main() {
  await waitForServer();
  const chromium = await getChromium();
  const browser = await chromium.launch();

  try {
    const photoPath = await makePhonePhoto(browser);
    const bytes = readFileSync(photoPath);
    console.log(`\na teacher shares a ${(bytes.length / 1048576).toFixed(1)} MB phone photo`);

    const teacher = await openBoard(browser, { readOnly: false, phone: true });
    const student = await openBoard(browser, { readOnly: true, phone: false });

    // Excalidraw's own image button, which is what the teacher actually used — not our
    // "Add material" upload, which has always downscaled.
    // Dropped rather than picked. The editor's file picker is an OS dialog it builds on
    // demand, and a drop goes through exactly the same insertion path — the untouched
    // original lands in the editor's own files map, which is the thing under test.
    const pasted = await teacher.page.evaluate(async (b64) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
      const file = new File([buf], "phone-photo.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector(".excalidraw") ?? document.body;
      const rect = target.getBoundingClientRect();
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(type, {
          dataTransfer: dt, bubbles: true, cancelable: true,
          clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
        }));
      }
      return file.size;
    }, bytes.toString("base64"));
    check("the photo reaches the editor", pasted > 1_000_000, `${(pasted / 1048576).toFixed(1)} MB`);
    // Re-encoding 12 megapixels takes a moment on a slow machine, and the element is held
    // back until it is done — which is the behaviour under test.
    await teacher.page.waitForTimeout(12000);

    const sent = await teacher.page.evaluate(() =>
      window.__out.filter((m) => m.type === "scene_out" && (m.files ?? []).length > 0),
    );
    const files = sent.flatMap((m) => m.files);
    check("the picture is sent to the class at all", files.length > 0, `${sent.length} scene messages`);

    /**
     * The invariant, across everything the board has said, not just the message with the file.
     *
     * A picture frame whose picture never went with it renders on every student's board as a
     * grey placeholder and on the teacher's as the real thing, because theirs draws from local
     * memory. Nobody in the room can tell the two boards have diverged. The board holds an
     * element back until its picture is ready, and — the case that was wrong — holds it back
     * for good when the picture cannot be made small enough at all.
     */
    const everything = await teacher.page.evaluate(() =>
      window.__out.filter((m) => m.type === "scene_out"),
    );
    const sentFileIds = new Set(everything.flatMap((m) => (m.files ?? []).map((f) => f.id)));
    const framesSent = everything.flatMap((m) => (m.elements ?? []).filter((e) => e.fileId));
    check(
      "no picture frame was ever sent to the class without its picture",
      framesSent.every((e) => sentFileIds.has(e.fileId)),
      `frames with no picture: ${JSON.stringify(framesSent.filter((e) => !sentFileIds.has(e.fileId)).map((e) => e.id))}`,
    );

    const biggest = files.reduce((max, f) => Math.max(max, (f.dataURL ?? "").length), 0);
    console.log(`   ...  what the editor held: ${(pasted / 1048576).toFixed(2)} MB; what went on the wire: ${(biggest / 1048576).toFixed(2)} MB of base64`);
    check(
      "it is small enough for the server to accept",
      biggest > 0 && biggest <= SERVER_CHAR_LIMIT,
      `${(biggest / 1048576).toFixed(2)} MB of base64, limit ${(SERVER_CHAR_LIMIT / 1048576).toFixed(2)} MB`,
    );

    const frameSize = JSON.stringify(sent[sent.length - 1] ?? {}).length;
    check(
      "the whole message stays under the frame limit that closes the socket",
      frameSize < SOCKET_FRAME_LIMIT,
      `${(frameSize / 1048576).toFixed(2)} MB`,
    );

    // An element must never travel without its picture — that is the empty frame itself.
    const elementsWithFile = sent.flatMap((m) => (m.elements ?? []).filter((e) => e.fileId));
    const fileIds = new Set(files.map((f) => f.id));
    check(
      "every picture element travels with its picture",
      elementsWithFile.length > 0 && elementsWithFile.every((e) => fileIds.has(e.fileId)),
      `${elementsWithFile.length} image elements, ${fileIds.size} pictures`,
    );

    // And the student actually renders it, which is the only thing that really settles it.
    const before = await ink(student.page);
    // Delivered exactly the way the classroom delivers it — see scripts/board-tests/harness.mjs.
    await student.page.evaluate(
      ({ els, fs }) =>
        window.postMessage(JSON.stringify({ type: "scene_in", delta: { full: false, elements: els, files: fs } }), "*"),
      { els: sent.flatMap((m) => m.elements ?? []), fs: files },
    );
    await student.page.waitForTimeout(4000);
    const after = await ink(student.page);
    check(
      "the student sees the picture, not an empty frame",
      after > before + 50,
      `ink ${before} -> ${after}`,
    );

    await teacher.ctx.close();
    await student.ctx.close();
  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); stopServer(); process.exit(1); });
