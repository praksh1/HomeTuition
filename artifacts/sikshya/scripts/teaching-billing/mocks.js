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
  if (path === "/batch-tests/me/payments" && location.search.includes("no-receipts")) return { receipts: [] };
  if (path === "/batch-tests/me/payments") return { receipts: [{
    bookingId: 1, batchId: 12, reference: "TEST-TEACH-1", classTitle: "SEE Maths", studentName: "Asha",
    recordedAt: "2026-09-12T00:00:00.000Z", grossNpr: 1000,
    allocations: [{ position: 0, teacherNpr: 700, state: "future" }],
    accounting: { heldGrossNpr: 1000, teacherPaidOutNpr: 0, fadkoEarnedNpr: 0, refundedGrossNpr: 0, actualMoneyMovedNpr: 0 },
  }] };
  if (path !== "/teachers/me/billing") throw new Error(`Unexpected billing request: ${path}`);
  return {
    legacyPlanSalesOpen: location.search.includes("legacy-flag"),
    newClassCheckoutOpen: false, teacherShareBps: 7000, platformShareBps: 3000,
    studentFeeNpr: 0, status: "preparing",
    testPilotEndsAt: location.search.includes("practice") ? "2027-01-09T00:00:00.000Z" : null,
  };
}
