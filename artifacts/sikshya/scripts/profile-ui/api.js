const onboarding = { phone: "+977 9800000000", province: "Bagmati Province", district: "Kathmandu", localLevel: "Kathmandu Metropolitan City", locality: "Baneshwor", institutionName: null, affiliationStatus: "independent", profilePhotoKey: null };
export async function apiGet(path) {
  if (path === "/onboarding/me") return { onboarding };
  if (path === "/teachers/me/credentials") return { credentials: [{ id: 1, documentType: "citizenship", originalName: "citizenship.pdf", fileKey: "fixture", contentType: "application/pdf", status: "approved", rejectionReason: null, createdAt: "2026-09-01" }] };
  if (path === "/locations/nepal") return { provinces: [{ name: "Bagmati Province", districts: [{ name: "Kathmandu", localLevels: ["Kathmandu Metropolitan City", "Kirtipur Municipality"] }] }, { name: "Koshi Province", districts: [{ name: "Morang", localLevels: ["Biratnagar Metropolitan City"] }] }] };
  if (path.startsWith("/locations/nepal/facilities")) return { facilities: [] };
  throw new Error(`Unexpected GET ${path}`);
}
export async function apiPatch() { return {}; }
export async function apiPost() { return {}; }
export async function apiDelete() { return {}; }
