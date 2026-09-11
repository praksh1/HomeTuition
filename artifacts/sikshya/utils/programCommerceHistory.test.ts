import assert from "node:assert/strict";
import test from "node:test";

import {
  orderedProgramCommerceHistory,
  programCommerceEventLabel,
  programCommerceNepalTime,
} from "./programCommerceHistory.ts";

test("commerce events are translated into operator language", () => {
  assert.equal(
    programCommerceEventLabel("lesson_cancelled"),
    "Teacher cancellation recorded",
  );
  assert.equal(
    programCommerceEventLabel("replacement_scheduled"),
    "Replacement lesson agreed",
  );
  assert.equal(
    programCommerceEventLabel("complaint_upheld"),
    "Complaint upheld",
  );
  assert.equal(
    programCommerceEventLabel("refund_confirmed"),
    "Test refund confirmed",
  );
});

test("an unknown event remains visible without exposing its internal code", () => {
  assert.equal(
    programCommerceEventLabel("provider_future_event"),
    "Recorded rehearsal action",
  );
});

test("history is copied and ordered from oldest to newest", () => {
  const source = [{ id: 8 }, { id: 3 }, { id: 5 }];
  assert.deepEqual(
    orderedProgramCommerceHistory(source).map((row) => row.id),
    [3, 5, 8],
  );
  assert.deepEqual(
    source.map((row) => row.id),
    [8, 3, 5],
  );
});

test("history time is pinned to Nepal rather than the operator device", () => {
  const written = programCommerceNepalTime("2026-09-10T12:00:00.000Z");
  assert.match(written, /5:45 PM/);
  assert.match(written, /Nepal time$/);
  assert.equal(programCommerceNepalTime("not-a-date"), "Time unavailable");
});
