import assert from "node:assert/strict";
import test from "node:test";
import { rosterPresenceSummary } from "./classRoster.ts";

test("missing evidence is never presented as absence", () => {
  assert.equal(rosterPresenceSummary(null, 12, false), "Attendance record unavailable");
});

test("a readable empty ledger says only that no presence was recorded", () => {
  assert.equal(
    rosterPresenceSummary({ lessonsAttended: 0, presentMs: 0, lastSeenAt: null }, 12, true),
    "No lesson presence recorded yet",
  );
});

test("recorded presence is summarized in human lesson numbers and minutes", () => {
  assert.equal(
    rosterPresenceSummary(
      { lessonsAttended: 2, presentMs: 5_430_000, lastSeenAt: "2026-09-14T10:00:00Z" },
      12,
      true,
    ),
    "2 of 12 lessons joined · 91 min recorded",
  );
});
