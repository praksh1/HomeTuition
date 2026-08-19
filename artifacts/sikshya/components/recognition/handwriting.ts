/**
 * Handwriting to typed text, on the device.
 *
 * Scope, deliberately: **English only, and the recognition itself runs locally.** Nothing about
 * the teacher's board is uploaded anywhere, there is no API key to leak, no per-request bill,
 * and no round trip on a connection that may be poor. Tesseract's model files are fetched once
 * and then cached by the browser, so after the first use it works with no network at all.
 *
 * Devanagari is not attempted here. Tesseract is an OCR engine — it reads *printed* text well
 * and handwriting only passably — and on joined-up Devanagari it scores close to zero. Offering
 * it would produce confident nonsense, which is worse than not offering it. Real Nepali
 * handwriting recognition needs a purpose-built engine (Google's ML Kit does it free and
 * offline, but only inside the native apps; MyScript does it best and is commercial), and
 * `WHITEBOARD.md` sets out how to add one behind this same function.
 *
 * What to expect: neat printed handwriting reads well. Joined-up cursive does not. The caller
 * tells the teacher as much when a conversion comes back empty.
 */

export interface HandwritingResult {
  text: string;
  confidence: number;
}

interface StrokeElement {
  x: number;
  y: number;
  width: number;
  height: number;
  points?: [number, number][];
  strokeWidth?: number;
  [key: string]: unknown;
}

/**
 * Rendered at several times the drawn size.
 *
 * OCR accuracy falls off sharply below roughly 30 pixels of x-height, and handwriting on a
 * phone screen is often smaller than that. Upscaling the vectors before rasterising costs
 * nothing in quality — they are vectors — and makes the difference between a usable result and
 * gibberish.
 */
const RENDER_SCALE = 4;
/** Whitespace around the ink; Tesseract's line detection is unreliable without a margin. */
const PADDING = 24;
/** Beyond this the image is downscaled — a whole board of notes would otherwise be enormous. */
const MAX_DIMENSION = 2400;

/** Draws the selected strokes onto a white canvas, black on white, which is what OCR expects. */
function rasterize(strokes: StrokeElement[]): HTMLCanvasElement | null {
  if (typeof document === "undefined" || strokes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    const pts = s.points ?? [[0, 0]];
    for (const [px, py] of pts) {
      const x = s.x + px;
      const y = s.y + py;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX) || maxX - minX < 1) return null;

  const rawW = (maxX - minX) * RENDER_SCALE + PADDING * 2;
  const rawH = (maxY - minY) * RENDER_SCALE + PADDING * 2;
  const shrink = Math.min(1, MAX_DIMENSION / Math.max(rawW, rawH));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.round(rawW * shrink));
  canvas.height = Math.max(16, Math.round(rawH * shrink));

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = RENDER_SCALE * shrink;
  ctx.strokeStyle = "#000000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const s of strokes) {
    const pts = s.points ?? [];
    if (pts.length < 2) continue;
    // A hairline scan of a thin stroke can drop out entirely once binarised, so the pen is
    // never allowed below a couple of pixels at the rendered size.
    ctx.lineWidth = Math.max(2, (s.strokeWidth ?? 2) * scale * 0.8);
    ctx.beginPath();
    ctx.moveTo(
      (s.x + pts[0][0] - minX) * scale + PADDING * shrink,
      (s.y + pts[0][1] - minY) * scale + PADDING * shrink,
    );
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(
        (s.x + pts[i][0] - minX) * scale + PADDING * shrink,
        (s.y + pts[i][1] - minY) * scale + PADDING * shrink,
      );
    }
    ctx.stroke();
  }

  return canvas;
}

/**
 * The recognition worker, created once and reused.
 *
 * Starting a Tesseract worker means downloading and compiling a WASM module and a language
 * model — seconds of work. Doing that per conversion would make the feature feel broken, so the
 * worker is kept alive for the lifetime of the page.
 */
let workerPromise: Promise<{
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>;
}> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Imported lazily so the engine is never part of the initial page load. A teacher who
      // never converts handwriting never downloads it.
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      return worker as unknown as {
        recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>;
      };
    })().catch((err) => {
      // Allow a later attempt to retry rather than caching the failure forever.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Converts the given freehand strokes into text. Returns empty text when nothing was legible. */
export async function recognizeToText(strokes: unknown[]): Promise<HandwritingResult> {
  const canvas = rasterize(strokes as StrokeElement[]);
  if (!canvas) return { text: "", confidence: 0 };

  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);

  // Tesseract returns per-line text with trailing newlines; a board caption is almost always
  // one line, and collapsing the whitespace avoids a text element full of blank rows.
  const text = (data.text ?? "").replace(/\s+/g, " ").trim();
  const confidence = (data.confidence ?? 0) / 100;

  // Low-confidence output from an OCR engine reading handwriting is usually not a near miss —
  // it is unrelated characters. Better to say "couldn't read that" than to paste noise.
  if (confidence < 0.4) return { text: "", confidence };
  return { text, confidence };
}
