const teacher = () => location.search.includes("teacher");
const result = () => ({ testOnly: true, paymentCollectedNpr: 0, isTeacher: teacher(), booked: false,
  quoteKey: "a".repeat(64), quote: { status: "full_offer", remainingLessonCount: 2, amountNpr: 6000 }, offerLessons: [{ position: 0, startsAt: "2026-10-01T10:15:00Z", durationMinutes: 60 }], lessons: [], receipts: [] });
export async function apiGet(path) {
  if (path === "/admin/batch-test-payments") return { receipts: [{ reference: "TEST-BATCH-1", classTitle: "Synthetic SEE Maths", studentName: "Synthetic Student", recordedAt: "2026-10-01T10:15:00Z", grossNpr: 6000, teacherNpr: 4200, fadkoNpr: 1800 }] };
  if (location.search.includes("unavailable")) throw new Error("An operator must enable your student test access first.");
  return result();
}
export async function apiPost(path, body) {
  window.bookingRequests = (window.bookingRequests ?? 0) + 1;
  window.bookingPayload = { path, body };
  await new Promise((r) => setTimeout(r, 200));
  if (location.search.includes("stale")) throw new Error("The dates or price changed. Review the current details before confirming.");
  if (body.outcome === "declined") throw new Error("Test payment declined. No money moved and no place was booked. You can try again.");
  return { ...result(), booked: true, receipts: [{ reference: "TEST-BATCH-1", grossNpr: 6000, teacherNpr: 4200, fadkoNpr: 1800, allocations: [{ position: 0, grossNpr: 3000, teacherNpr: 2100, fadkoNpr: 900 }, { position: 1, grossNpr: 3000, teacherNpr: 2100, fadkoNpr: 900 }] }], lessons: [{ position: 0, sessionId: 125, startsAt: "2026-10-01T10:15:00Z", durationMinutes: 60 }] };
}
