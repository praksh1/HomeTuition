import assert from "node:assert/strict";
import { test } from "node:test";
import { explainSupportPayment, type SupportPaymentInput } from "./supportPaymentEvidence.ts";
const base: SupportPaymentInput = { enrollmentId: 9, status: "paid", method: "khalti", reference: "private-provider-reference", refunds: [] };
test("recorded payment is not claimed to be provider settlement; private references stay private", () => {
  const text = explainSupportPayment(base).join(" ");
  assert.match(text, /not been independently checked/);
  assert.match(text, /original payment method/);
  assert.doesNotMatch(text, /private-provider-reference/);
  assert.match(text, /does not prove/);
});
test("legacy SIM receipts remain simulated even when the enrollment says paid", () => {
  assert.match(explainSupportPayment({ ...base, reference: "SIM-123-5-8" }).join(" "), /not a real-money charge/);
});
test("test course totals and lesson allocation are clearly separate and omit platform shares", () => {
  const text = explainSupportPayment({ ...base, status: "test", batch: { bookingId: 3, position: 1, receipt: {
    mode: "simulation", currency: "NPR", actualMoneyCollectedNpr: 0, grossNpr: 2000, fadkoNpr: 600,
    allocations: [{ position: 0, grossNpr: 1000 }, { position: 1, grossNpr: 1000 }],
  } } }).join(" ");
  assert.match(text, /NPR 2,000 simulated course total; NPR 1,000/);
  assert.match(text, /Actual money collected: NPR 0/);
  assert.doesNotMatch(text, /600|fadkoNpr|held by/i);
});
test("malformed or unmatched receipt never guesses an amount", () => {
  for (const receipt of [null, {}, { mode: "simulation", currency: "NPR", grossNpr: 999, allocations: [{ position: 55, grossNpr: 999 }] }]) {
    const text = explainSupportPayment({ ...base, batch: { bookingId: 3, position: 1, receipt } }).join(" ");
    assert.match(text, /could not be safely matched/);
    assert.doesNotMatch(text, /NPR 999/);
  }
});
test("refund owed and manually marked paid stay distinct; test refunds never claim real money returned", () => {
  const refund = { id: 4, amount: 500, status: "owed", requestedAt: new Date("2026-09-24T00:00:00Z"), paidAt: null };
  assert.match(explainSupportPayment({ ...base, refunds: [refund] }).join(" "), /owed, not paid/);
  assert.match(explainSupportPayment({ ...base, refunds: [{ ...refund, status: "paid" }] }).join(" "), /not independently confirmed/);
  assert.match(explainSupportPayment({ ...base, status: "test", refunds: [{ ...refund, status: "paid" }] }).join(" "), /not proof of real money returned/);
});
