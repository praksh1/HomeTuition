/** File types Fadko can safely store and exchange. Keep this aligned with the API allow-list. */
export const ATTACHMENT_PICKER_TYPES = [
  "image/*",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type AttachmentKind = "image" | "pdf" | "word" | "spreadsheet" | "file";

/** Best available MIME type when an older API row kept only the private key or filename. */
export function attachmentContentType(name: string): string {
  const clean = name.split("?")[0]?.toLowerCase() ?? "";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".heic")) return "image/heic";
  if (clean.endsWith(".heif")) return "image/heif";
  if (clean.endsWith(".pdf")) return "application/pdf";
  if (clean.endsWith(".doc")) return "application/msword";
  if (clean.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (clean.endsWith(".xls")) return "application/vnd.ms-excel";
  if (clean.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

export function attachmentKind(contentType: string): AttachmentKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (
    contentType === "application/msword" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "word";
  if (
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) return "spreadsheet";
  return "file";
}

export function attachmentKindLabel(contentType: string): string {
  switch (attachmentKind(contentType)) {
    case "image": return "Photo";
    case "pdf": return "PDF document";
    case "word": return "Word document";
    case "spreadsheet": return "Excel spreadsheet";
    default: return "Attached file";
  }
}
