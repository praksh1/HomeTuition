/**
 * Deciding what to do with a PDF the phone's picker handed back.
 *
 * A picker on a phone returns a path, not bytes — `file://` on both platforms, `content://`
 * from an Android file provider. That path resolves on the one device and nowhere else, so for
 * a long time a PDF picked on a phone opened for the teacher alone, under a banner telling
 * them the class could not see it.
 *
 * Nothing about the board had to change to fix that. On a phone the board is a WebView running
 * the same web board, which already turns a PDF into pages and places them as ordinary
 * pictures the whole class can annotate. All it ever wanted was the bytes rather than a path.
 *
 * The reading is separated from the classroom screen because every interesting case here is a
 * failure — a file that vanished between picking and reading, one too big to carry, one that
 * comes back empty — and none of those can be reached from a test that has to drive a phone.
 * The screen keeps the wiring; this keeps the decision.
 */

/** PDFs are carried whole rather than re-encoded, so they need their own ceiling. */
export const MAX_PDF_BYTES = 8_000_000;

/**
 * The parts of expo-file-system's `File` this needs, and no more.
 *
 * Narrow deliberately: it is what lets every branch below be tested on a laptop, and it means
 * this file has no opinion about which file system it is reading.
 */
export interface ReadableFile {
  exists: boolean;
  size: number;
  base64(): Promise<string>;
}

export type PickedPdf =
  /** Bytes. These can go on the board, and every student will see the pages. */
  | { shareable: true; dataUrl: string }
  /**
   * Not bytes. The teacher can still open it here, and the classroom says plainly that the
   * class cannot see it — losing the PDF entirely would be worse than showing it to one person.
   */
  | { shareable: false; localUri: string; reason: string };

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export async function preparePickedPdf(
  uri: string,
  open: (uri: string) => ReadableFile,
  maxBytes: number = MAX_PDF_BYTES,
): Promise<PickedPdf> {
  try {
    const file = open(uri);

    // Between the picker returning and this running, a provider can revoke access or clean up
    // its cache copy. Reading it then throws something unreadable at the teacher.
    if (!file.exists) {
      return { shareable: false, localUri: uri, reason: "That PDF could not be opened from where it is stored." };
    }

    // Checked before reading, not after: the point is to avoid holding a very large file in
    // memory on a phone that has little, and base64 makes it a third larger again.
    if (file.size > maxBytes) {
      return {
        shareable: false,
        localUri: uri,
        reason: `This PDF is too large to share on the board — please use one under ${megabytes(maxBytes)}.`,
      };
    }

    const base64 = await file.base64();
    // An empty read is not an empty PDF; it is a failure that would otherwise reach the board
    // as a document with no pages, which looks like the board is broken.
    if (!base64) {
      return { shareable: false, localUri: uri, reason: "That PDF came back empty." };
    }

    return { shareable: true, dataUrl: `data:application/pdf;base64,${base64}` };
  } catch {
    return { shareable: false, localUri: uri, reason: "Could not read that PDF, so it is open here only." };
  }
}
