import type { SupportIntent } from "./supportAssistant";

/** Versioned editorial drafts, not automatically published policy. No provider calls. */
export const SUPPORT_STARTER_VERSION = "2026-09-24-v1";
export interface SupportStarterArticle {
  slug: string; title: string; intent: SupportIntent; keywords: string[]; answer: string;
  sources: string[]; reviewCheck: string;
}
export const SUPPORT_STARTER_ARTICLES: readonly SupportStarterArticle[] = [
  { slug: "fadko-find-lesson", title: "Find my lesson and its dates", intent: "class_access", keywords: ["lesson dates", "schedule", "find my class", "where is my class"],
    answer: "Open Classes, choose your class, then check Schedule. Open the lesson for its date and joining status. If the class is missing, check that you signed in with the student account used to enroll. Tell me the class name and what you see; please do not book or pay again just to test it.",
    sources: ["artifacts/sikshya/app/class-home.tsx"], reviewCheck: "As a student, open Classes and check a booked class's Schedule." },
  { slug: "fadko-camera-microphone", title: "Camera or microphone is unavailable", intent: "class_access", keywords: ["camera", "microphone", "no sound", "cannot hear"],
    answer: "Check the call's microphone and camera controls. If the class says you are muted by the teacher, ask for permission using Raise hand; browser permission does not override teacher permission. Otherwise check your browser or phone's camera/microphone permission for Fadko. Which device and browser are you using, and what status is shown? Do not end the whole class to troubleshoot a device.",
    sources: ["artifacts/sikshya/components/LiveKitEmbed.web.tsx"], reviewCheck: "Check student controls both before and after the teacher allows the microphone." },
  { slug: "fadko-whiteboard-file", title: "A whiteboard PDF or image is missing", intent: "class_access", keywords: ["whiteboard", "pdf", "image missing", "blank board"],
    answer: "Please tell me whether the teacher can see the material and whether all students or only you are affected. Keep the original file and avoid repeatedly importing it while a load is in progress. Note the lesson, page number, device/browser, and approximate time. This chat cannot see your board or inspect an uploaded file unless a supported evidence workflow explicitly says so.",
    sources: ["artifacts/sikshya/components/SmartBoard.web.tsx"], reviewCheck: "Verify PDF loading and reconnect behavior; do not promise that every file type is supported." },
  { slug: "fadko-test-payment", title: "What does a test checkout mean?", intent: "billing", keywords: ["test checkout", "simulated payment", "test payment", "no money"],
    answer: "A checkout marked test or simulated is a rehearsal, not a real-money charge. Its displayed course and lesson amounts illustrate the purchase. A simulated refund or payout is not a bank transfer. If your bank or wallet shows a real charge, ask a person to compare the records; do not assume it belongs to the test checkout.",
    sources: ["artifacts/api-server/src/lib/batchTestPayment.ts", "artifacts/api-server/src/lib/payments.ts"], reviewCheck: "Compare a test receipt with Payments & receipts; keep simulated amounts clearly labeled." },
  { slug: "fadko-payment-history", title: "Find a payment or refund record", intent: "billing", keywords: ["payment history", "receipt", "refund status", "charged twice"],
    answer: "Open Profile → Payments & receipts and find the course or lesson. Note its date, amount and displayed status. A recorded request or refund owed does not mean money has reached your bank or wallet. If the record differs from your payment provider, ask a person to review it. Never share a full card/account number, password or verification code here.",
    sources: ["artifacts/sikshya/app/(student)/payments.tsx", "lib/db/src/schema/refunds.ts"], reviewCheck: "Check the student history labels; do not promise settlement from an app status alone." },
  { slug: "fadko-refund-destination", title: "Request a refund or report a changed payment method", intent: "billing", keywords: ["refund request", "refund method", "changed bank", "original payment"],
    answer: "Tell me which class or lesson is involved and what happened. Fadko Support must review the evidence before deciding a refund; the AI cannot approve or send money. Any approved refund follows the original payment method. If your details or payment method have changed, contact customer service—do not send replacement bank details in this chat. No refund date or eligibility is promised here.",
    sources: [".agents/memory/profile-contact-location-and-refunds.md"], reviewCheck: "Confirm the original-payment-method rule and human-only decision remain current." },
  { slug: "fadko-message-delivery", title: "A message or notification is missing", intent: "messaging", keywords: ["message missing", "message not showing", "notifications", "unread"],
    answer: "Open Messages and select the relevant class or direct conversation. Check whether the message itself is present before relying on the notification badge. If it is stuck sending, keep the draft and avoid repeated sends. Tell me which conversation type, device/browser and approximate time are affected. Please leave out unrelated private message content.",
    sources: ["artifacts/sikshya/app/(student)/messages.tsx", "artifacts/api-server/src/routes/notifications.ts"], reviewCheck: "Test the current Messages entry point and read/unread behavior on two devices." },
  { slug: "fadko-homework-feedback", title: "Find submitted homework and feedback", intent: "homework", keywords: ["homework feedback", "assignment", "submitted work", "hand in"],
    answer: "Open Classes, choose the class, then Homework. Open the assignment to check your submitted work and any feedback the teacher has returned. If an upload failed, keep the original file. Tell me the class, assignment, and whether the issue is uploading, opening a file or seeing feedback; do not post another student's work.",
    sources: ["artifacts/sikshya/app/class-homework.tsx"], reviewCheck: "Verify an assigned, submitted and feedback-returned assignment using synthetic accounts." },
  { slug: "fadko-profile-details", title: "Update account and location details", intent: "account", keywords: ["profile details", "phone number", "province", "district", "municipality"],
    answer: "Open Profile → Edit account details. Enter your own contact and location information; don't accept details that do not belong to you. Province and District use valid listed choices. If Municipality or School is not listed, use the available not-listed/manual option; choose Not applicable for school when appropriate. If Save highlights a field, correct that field. Never share your password or verification code.",
    sources: ["artifacts/sikshya/app/onboarding.tsx"], reviewCheck: "Check independent phone/location input, manual locality and school choices on phone and laptop." },
  { slug: "fadko-report-safety", title: "Report bullying, abuse or unsafe class content", intent: "safety", keywords: ["bullying", "harassment", "unsafe", "report abuse"],
    answer: "You do not need to confront the person or remain in an unsafe class. Ask a person in Fadko Support and identify the class/conversation and approximate time. Preserve evidence you already have and attach it through the support form; avoid sharing unrelated people's personal details. A human reviews the report and decides any account action. This assistant has not watched recordings or verified an allegation. If there is immediate danger, seek local emergency assistance.",
    sources: ["artifacts/api-server/src/lib/supportAssistant.ts"], reviewCheck: "Verify a report is not treated as abuse by the reporter and human help stays available." },
];
export function starterReviewFor(slug: string, answer: string) {
  const article = SUPPORT_STARTER_ARTICLES.find((item) => item.slug === slug && item.answer === answer);
  return article ? { version: SUPPORT_STARTER_VERSION, sources: article.sources, check: article.reviewCheck } : null;
}
