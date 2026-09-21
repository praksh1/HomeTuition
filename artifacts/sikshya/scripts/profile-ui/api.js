const completeOnboarding = { phone: "+977 9800000000", province: "Bagmati Province", district: "Kathmandu", localLevel: "Kathmandu Metropolitan City", locality: "Baneshwor", institutionName: null, affiliationStatus: "independent", profilePhotoKey: null };
const incompleteLegacyOnboarding = { ...completeOnboarding, phone: null };
const syntheticLegacyOnboarding = { phone: "9801234567", province: "Bagmati", district: "Kathmandu", localLevel: "Kathmandu", locality: "Synthetic staging fixture", institutionName: "Synthetic Staging School", affiliationStatus: "not_specified", profilePhotoKey: null };
export async function apiGet(path) {
  if (path === "/support/assistant/conversations") return { conversations: [] };
  if (path === "/onboarding/me") {
    const profile = new URLSearchParams(window.location.search).get("profile");
    return { onboarding: profile === "incomplete" ? incompleteLegacyOnboarding : profile === "fixture" ? syntheticLegacyOnboarding : completeOnboarding };
  }
  if (path === "/teachers/me/credentials") return { credentials: [{ id: 1, documentType: "citizenship", originalName: "citizenship.pdf", fileKey: "fixture", contentType: "application/pdf", status: "approved", rejectionReason: null, createdAt: "2026-09-01" }] };
  if (path === "/locations/nepal") return { provinces: [{ name: "Bagmati Province", districts: [{ name: "Kathmandu", localLevels: ["Kathmandu Metropolitan City", "Kirtipur Municipality"] }] }, { name: "Koshi Province", districts: [{ name: "Morang", localLevels: ["Biratnagar Metropolitan City"] }] }] };
  if (path.startsWith("/locations/nepal/facilities")) return { facilities: [] };
  throw new Error(`Unexpected GET ${path}`);
}
export async function apiPatch() { return {}; }
export async function apiPost(path, body) {
  if (path === "/support/assistant/messages") return {
    conversationId: 31,
    question: { id: 1, role: "user", body: body.message, source: "user" },
    reply: { id: 2, role: "assistant", body: "Open Sessions and choose your lesson.", source: "faq" },
    article: { title: "Joining a booked class" },
  };
  if (path === "/support/assistant/conversations/31/request") return { ticketId: 17, ref: "FDK-17" };
  return {};
}
export async function apiDelete() { return {}; }
