// Only the transport is synthetic. No requests or payment actions leave this browser.
export class ApiError extends Error {}
let item;
window.classRequests = [];
export async function apiGet(url) { return url === "/teaching-classes" ? { classes: window.classHomeFixtures ?? [], nextCursor: null } : { item: structuredClone(item) }; }
export async function apiPost(url, input) {
  window.classRequests.push({ url, input });
  await new Promise((r) => setTimeout(r, 100));
  if (window.failClassSave) throw new ApiError("Connection lost. Your entries are still here.");
  if (url.endsWith("/publish")) {
    item.batch.status = "published"; item.batch.version = 1; item.batch.currentProgramVersion = 1;
    item.publishedDescription = { title: item.title, summary: item.summary, teachingLanguage: item.teachingLanguage, outline: item.outline };
    item.batch.published = { batchId: 1, programId: 1, programVersion: 1, version: 1, capacity: item.batch.capacity, totalTuitionNpr: item.batch.totalTuitionNpr, lessons: structuredClone(item.batch.lessons) };
  } else {
    item = { title: input.title, summary: input.summary, teachingLanguage: input.teachingLanguage, outline: input.outline, programUpdatedAt: new Date().toISOString(), publishedDescription: null, batch: { id: 1, programId: 1, currentProgramVersion: 0, format: input.format, status: "draft", capacity: input.capacity, totalTuitionNpr: input.totalTuitionNpr, version: 0, published: null, updatedAt: new Date().toISOString(), lessons: input.lessons.map((lesson, position) => ({ position, startsAt: new Date(`${lesson.date}T${lesson.time}:00+05:45`).toISOString(), durationMinutes: lesson.durationMinutes })) } };
    if (input.format === "ongoing") { const start = item.batch.lessons[0].startsAt; item.batch.tuitionGroupId = 1; item.batch.tuitionPeriod = { groupId: 1, index: 0, startsAt: start, endsAt: new Date(Date.parse(start) + 30 * 86400000).toISOString() }; }
  }
  window.savedClassFixture = structuredClone(item);
  return { item: structuredClone(item), created: true };
}
export const apiPatch = apiPost;
