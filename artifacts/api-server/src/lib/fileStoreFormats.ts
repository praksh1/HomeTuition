/** Formats Fadko accepts for private messages, classwork and support evidence. */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** The extension for a type we accept, so a downloaded file opens in the right app. */
export function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/heic": return ".heic";
    case "image/heif": return ".heif";
    case "application/pdf": return ".pdf";
    case "application/msword": return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return ".docx";
    case "application/vnd.ms-excel": return ".xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return ".xlsx";
    default: return "";
  }
}

/** A safe download header for an original filename that was never stored in the object key. */
export function downloadDisposition(downloadName?: string): string | undefined {
  // The ASCII name is the compatibility fallback; filename* keeps Nepali and other Unicode
  // names intact. Line breaks, quotes and path separators can never become response headers.
  const safeName = downloadName
    ?.replace(/[\r\n"\\/]/g, "_")
    .trim()
    .slice(0, 180);
  if (!safeName) return undefined;
  const asciiName = safeName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[%;]/g, "_")
    .trim() || "Fadko attachment";
  const encodedName = encodeURIComponent(safeName)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
