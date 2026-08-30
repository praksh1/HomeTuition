import assert from "node:assert/strict";
import { test } from "node:test";
import { costAt, egressGbAt, monthWindow } from "./videoCost.ts";

test("a month runs from its first day to the next month's first day", () => {
  const w = monthWindow(new Date("2026-08-26T11:00:00Z"));
  assert.equal(w.from.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("December rolls into January of the next year", () => {
  // The off-by-one that turns a December bill into a thirteenth month.
  const w = monthWindow(new Date("2026-12-15T00:00:00Z"));
  assert.equal(w.to.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("the window is half-open, so no minute is counted in two months", () => {
  const august = monthWindow(new Date("2026-08-10T00:00:00Z"));
  const september = monthWindow(new Date("2026-09-10T00:00:00Z"));
  assert.equal(august.to.getTime(), september.from.getTime());
});

test("cost is minutes times the rate you supply", () => {
  assert.equal(costAt(37_440, 0.002), 74.88);
  assert.equal(costAt(0, 0.002), 0);
});

test("a rate of zero is a real answer, not a missing one", () => {
  // Self-hosting: the per-minute rate genuinely is zero and the bill is the server.
  assert.equal(costAt(100_000, 0), 0);
});

test("egress converts minutes into the unit a self-hosted bill is in", () => {
  // One participant-minute at 1.5 Mbps is 1.5 × 60 = 90 Mbit ≈ 0.011 GB.
  assert.equal(egressGbAt(1, 1500), 0.01);
  // A teacher's month: ~37,440 participant-minutes.
  assert.ok(egressGbAt(37_440, 1500) > 300, "a teacher's month should be hundreds of GB");
  assert.ok(egressGbAt(37_440, 1500) < 500, "and not thousands");
});

test("a class with cameras off costs a fraction of one with them on", () => {
  // The single biggest lever on the bill, and the reason the rate is a parameter.
  assert.ok(egressGbAt(10_000, 100) < egressGbAt(10_000, 1500) / 10);
});
