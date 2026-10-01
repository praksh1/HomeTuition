import { apiGet as existingGet, apiPost as existingPost } from "./api.js";
export { ApiError } from "./api.js";

const initial = Array.from({ length: 250 }, (_, index) => ({
  id: index + 1000, senderId: index % 2 ? 11 : 7, receiverId: index % 2 ? 7 : 11,
  senderName: index % 2 ? "Anisha Rai" : "Staging Review Teacher",
  senderRole: index % 2 ? "student" : "teacher", read: true,
  body: `History ${index + 1}: ${"A realistic question and teaching explanation. ".repeat(index % 7 + 1)}`,
  createdAt: new Date(Date.parse("2026-09-27T12:00:00Z") + index * 60_000).toISOString(),
  ...(index % 13 === 0 ? { attachments: [{ fileKey: `history-photo-${index}`, fileType: "image/png", fileName: "Working.png" }], file: { fileKey: `history-photo-${index}`, fileType: "image/png", fileName: "Working.png" } } : {}),
}));

export async function apiGet(path) {
  if (path.endsWith("/access") || path.startsWith("/storage/")) return existingGet(path);
  if (path.startsWith("/messages/") || /\/class-groups\/.*\/messages/.test(path)) {
    globalThis.historyReads = (globalThis.historyReads ?? 0) + 1;
    const rows = [...initial, ...(globalThis.historyExtra ?? [])];
    if (globalThis.holdHistoryRead) {
      await new Promise(resolve => { globalThis.releaseHistoryRead = resolve; });
    }
    if (globalThis.failHistoryRead) throw new Error("Connection interrupted");
    return path.startsWith("/messages/") ? rows : { title: "IELTS evening class", isTeacher: true, messages: rows, pinned: [], hasEarlier: false };
  }
  return existingGet(path);
}
export const apiPost = existingPost;
