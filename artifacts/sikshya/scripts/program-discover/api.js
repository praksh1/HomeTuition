export class ApiError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

// TeacherFinder deliberately talks to a bounded public directory. Keep the fixture explicit so
// an unexpected endpoint still fails instead of turning into synthetic success.
export async function apiGet(path) {
  globalThis.__apiPaths = [...(globalThis.__apiPaths || []), path];
  if (path === "/batch-tests/99" && globalThis.__batchEnrollmentFixture) {
    if (globalThis.__batchEnrollmentFixture === "unavailable") throw new Error("Synthetic enrollment lookup unavailable");
    const booked = globalThis.__batchEnrollmentFixture === "enrolled";
    return {
      testOnly: true, paymentCollectedNpr: 0, isTeacher: false, booked,
      quoteKey: "a".repeat(64), quote: { status: "remaining_lessons", remainingLessonCount: 2, amountNpr: 600 },
      offerLessons: [{ position: 7, startsAt: "2026-10-08T10:00:00Z", durationMinutes: 60 }],
      lessons: booked ? [{ position: 7, sessionId: 125, startsAt: "2026-10-08T10:00:00Z", durationMinutes: 60 }, { position: 8, sessionId: 126, startsAt: "2026-10-09T10:00:00Z", durationMinutes: 60 }] : [],
      receipts: booked ? [{ reference: "TEST-BATCH-1", grossNpr: 600, allocations: [{ position: 7, grossNpr: 300 }, { position: 8, grossNpr: 300 }] }] : [],
    };
  }
  if (path.startsWith("/teachers?")) return {
    teachers: [{
      id: 42, userId: 1042, name: "Anjali Rai", subject: "Mathematics",
      subjects: ["Mathematics", "Science"], bio: "SEE preparation with worked examples.",
      approvalStatus: "approved", rating: 0, reviewCount: 0,
      province: "Bagmati Province", district: "Kathmandu", localLevel: "Kathmandu Metropolitan City",
      institutionName: "Janajyoti Secondary School", affiliationStatus: "affiliated",
    }],
    total: 37, page: 1, limit: 12,
  };
  if (path.startsWith("/locations/nepal/facilities?")) return {
    facilities: [{ name: "Janajyoti Secondary School", nepaliName: null, type: "School", localLevel: "Kathmandu Metropolitan City" }],
  };
  if (path === "/locations/nepal") return {
    provinces: [{ name: "Bagmati Province", districts: [{ name: "Kathmandu", localLevels: ["Kathmandu Metropolitan City"] }] }],
  };
  throw new Error(`Unexpected API request in discovery rendering fixture: ${path}`);
}
export async function apiPost() { throw new Error("Unexpected API write in discovery rendering fixture"); }
