import test from "node:test";
import assert from "node:assert/strict";
import { testPilotDeadline, testPilotAllowsExistingAccess } from "./testPilot.ts";

const now = Date.parse("2026-09-11T00:00:00Z");
test("new pilot needs a fixed, bounded UTC end date", () => {
  for (const value of [undefined, "", "tomorrow", "2027-01-01", "2026-09-11T00:00:00Z", "2027-09-11T00:00:00Z"]) {
    assert.equal(testPilotDeadline({ TEST_ACCESS_UNTIL: value }, now), null);
  }
  const deadline = "2027-01-09T00:00:00Z";
  assert.equal(testPilotDeadline({ TEST_ACCESS_UNTIL: deadline }, now), Date.parse(deadline));
  assert.equal(testPilotDeadline({ TEST_ACCESS_UNTIL: deadline }, Date.parse(deadline)), null);
  assert.equal(testPilotDeadline({ TEST_ACCESS_UNTIL: "2027-02-30T00:00:00Z" }, Date.parse("2027-02-01T00:00:00Z")), null);
});
test("optional deadline does not silently open or extend existing test access", () => {
  assert.equal(testPilotAllowsExistingAccess({}, now), true);
  assert.equal(testPilotAllowsExistingAccess({ TEST_ACCESS_UNTIL: "bad" }, now), false);
  assert.equal(testPilotAllowsExistingAccess({ TEST_ACCESS_UNTIL: "2026-09-10T00:00:00Z" }, now), false);
});
