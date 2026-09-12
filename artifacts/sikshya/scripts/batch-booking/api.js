const teacher = () => location.search.includes("teacher");
const result = () => ({ testOnly: true, paymentCollectedNpr: 0, isTeacher: teacher(), booked: false,
  quoteKey: "a".repeat(64), quote: { status: "full_offer", remainingLessonCount: 2, amountNpr: 6000 }, offerLessons: [{ position: 0, startsAt: "2026-10-01T10:15:00Z", durationMinutes: 60 }], lessons: [] });
export async function apiGet() {
  if (location.search.includes("unavailable")) throw new Error("An operator must enable your student test access first.");
  return result();
}
export async function apiPost(path, body) {
  window.bookingRequests = (window.bookingRequests ?? 0) + 1;
  window.bookingPayload = { path, body };
  await new Promise((r) => setTimeout(r, 200));
  if (location.search.includes("stale")) throw new Error("The dates or price changed. Review the current details before confirming.");
  return { ...result(), booked: true, lessons: [{ position: 0, sessionId: 125, startsAt: "2026-10-01T10:15:00Z", durationMinutes: 60 }] };
}
