/**
 * Every decision the public-classes utils make, exercised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendClassPage,
  formatMinutes,
  publicClassCard,
  publicClassListState,
  type PublicClass,
} from "./publicClasses.ts";

const row = (over: Partial<PublicClass> = {}): PublicClass => ({
  id: 1, teacherUserId: 42, teacherProfileId: 7, teacherName: "Anjali Rai",
  subject: "Mathematics", topic: "Trigonometry, one hour",
  date: "2026-09-20T14:00:00.000Z",
  duration: 60, maxStudents: 10, enrolledCount: 3, price: 500,
  ...over,
});

/* --- card ------------------------------------------------------------- */

test("the card shows every truthful commercial field before the tap", () => {
  const card = publicClassCard(row());
  assert.equal(card.billingLine, "Pay per class");
  assert.equal(card.priceLine, "NPR 500");
  assert.equal(card.durationLine, "1 hour");
  assert.equal(card.seatsLine, "7 of 10 seats left");
  assert.equal(card.soldOut, false);
  assert.equal(card.actionLabel, "View & book");
});

test("a full class is labelled Sold out, and the action changes accordingly", () => {
  const card = publicClassCard(row({ enrolledCount: 10, maxStudents: 10 }));
  assert.equal(card.soldOut, true);
  assert.equal(card.seatsLine, "Sold out");
  assert.equal(card.actionLabel, "See other classes");
});

test("the teacher profile id and name reach the card so it can route to the right teacher page", () => {
  const card = publicClassCard(row({ teacherProfileId: 99, teacherName: "Meena Rai" }));
  assert.equal(card.teacherProfileId, 99);
  assert.equal(card.teacherName, "Meena Rai");
});

test("the price is tabular-numeric with thousands separators", () => {
  assert.equal(publicClassCard(row({ price: 12500 })).priceLine, "NPR 12,500");
});

test("the spoken label carries the class, the teacher and what the button does", () => {
  const card = publicClassCard(row({ topic: "Vector geometry" }));
  assert.match(card.spokenLabel, /Vector geometry/);
  assert.match(card.spokenLabel, /Anjali Rai/);
  assert.match(card.spokenLabel, /View and book/);
});

test("no fabrication: no rating, popularity, availability guarantee, or enrolment total", () => {
  const card = publicClassCard(row());
  const printed = Object.values(card).map(String).join(" ").toLowerCase();
  for (const claim of [
    "rating", "star", "popular", "top pick", "available now",
    "students enrolled", "earned", "reviews",
  ]) {
    assert.ok(!printed.includes(claim), `card leaked "${claim}"`);
  }
});

/* --- duration ---------------------------------------------------------- */

test("formatMinutes rounds up to human phrases", () => {
  assert.equal(formatMinutes(30), "30 min");
  assert.equal(formatMinutes(60), "1 hour");
  assert.equal(formatMinutes(90), "1 hour 30 min");
  assert.equal(formatMinutes(120), "2 hours");
  assert.equal(formatMinutes(0), "");
  assert.equal(formatMinutes(-1), "");
});

/* --- list state -------------------------------------------------------- */

const listInput = (over: Partial<Parameters<typeof publicClassListState>[0]> = {}) => ({
  initialLoad: false, loadedRows: [] as PublicClass[], hasMore: false,
  initialError: null as string | null, paginationError: null as string | null,
  submittedQuery: "", ...over,
});

test("initial load is loading, always", () => {
  assert.equal(publicClassListState(listInput({ initialLoad: true })).kind, "loading");
});

test("empty result with no query is the global empty state", () => {
  assert.equal(publicClassListState(listInput()).kind, "empty");
});

test("empty result under an active submitted query is no-match", () => {
  const s = publicClassListState(listInput({ submittedQuery: "guitar" }));
  assert.equal(s.kind, "noMatch");
  if (s.kind === "noMatch") assert.equal(s.query, "guitar");
});

test("a first-load failure with nothing rendered is the failure state", () => {
  const s = publicClassListState(listInput({ initialError: "Network is down" }));
  assert.equal(s.kind, "error");
});

test("a pagination failure never hides successful class cards", () => {
  const s = publicClassListState(listInput({
    loadedRows: [row()], hasMore: true, paginationError: "Next page failed",
  }));
  assert.equal(s.kind, "ready");
  if (s.kind === "ready") {
    assert.equal(s.rows.length, 1);
    assert.equal(s.paginationError, "Next page failed");
    assert.equal(s.hasMore, true);
  }
});

/* --- pagination -------------------------------------------------------- */

test("merging pages dedupes by id and preserves order", () => {
  const first = { rows: [row({ id: 1 }), row({ id: 2 })], nextCursor: "a" };
  const second = { rows: [row({ id: 2, topic: "Rescheduled" }), row({ id: 3 })], nextCursor: null };
  const merged = appendClassPage(first, second);
  assert.deepEqual(merged.rows.map((r) => r.id), [1, 2, 3]);
  assert.equal(merged.rows[1].topic, row({ id: 2 }).topic);
  assert.equal(merged.nextCursor, null);
});
