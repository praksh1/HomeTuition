// Only the transport is synthetic. No requests or payment actions leave this browser.
export class ApiError extends Error {}
let item;
let createKey;
window.classRequests = [];
export async function apiGet(url) {
  if (url === "/teachers/me/billing") {
    if (new URLSearchParams(location.search).get("billing") === "fail" && !window.billingRecovered) throw new ApiError("Teaching terms unavailable");
    return { teacherShareBps: 7000 };
  }
  if (url.startsWith("/teaching-classes?")) {
    const params = new URL(url, location.origin).searchParams;
    window.lastClassSearch = url;
    return { classes: (window.classHomeFixtures ?? []).filter((item) => item.title.toLowerCase().includes((params.get("q") ?? "").toLowerCase()) && (!params.get("status") || item.batch.status === params.get("status"))), nextCursor: null };
  }
  if (!item) throw new ApiError("That class was not found.");
  return { item: structuredClone(item) };
}
export async function apiPost(url, input) {
  if (url.endsWith("/schedule-review")) {
    window.scheduleReviews = (window.scheduleReviews ?? 0) + 1;
    if (window.failScheduleReview) throw new ApiError("Could not check dates. Your entries are still here.");
    return { conflicts: (window.conflictFixtures ?? []).filter((c) => input.lessons[c.lessonIndex] && new Date(`${input.lessons[c.lessonIndex].date}T${input.lessons[c.lessonIndex].time}:00+05:45`).toISOString() === c.startsAt) };
  }
  window.classRequests.push({ url, input });
  await new Promise((r) => setTimeout(r, 100));
  if (window.failClassSave) throw new ApiError("Connection lost. Your entries are still here.");
  if (url === "/teaching-classes" && item && createKey === input.requestKey)
    return { item: structuredClone(item), created: false };
  if (url.endsWith("/publish")) {
    item.batch.status = "published"; item.batch.version = 1; item.batch.currentProgramVersion = 1;
    item.publishedDescription = { title: item.title, summary: item.summary, teachingLanguage: item.teachingLanguage, outline: item.outline };
    item.batch.published = { batchId: 1, programId: 1, programVersion: 1, version: 1, capacity: item.batch.capacity, totalTuitionNpr: item.batch.totalTuitionNpr, lessons: structuredClone(item.batch.lessons) };
  } else {
    if (url === "/teaching-classes") createKey = input.requestKey;
    item = { title: input.title, summary: input.summary, teachingLanguage: input.teachingLanguage, outline: input.outline, programUpdatedAt: new Date().toISOString(), publishedDescription: null, batch: { id: 1, programId: 1, currentProgramVersion: 0, format: input.format, status: "draft", capacity: input.capacity, totalTuitionNpr: input.totalTuitionNpr, version: 0, published: null, updatedAt: new Date().toISOString(), lessons: input.lessons.map((lesson, position) => ({ position, startsAt: new Date(`${lesson.date}T${lesson.time}:00+05:45`).toISOString(), durationMinutes: lesson.durationMinutes })) } };
    if (input.format === "ongoing") { const start = item.batch.lessons[0].startsAt; item.batch.tuitionGroupId = 1; item.batch.tuitionPeriod = { groupId: 1, index: 0, startsAt: start, endsAt: new Date(Date.parse(start) + 30 * 86400000).toISOString() }; }
  }
  if (!url.endsWith("/publish")) item.batch.allowLateJoining = input.allowLateJoining === true;
  else item.batch.published.allowLateJoining = item.batch.allowLateJoining;
  if (window.conflictFixtures) item.batch.scheduleConflicts = structuredClone(window.conflictFixtures);
  window.savedClassFixture = structuredClone(item);
  if (url.endsWith("/publish") && window.failPublishReply) {
    window.failPublishReply = false;
    throw new ApiError("The connection ended before publication was confirmed.");
  }
  if (url === "/teaching-classes" && window.failCreateReply) {
    window.failCreateReply = false;
    throw new ApiError("The connection ended before the draft was confirmed.");
  }
  return { item: structuredClone(item), created: true };
}
export const apiPatch = apiPost;
export async function apiDelete(url) {
  window.classRequests.push({ url, method: "DELETE" });
  if (!item || !url.endsWith(`/${item.batch.id}`)) throw new ApiError("That class was not found.");
  if (item.batch.status !== "draft" || item.batch.published) throw new ApiError("Only an unpublished class with no past offer can be deleted.");
  item = undefined;
  createKey = undefined;
  return { deleted: true };
}
