import assert from "node:assert/strict";
import test from "node:test";
import { hasDropQuote, isLinkedDropLesson, type DropInfo } from "./dropClassView.ts";

const linked: DropInfo = {
  enrolled: true, canDrop: false, originalSessionId: 451, bookingId: 801, position: 3,
  reason: "This lesson belongs to your class purchase.",
};
const quote: DropInfo = {
  enrolled: true, canDrop: true, pricePaid: 501, studentRefund: 251,
  teacherShare: 125, platformShare: 125, full: false, known: true,
  headline: "Confirmed server quote", detail: "Synthetic quote", deadlineHours: 24,
};

test("real sparse batch response is linked, never a legacy cancellation quote", () => {
  assert.equal(isLinkedDropLesson(linked), true);
  assert.equal(isLinkedDropLesson({ ...linked, position: 0 }), true);
  assert.equal(hasDropQuote(linked), false);
  assert.equal(hasDropQuote({ ...linked, pricePaid: 0, studentRefund: 0 }), false);
});
test("complete full and partial quotes preserve exact server values", () => {
  assert.equal(hasDropQuote(quote), true);
  assert.equal(hasDropQuote({ ...quote, studentRefund: 501, teacherShare: 0, platformShare: 0, full: true }), true);
  assert.equal(hasDropQuote({ ...quote, canDrop: false }), true);
});
for (const field of ["pricePaid", "studentRefund", "teacherShare", "platformShare", "deadlineHours"] as const) {
  for (const value of [undefined, null, "501", NaN, Infinity, -1, 1.5]) {
    test(`${field}: reject missing or invalid ${String(value)} rather than fabricate a price`, () => {
      assert.equal(hasDropQuote({ ...quote, [field]: value } as DropInfo), false);
    });
  }
}
test("missing/unknown/inconsistent quote cannot offer cancellation", () => {
  for (const extra of [{ known: false }, { headline: undefined }, { detail: undefined }, { full: undefined }, { studentRefund: 502 }, { platformShare: 124 }]) {
    assert.equal(hasDropQuote({ ...quote, ...extra }), false);
  }
});
test("linked IDs are positive but purchased lesson positions are zero-based", () => {
  for (const extra of [{ originalSessionId: 0 }, { originalSessionId: -1 }, { bookingId: undefined }, { position: -1 }, { position: 0.5 }, { canDrop: true }, { enrolled: false }]) {
    assert.equal(isLinkedDropLesson({ ...linked, ...extra }), false);
  }
});
