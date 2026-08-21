/**
 * Turning a shared PDF into whiteboard pages — the native side.
 *
 * On iOS and Android the board runs inside a WebView, so nothing rasterises a PDF in React
 * Native's own JavaScript — and nothing needs to. The classroom reads the picked file into
 * bytes and posts them to the WebView, where the web board renders them with the real
 * implementation in `pdfToImages.web.ts`. This file is only the twin that keeps the types
 * honest: Metro resolves `.web.ts` ahead of it wherever the board actually runs.
 *
 * So reaching this function means a PDF got into React Native's own bundle rather than the
 * board's, which is a wiring mistake rather than a missing feature. It throws rather than
 * returning something empty that would look like a document with no pages.
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

/**
 * Same signature as the web implementation, deliberately: TypeScript resolves this file, Metro
 * resolves the `.web.ts` one, and a caller that typechecks here has to work there too.
 */
export async function renderPdfToImages(
  _dataUrl: string,
  _onProgress?: (progress: PdfRenderProgress) => void,
): Promise<PdfRenderResult> {
  throw new Error("A PDF must be rendered on the board itself, not in the app's own bundle.");
}
