// Synthetic browser-only fixture. No request reaches staging or production.
export class ApiError extends Error {}
let batch = { id: 1, programId: 1, currentProgramVersion: 1, status: "draft", capacity: 6, totalTuitionNpr: 3000, version: 0,
  publishedAt: null, published: null, updatedAt: "2026-09-10T00:00:00Z",
  lessons: [{ id: 1, position: 0, startsAt: "2028-02-28T10:45:00Z", durationMinutes: 60 }] };
window.batchRequests = [];
const periodMs = 30 * 86400000;
if (window.ongoingFixture) batch = { ...batch, format: "ongoing", tuitionGroupId: 4, periodAnchorLocked: false, tuitionPeriod: { groupId: 4, index: 0, startsAt: batch.lessons[0].startsAt, endsAt: new Date(Date.parse(batch.lessons[0].startsAt) + periodMs).toISOString() } };
export async function apiGet() { return { batches: [structuredClone(batch)] }; }
export async function apiPatch(url, input) {
  window.batchRequests.push({ method: "PATCH", url, input });
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (window.failBatchSave) throw new ApiError("Test connection lost. Your changes have not been saved.");
  batch = { ...batch, ...input, scheduleIssues: window.batchConflict ? ["Lesson 1 overlaps with Guitar, Batch 9, lesson 2 (28 Feb 2028, 15:00 – 16:00, Nepal time). Choose another time."] : [], lessons: input.lessons.map((lesson, position) => ({ id: position + 1, position, startsAt: new Date(`${lesson.date}T${lesson.time}:00+05:45`).toISOString(), durationMinutes: lesson.durationMinutes })) };
  return { batch: structuredClone(batch) };
}
export async function apiPost(url, input) {
  window.batchRequests.push({ method: "POST", url, input });
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (url.endsWith("/publish") && window.batchConflict) {
    const error = new ApiError("These lessons overlap. Choose another time.");
    error.data = { issues: batch.scheduleIssues };
    throw error;
  }
  if (url.endsWith("/publish")) {
    if (batch.format === "ongoing" && !batch.periodAnchorLocked) batch.tuitionPeriod = { groupId: 4, index: 0, startsAt: batch.lessons[0].startsAt, endsAt: new Date(Date.parse(batch.lessons[0].startsAt) + periodMs).toISOString() };
    batch = { ...batch, periodAnchorLocked: batch.format === "ongoing", status: "published", version: batch.version + 1, published: { ...(batch.format === "ongoing" ? { tuitionPeriod: structuredClone(batch.tuitionPeriod) } : {}), batchId: batch.id, programId: 1, programVersion: 1, programTitle: "Test Program", version: batch.version + 1, capacity: batch.capacity, totalTuitionNpr: batch.totalTuitionNpr, lessons: structuredClone(batch.lessons), timeZone: "Asia/Kathmandu", enrollmentClosesAt: batch.tuitionPeriod?.startsAt ?? batch.lessons[0].startsAt } };
  }
  else if (url.endsWith("/next-period")) {
    const period = { groupId: 4, index: 1, startsAt: batch.tuitionPeriod.endsAt, endsAt: new Date(Date.parse(batch.tuitionPeriod.endsAt) + periodMs).toISOString() };
    batch = { ...batch, id: 2, tuitionPeriod: period, lessons: [], status: "draft", version: 0, published: null };
    return { batch: structuredClone(batch), created: true };
  }
  else if (url.endsWith("/close")) batch = { ...batch, status: "closed" };
  else batch = { ...batch, id: 2, format: input?.format ?? "fixed", tuitionGroupId: input?.format === "ongoing" ? 5 : null, tuitionPeriod: null, periodAnchorLocked: false, status: "draft", capacity: null, totalTuitionNpr: null, lessons: [], version: 0, published: null };
  return { batch: structuredClone(batch) };
}
