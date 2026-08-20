// The **legacy** build, deliberately.
//
// pdf.js's modern bundle uses very recent JavaScript — `Map.prototype.getOrInsertComputed`
// among others — and dies with "getOrInsertComputed is not a function" on any engine that
// does not have it yet. That is not a corner case for this product: its market is cheap
// Android phones whose Chrome and WebView are often years behind. The legacy build is
// transpiled for exactly those browsers, and the only cost is a slightly larger file that is
// loaded on demand anyway.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Turns a shared PDF into pictures the whiteboard can hold.
 *
 * A PDF used to be handed to each participant to render for themselves, which is how the
 * teacher ended up looking at a full PDF viewer with the whiteboard hidden behind it while
 * students got a broken half-view — with neither able to tell they were seeing different
 * things. Pages become ordinary board images instead: annotatable with every tool, movable,
 * and synced by exactly the same rules as a hand-drawn circle.
 *
 * **It renders on the teacher's device, once.** Students receive plain pictures and never run
 * a PDF engine at all, which matters when most of them are on cheap Android phones — the
 * original decision to keep pdf.js out of this app was made for exactly that reason, and it
 * still holds for everyone except the person doing the sharing.
 */

export interface PdfRenderProgress {
  page: number;
  total: number;
}

export interface PdfRenderResult {
  /** One JPEG data URL per rendered page, in order. */
  pages: string[];
  /** True when the document had more pages than are placed on the board. */
  truncated: boolean;
}

export const PDF_TO_BOARD_SUPPORTED = true;

/**
 * A lesson is not a textbook. Beyond this the board becomes unusable and the room's memory
 * suffers, so the rest is left out and the teacher is told.
 */
const MAX_PAGES = 25;

/**
 * Longest edge of a rendered page, matching the ceiling used for uploaded photos. A page is
 * never shown larger than this on any screen the app targets, so rendering finer is memory
 * spent on detail nobody can see.
 */
const TARGET_EDGE = 1600;

/** Pages are photographs of text; JPEG at this quality is indistinguishable and far smaller. */
const JPEG_QUALITY = 0.72;

/**
 * pdf.js runs its parser in a web worker loaded by URL.
 *
 * It is served from our own origin — copied into `public/` by `scripts/copy-pdf-worker.js` —
 * rather than a CDN, so sharing a PDF never depends on a third party being reachable from
 * Kathmandu on a bad connection.
 */
function ensureWorker(): void {
  if (pdfjs.GlobalWorkerOptions.workerSrc) return;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  pdfjs.GlobalWorkerOptions.workerSrc = `${origin}/pdf.worker.min.js`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function renderPdfToImages(
  dataUrl: string,
  onProgress?: (progress: PdfRenderProgress) => void,
): Promise<PdfRenderResult> {
  ensureWorker();

  const doc = await pdfjs.getDocument({
    data: dataUrlToBytes(dataUrl),
    // No scripting, no external fetches: this is a document being photographed, not run.
    isEvalSupported: false,
    disableAutoFetch: true,
  }).promise;

  const total = Math.min(doc.numPages, MAX_PAGES);
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
      onProgress?.({ page: pageNumber, total });
      const page = await doc.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, TARGET_EDGE / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not render the PDF.");

        // White behind the page: PDFs are transparent where they are unpainted, and a
        // transparent JPEG turns black.
        context.fillStyle = "#FFFFFF";
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        pages.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));

        // Release each page before starting the next; a long document rendered all at once is
        // what exhausts memory on a modest laptop.
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return { pages, truncated: doc.numPages > total };
}
