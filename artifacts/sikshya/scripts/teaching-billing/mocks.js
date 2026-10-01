export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
const teacher = { role: "teacher", userId: 81, name: "Synthetic Teacher", approvalStatus: "approved", subscriptionActive: true, totalStudents: 999, monthlyEarnings: 999999 };
export const useAuth = () => ({ user: teacher, logout: async () => {} });
export const useNotifications = () => ({ unreadCount: 0, refresh: () => {} });
export class ApiError extends Error {}
export async function apiPatch() { throw new Error("No writes are allowed in this billing fixture"); }
export default function LegacyTeacherPlans() { return null; }
export async function apiGet(path) {
  window.billingReads = [...(window.billingReads || []), path];
  if (location.search.includes("failed")) throw new Error("Synthetic unavailable API");
  if (path.includes("/sessions?")) {
    if (path.includes("agenda=missed")) return { sessions: [], total: 2 };
    if (path.includes("agenda=upcoming")) return { sessions: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1, subject: "Mathematics", topic: `Synthetic lesson ${index + 1}`,
      date: new Date(Date.now() + (index + 1) * 86400000).toISOString(),
      duration: 60, maxStudents: 20, enrolledCount: 2, status: "upcoming", expired: false,
    })), total: 27 };
    throw new Error(`Unexpected schedule request: ${path}`);
  }
  if (path.startsWith("/batch-tests/me/payments") && location.search.includes("no-receipts")) return { receipts: [] };
  if (path.startsWith("/batch-tests/me/payments")) {
    const first = {
    bookingId: 1, batchId: 12, reference: "TEST-TEACH-1", classTitle: "SEE Maths", studentName: "Asha",
    recordedAt: "2026-09-12T00:00:00.000Z", grossNpr: 1000, fadkoNpr: 300, teacherNpr: 700,
    allocations: [{ position: 0, grossNpr: 1000, teacherNpr: 700, fadkoNpr: 300, state: "future" }],
    accounting: { heldGrossNpr: 1000, teacherPaidOutNpr: 0, fadkoEarnedNpr: 0, refundedGrossNpr: 0, actualMoneyMovedNpr: 0 },
    };
    const size = location.search.includes("paged") ? 55 : location.search.includes("many") ? 25 : 1;
    const cursor = Number(new URL(path, location.origin).searchParams.get("cursor") ?? "0");
    const matching = Array.from({ length: size }, (_, index) => ({ ...first, bookingId: index + 1, reference: `TEST-TEACH-${index + 1}`, classTitle: index % 2 ? "IELTS English" : "SEE Maths", studentName: size === 1 ? "Asha" : size === 55 && index === 0 ? "Oldest Student" : index === 14 ? "Special Student" : `Student ${index + 1}`, recordedAt: new Date(Date.parse(first.recordedAt) + index * 60_000).toISOString() })).reverse().filter((row) => !cursor || row.bookingId < cursor);
    const receipts = matching.slice(0, 50);
    return { receipts, nextCursor: matching.length > 50 ? receipts.at(-1).bookingId : null };
  }
  if (path !== "/teachers/me/billing") throw new Error(`Unexpected billing request: ${path}`);
  return {
    legacyPlanSalesOpen: location.search.includes("legacy-flag"),
    newClassCheckoutOpen: false, teacherShareBps: 7000, platformShareBps: 3000,
    studentFeeNpr: 0, status: "preparing",
    testPilotEndsAt: location.search.includes("practice") ? "2027-01-09T00:00:00.000Z" : null,
  };
}
