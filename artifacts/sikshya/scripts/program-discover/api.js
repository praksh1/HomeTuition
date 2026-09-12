export class ApiError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

// TeacherFinder deliberately talks to a bounded public directory. Keep the fixture explicit so
// an unexpected endpoint still fails instead of turning into synthetic success.
export async function apiGet(path) {
  globalThis.__apiPaths = [...(globalThis.__apiPaths || []), path];
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
