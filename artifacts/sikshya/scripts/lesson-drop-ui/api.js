const quote = {
  enrolled: true, canDrop: true, reason: null, pricePaid: 501,
  studentRefund: 251, teacherShare: 125, platformShare: 125,
  full: false, known: true, headline: "Synthetic single-lesson cancellation quote.",
  detail: "Synthetic server quote, not a real booking.", deadlineHours: 24,
};
const linked = {
  // Exact sparse response returned by the batch allocation branch in drops.ts.
  enrolled: true, canDrop: false, originalSessionId: 451,
  bookingId: 801, position: 3,
  reason: "This lesson belongs to your class purchase. Request make-up or refund review from the lesson's Help options; its original payment allocation stays linked.",
};
const fixtures = {
  linked,
  "linked-first": { ...linked, position: 0 },
  "linked-zero-fields": { ...linked, pricePaid: 0, studentRefund: 0 },
  quote,
  full: { ...quote, full: true, studentRefund: 501, teacherShare: 0, platformShare: 0 },
  blocked: { ...quote, canDrop: false, reason: "The cancellation deadline has passed." },
  left: { enrolled: false, canDrop: false, left: true, refundAmount: 251, refundPaid: false, businessDaysLeft: 3, headline: "You left this lesson.", detail: "Your refund is requested." },
  "left-no-amount": { enrolled: false, canDrop: false, left: true, refundAmount: null, headline: "You left this lesson.", detail: "No confirmed refund quote is available." },
  "not-enrolled": { enrolled: false, canDrop: false, reason: "You are not booked." },
  "missing-quote": { enrolled: true, canDrop: true, reason: "No confirmed quote is available." },
  "null-price": { ...quote, pricePaid: null },
  "string-price": { ...quote, pricePaid: "501" },
  "negative-refund": { ...quote, studentRefund: -1 },
  "too-large-refund": { ...quote, studentRefund: 502 },
  "missing-teacher-share": { ...quote, teacherShare: undefined },
  "unknown-quote": { ...quote, known: false, canDrop: false },
  "fetch-failure": null,
};
window.__dropFixtureRequests = [];
export async function apiGet(path) {
  window.__dropFixtureRequests.push({ method: "GET", path });
  const scenario = new URLSearchParams(location.search).get("case") || "linked";
  await new Promise(resolve => setTimeout(resolve, 25));
  if (scenario === "fetch-failure") throw new Error("Synthetic read failure");
  return fixtures[scenario];
}
export async function apiPost(path) {
  window.__dropFixtureRequests.push({ method: "POST", path });
  throw new Error("All mutations are denied by this synthetic fixture");
}
