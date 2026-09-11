export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
export default function LegacyTeacherPlans() { return null; }
export async function apiGet() {
  if (location.search.includes("failed")) throw new Error("Synthetic unavailable API");
  return { legacyPlanSalesOpen: false, newClassCheckoutOpen: false, teacherShareBps: 7000, platformShareBps: 3000, studentFeeNpr: 0, status: "preparing" };
}
