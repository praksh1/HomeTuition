export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
export default function LegacyTeacherPlans() { return null; }
export async function apiGet(path) {
  if (location.search.includes("failed")) throw new Error("Synthetic unavailable API");
  if (path === "/batch-tests/me/payments") return { receipts: [{
    bookingId: 1, batchId: 12, reference: "TEST-TEACH-1", classTitle: "SEE Maths", studentName: "Asha",
    recordedAt: "2026-09-12T00:00:00.000Z", grossNpr: 1000,
    allocations: [{ position: 0, teacherNpr: 700, state: "future" }],
    accounting: { heldGrossNpr: 1000, teacherPaidOutNpr: 0, fadkoEarnedNpr: 0, refundedGrossNpr: 0, actualMoneyMovedNpr: 0 },
  }] };
  return { legacyPlanSalesOpen: false, newClassCheckoutOpen: false, teacherShareBps: 7000, platformShareBps: 3000, studentFeeNpr: 0, status: "preparing" };
}
