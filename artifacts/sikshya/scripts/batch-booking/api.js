const teacher = () => location.search.includes("teacher");
export class ApiError extends Error {}
const result = () => ({ testOnly: true, paymentCollectedNpr: 0, isTeacher: teacher(), booked: false,
  quoteKey: "a".repeat(64), quote: { status: "full_offer", remainingLessonCount: 2, amountNpr: 6000 }, offerLessons: [{ position: 0, startsAt: "2026-10-01T10:15:00Z", durationMinutes: 60 }], lessons: [], receipts: [] });
const operatorStates = ["future", "future"];
const operatorHistory = [];
const transition = { future: { lesson_delivered: "delivered_pending", lesson_cancelled: "replacement_pending" },
  replacement_pending: { replacement_scheduled: "future", refund_approved: "refund_owed" },
  delivered_pending: { complaint_opened: "disputed", complaint_window_closed: "eligible" },
  disputed: { complaint_upheld: "refund_owed", complaint_denied: "eligible" },
  eligible: { complaint_opened: "disputed", payout_confirmed: "paid_out" },
  refund_owed: { refund_confirmed: "refunded" } };
function operatorReceipt() {
  const allocations = operatorStates.map((state, position) => ({ position, state, grossNpr: 3000, teacherNpr: 2100, fadkoNpr: 900 }));
  const rows = (state) => allocations.filter((allocation) => allocation.state === state);
  const held = allocations.filter((allocation) => !["paid_out", "refunded"].includes(allocation.state));
  const sum = (values, key) => values.reduce((total, row) => total + row[key], 0);
  return { bookingId: 1, reference: "TEST-BATCH-1", classTitle: "Synthetic SEE Maths", studentName: "Synthetic Student",
    recordedAt: "2026-10-01T10:15:00Z", grossNpr: 6000, teacherNpr: 4200, fadkoNpr: 1800, allocations,
    history: operatorHistory, accounting: { heldGrossNpr: sum(held, "grossNpr"), teacherPaidOutNpr: sum(rows("paid_out"), "teacherNpr"),
      fadkoEarnedNpr: sum(rows("paid_out"), "fadkoNpr"), refundedGrossNpr: sum(rows("refunded"), "grossNpr"), actualMoneyMovedNpr: 0 } };
}
export async function apiGet(path) {
  if (path === "/admin/batch-test-payments") return { receipts: [operatorReceipt()] };
  if (location.search.includes("unavailable")) throw new Error("An operator must enable your student test access first.");
  return result();
}
export async function apiPost(path, body) {
  window.bookingRequests = (window.bookingRequests ?? 0) + 1;
  window.bookingPayload = { path, body };
  await new Promise((r) => setTimeout(r, 200));
  const ledger = path.match(/^\/admin\/batch-test-payments\/1\/allocations\/(\d+)\/events$/);
  if (ledger) {
    const position = Number(ledger[1]);
    const from = operatorStates[position];
    const to = transition[from]?.[body.event];
    if (!to) throw new Error("That rehearsal action is not valid now.");
    operatorStates[position] = to;
    operatorHistory.push({ id: operatorHistory.length + 1, allocationId: null, position, event: body.event,
      detail: { note: body.note || null, paymentMoved: false }, createdAt: new Date(Date.UTC(2026, 9, 1, 10, 16 + operatorHistory.length)).toISOString() });
    return { notice: "TEST ONLY — no money moved." };
  }
  if (location.search.includes("stale")) throw new Error("The dates or price changed. Review the current details before confirming.");
  if (body.outcome === "declined") throw new Error("Test payment declined. No money moved and no place was booked. You can try again.");
  return { ...result(), booked: true, receipts: [{ reference: "TEST-BATCH-1", grossNpr: 6000, teacherNpr: 4200, fadkoNpr: 1800, allocations: [{ position: 0, grossNpr: 3000, teacherNpr: 2100, fadkoNpr: 900 }, { position: 1, grossNpr: 3000, teacherNpr: 2100, fadkoNpr: 900 }] }], lessons: [{ position: 0, sessionId: 125, startsAt: "2026-10-01T10:15:00Z", durationMinutes: 60 }] };
}
