/**
 * Working out what a picked file actually is.
 *
 * A file chosen through a browser does not reliably say. On Android, a PDF picked from
 * Downloads or Drive commonly arrives with an **empty** `type`, or `application/octet-stream`
 * — the file provider simply does not declare one. Code that asks only
 * `file.type === "application/pdf"` therefore decides it is not a PDF, hands it to the image
 * path, and the teacher is told their PDF "could not be opened as an image".
 *
 * That is exactly what was reported: "adding pdf file in whiteboard still does not work" while
 * "image is working fine" — because photos from a gallery do come with a proper `image/*` type
 * and PDFs from a file manager often do not.
 *
 * So the name is consulted whenever the type is unhelpful. It is the one piece of information
 * every picker on every platform provides.
 */

interface PickedFile {
  name?: string;
  type?: string;
}

/** Types that mean "I don't know", not "this is binary rubbish". */
const UNHELPFUL = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function extension(file: PickedFile): string {
  const name = (file.name ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

export function looksLikePdf(file: PickedFile): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type === "application/pdf" || type === "application/x-pdf") return true;
  if (!UNHELPFUL.has(type)) return false;
  return extension(file) === "pdf";
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif"]);

export function looksLikeImage(file: PickedFile): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (!UNHELPFUL.has(type)) return false;
  return IMAGE_EXTENSIONS.has(extension(file));
}
