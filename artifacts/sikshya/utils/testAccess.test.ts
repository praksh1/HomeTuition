import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_BOOKING_LABEL, bookingNotice } from "./testAccess.ts";

/**
 * What a teacher's phone says when somebody takes a place in their class.
 *
 * The defect: a test booking took no money and the notification said "Sita booked your class",
 * filed under the payment icon. Nothing in it was false word by word; it simply omitted the only
 * part that mattered, and a teacher reading it counts a sale that never happened.
 */

test("an ordinary booking says who, and how much", () => {
  const notice = bookingNotice({ topic: "Algebra", studentName: "Sita", amount: 500 });
  assert.equal(notice.title, "Sita booked your class");
  assert.match(notice.body, /NPR 500 for "Algebra"/);
  assert.doesNotMatch(notice.title, /TEST/);
});

test("a test booking says so in the title, which is all a locked phone shows", () => {
  const notice = bookingNotice({ topic: "Algebra", studentName: "Sita", amount: 0, testBooking: true });
  assert.match(notice.title, /TEST/);
  assert.doesNotMatch(notice.title, /booked/, "nothing was bought");
  assert.equal(notice.body, `"Algebra" — ${TEST_BOOKING_LABEL}.`);
});

test("`testBooking` is a flag, never a guess from a zero amount", () => {
  // A genuinely free class is not a test booking, and a test booking may still carry a price.
  const freeButReal = bookingNotice({ topic: "Algebra", amount: 0 });
  assert.doesNotMatch(freeButReal.title, /TEST/);
  assert.match(freeButReal.body, /tap to see who is coming/);

  const testWithPrice = bookingNotice({ topic: "Algebra", amount: 500, testBooking: true });
  assert.match(testWithPrice.title, /TEST/);
  assert.match(testWithPrice.body, /no payment was processed/i, "the flag wins over the number");
});

test("a booking with no student name still reads as a sentence", () => {
  assert.equal(bookingNotice({ topic: "Algebra" }).title, "A student booked your class");
  assert.equal(bookingNotice({ topic: "Algebra", testBooking: true }).title, "A student joined your class — TEST");
});

test("the label is the same sentence the rest of the app paints", () => {
  // One wording, so a person does not have to work out whether two phrasings mean the same thing.
  assert.match(bookingNotice({ topic: "x", testBooking: true }).body, new RegExp(TEST_BOOKING_LABEL));
});
