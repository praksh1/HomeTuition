const completeOnboarding = { phone: "+977 9800000000", province: "Bagmati Province", district: "Kathmandu", localLevel: "Kathmandu Metropolitan City", locality: "Baneshwor", institutionName: null, affiliationStatus: "independent", profilePhotoKey: null };
const incompleteLegacyOnboarding = { ...completeOnboarding, phone: null };
const syntheticLegacyOnboarding = { phone: "9801234567", province: "Bagmati", district: "Kathmandu", localLevel: "Kathmandu", locality: "Synthetic staging fixture", institutionName: "Synthetic Staging School", affiliationStatus: "not_specified", profilePhotoKey: null };
let libraryArticles = [];
let syntheticHold = { id: 77, userId: 2, version: 0, active: false, caseId: null, reviewDueAt: null, overdue: false, documentDeleted: false, detailsDeleted: false };
export class ApiError extends Error { constructor(status, message, data = {}) { super(message); this.status = status; this.data = data; } }
export async function apiGet(path) {
  if (path === "/onboarding/me/profile-photo/view") {
    window.photoViewReads = (window.photoViewReads ?? 0) + 1;
    if (window.failPhotoView) throw new Error("Synthetic photo refresh failure");
    const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lD8AAAAASUVORK5CYII=";
    if (window.deferNextPhotoView) {
      window.deferNextPhotoView = false;
      // Resolve only when the test releases the already-started request. The old URL must
      // not replace the freshly committed photo when responses arrive out of order.
      return await new Promise(resolve => {
        window.releaseDeferredPhotoView = () => {
          window.deferredPhotoResolved = true;
          resolve({ url: `${photo}#stale-before-save` });
        };
      });
    }
    return { url: window.photoViewUrl ?? photo };
  }
  if (path === '/account-closure') return { request: null };
  if (path === '/account-closure-review') return { items: [{userId:2,name:'Synthetic closure student',role:'student',version:0,requestedAt:'2026-09-27'}], nextCursor:null };
  if (path === '/account-closure-review/2') {
    const ready=new URLSearchParams(window.location.search).has('closure-ready');
    return {request:{status:'requested',version:3},pendingMedia:0,commitments:{upcomingLessons:ready?0:2,pendingPayments:ready?0:1,openDisputes:ready?0:1,pendingMakeups:0,complete:ready},blockers:ready?[]:['review_unavailable'],completionAvailable:ready};
  }
  if (path === "/identity-review/holds") return { items: syntheticHold.active ? [syntheticHold] : [], nextCursor: null };
  if (path === "/identity-review/77/hold") return { hold: syntheticHold };
  if (path === "/identity-review/retention-health") return { enabled: false, healthy: false };
  if (path === "/identity-review") {
    if (new URLSearchParams(window.location.search).has("denied")) throw new ApiError(403, "You do not have identity-review access.");
    return { items: [{ id: 77, userId: 2, holder: "parent", createdAt: "2026-09-26" }], nextCursor: null };
  }
  if (path === "/identity-verification/me") {
    window.identityStatusReads = (window.identityStatusReads ?? 0) + 1;
    const state = new URLSearchParams(window.location.search).get("identity") ?? "disabled";
    if (state === "failure") throw new Error("Synthetic status failure");
    return { enabled: state !== "disabled", available: true, verification: ["submitted", "approved", "rejected"].includes(state) ? { id: 77, status: state, holder: "self", rejectionCode: state === "rejected" ? "unreadable" : null } : null };
  }
  if (path === "/admin/support/articles") return { articles: libraryArticles };
  if (path === "/support/assistant/lessons") return { lessons: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, topic: `Lesson ${i + 1}`, date: "2026-09-24" })) };
  if (path === "/support/assistant/conversations") return { conversations: [{ id: 9, title: "Earlier class question", ticketId: null }] };
  if (path === "/support/assistant/conversations/9") return { messages: [
    { id: 91, role: "user", body: "Earlier class question", source: "user" },
    { id: 92, role: "assistant", body: "Earlier answer", source: "local" },
  ], suggestedReplies: [] };
  if (path === "/onboarding/me") {
    const profile = new URLSearchParams(window.location.search).get("profile");
    if (profile === "load-error" && !window.retryAccountLoad) throw new Error("Synthetic account fetch failure");
    return { onboarding: profile === "incomplete" ? incompleteLegacyOnboarding : profile === "fixture" ? syntheticLegacyOnboarding : completeOnboarding };
  }
  if (path === "/teachers/me/credentials") return { credentials: [{ id: 1, documentType: "citizenship", originalName: "citizenship.pdf", fileKey: "fixture", contentType: "application/pdf", status: "approved", rejectionReason: null, createdAt: "2026-09-01" }] };
  if (path === "/locations/nepal") return { provinces: [{ name: "Bagmati Province", districts: [{ name: "Kathmandu", localLevels: ["Kathmandu Metropolitan City", "Kirtipur Municipality"] }] }, { name: "Koshi Province", districts: [{ name: "Morang", localLevels: ["Biratnagar Metropolitan City"] }] }] };
  if (path.startsWith("/locations/nepal/facilities")) return { facilities: [] };
  throw new Error(`Unexpected GET ${path}`);
}
export async function apiPatch(path, body) { window.lastSavedAccount = { path, body }; return {}; }
export async function apiPost(path, body) {
  if(path==='/account-closure-review/2/complete'){window.closureCompleted=body;return {closed:true,pendingMedia:1};}
  if (path === '/account-closure') { window.closureRequested=body; return {request:{status:'requested',version:0}}; }
  if (path === '/account-closure/cancel') { window.closureCancelled=body; return {cancelled:true}; }
  if (path === "/identity-review/77/hold") {
    if (new URLSearchParams(window.location.search).has("stale")) throw new ApiError(409, "This hold changed. Reload the record before deciding.");
    window.identityHoldMutation = body;
    syntheticHold = { ...syntheticHold, version: syntheticHold.version + 1, active: body.action !== "release", caseId: body.action === "release" ? null : body.caseId, reviewDueAt: body.action === "release" ? null : "2026-12-25T12:00:00Z" };
    return { hold: syntheticHold };
  }
  if (path === "/identity-review/77/open") return { verification: { id: 77, status: "submitted", holder: "parent" }, details: { legalName: "Synthetic Parent Fixture", documentNumber: "TEST-ONLY", dateOfBirth: "1990-01-01", issuingDistrict: "Kathmandu", issuingMunicipality: "Kathmandu", parentRelationship: "Parent", consent: true } };
  if (path === "/identity-review/77/decision") { window.identityDecision = body; return {}; }
  if (path === "/identity-verification/prepare") { window.identityPreparationCount = (window.identityPreparationCount ?? 0) + 1; window.identityPrepared = body; return { id: 77 }; }
  if (path === "/onboarding/me/profile-photo") {
    window.photoUploadAttempts = (window.photoUploadAttempts ?? 0) + 1;
    if (window.failPhotoUpload) throw new Error("Synthetic photo save failure");
    window.photoUploaded = body.fileKey; return {};
  }
  if (path === "/admin/support/articles/starter-drafts") {
    if (libraryArticles.length) return { created: 0 };
    libraryArticles = [{ id: 1, slug: "starter-payment", title: "Starter payment guide", answer: "A test checkout does not move real money.", intent: "billing", keywords: ["payment"], status: "draft", starterReview: { version: "2026-09-24-v1", check: "Compare the test receipt with Payments & receipts before publishing.", sources: [] } }];
    return { created: 1 };
  }
  if (path === "/support/assistant/messages" && body.sessionId) return {
    conversationId: 31,
    question: { id: 1, role: "user", body: body.message, source: "user" },
    reply: { id: 2, role: "assistant", body: "Which device are you using?", source: "local" },
    caseContext: { sessionId: body.sessionId, title: `Lesson ${body.sessionId}`, facts: ["Your enrollment record: test. No real payment is established.", ...Array.from({ length: 12 }, (_, i) => `Refund record #${i + 1}: NPR 250, linked to a test/simulated enrollment; not proof of real money returned. Recorded 2026-09-24 (UTC).`)] },
  };
  if (path === "/support/assistant/messages" && body.message === "I cannot join my class or lesson.") return {
    conversationId: 31,
    question: { id: 3, role: "user", body: body.message, source: "user" },
    reply: { id: 4, role: "assistant", body: "Which of these is closest to your question?", source: "handoff" },
    suggestedReplies: [
      { label: "Can't join a lesson", question: "I cannot join a lesson I booked. What should I check?" },
      { label: "Camera or sound", question: "My camera or sound is not working in a lesson." },
    ],
  };
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
export async function apiPut() { return {}; }
export async function identityReviewDocument() {
  if (new URLSearchParams(window.location.search).has("pdf")) return (await fetch("/synthetic-pages.pdf")).blob();
  if (new URLSearchParams(window.location.search).has("broken")) return new Blob(["invalid image fixture"], { type: "image/png" });
  // A plain one-pixel image, never a fabricated citizenship card.
  return new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), char => char.charCodeAt(0))], { type: "image/png" });
}
