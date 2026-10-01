import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("make-up list fetches full immutable receipt and timetable once per booking, never per lesson row", () => {
  const source = readFileSync(new URL("./lessonRemedyStore.ts", import.meta.url), "utf8");
  const list = source.slice(source.indexOf("export async function listLessonRemedies"));
  const lessonProjection = list.slice(0, list.indexOf("const truncated"));
  assert.doesNotMatch(lessonProjection, /select\(PURCHASE_COLUMNS\)/);
  assert.doesNotMatch(lessonProjection, /payment:\s*batchTestPaymentsTable|contract:\s*batchTestContractsTable/);
  assert.match(list, /new Map\(shared\.map\(row => \[row\.bookingId, row\]\)\)/);
  assert.match(list, /payment: frozen\.payment, contract: frozen\.contract/);
  assert.match(list, /termsByBooking\.get\(p\.bookingId\)/);
  const loop = list.slice(list.indexOf("for (const p of purchases)"));
  assert.doesNotMatch(loop, /await\s+db\.(?:select|execute|transaction)/);
});
