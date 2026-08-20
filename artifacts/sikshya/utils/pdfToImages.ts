/**
 * Turning a shared PDF into whiteboard pages — the native side.
 *
 * On iOS and Android the board itself runs inside a WebView, and a PDF picked with
 * DocumentPicker is a device-local `file://` URI rather than bytes we hold. Rasterising it here
 * would mean reading the file, shipping it into the WebView, and rendering there — worth doing,
 * but not worth pretending to have done. Until then this reports honestly that it cannot, and
 * the classroom keeps the local viewer plus the warning that students cannot see it.
 *
 * Metro resolves `.web.ts` ahead of this file on web, where the real implementation lives.
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

export const PDF_TO_BOARD_SUPPORTED = false;

/**
 * Same signature as the web implementation, deliberately: TypeScript resolves this file, Metro
 * resolves the `.web.ts` one, and a caller that typechecks here has to work there too.
 */
export async function renderPdfToImages(
  _dataUrl: string,
  _onProgress?: (progress: PdfRenderProgress) => void,
): Promise<PdfRenderResult> {
  throw new Error("Sharing a PDF to the whiteboard is only available on the web app for now.");
}
