import assert from "node:assert/strict";
import test from "node:test";
import { conflictMessages, overlaps, slotDescription } from "./scheduleIntervals.ts";
const slot = (time: string, durationMinutes = 60, label = "Guitar") => ({ startsAt: new Date(`2030-01-01T${time}:00+05:45`), durationMinutes, label });
test("full interval overlap, identical, enclosed and unequal durations", () => {
  assert.ok(overlaps(slot("17:00"), slot("17:30")));
  assert.ok(overlaps(slot("17:00"), slot("17:00")));
  assert.ok(overlaps(slot("17:00", 90), slot("17:15", 30)));
  assert.ok(overlaps(slot("17:15", 30), slot("17:00", 90)));
});
test("adjacent slots and separated dates are allowed", () => {
  assert.equal(overlaps(slot("17:00"), slot("18:00")), false);
  assert.equal(overlaps(slot("18:00"), slot("17:00")), false);
  assert.equal(overlaps(slot("17:00"), { ...slot("17:00"), startsAt: new Date("2030-01-02T17:00:00+05:45") }), false);
});
test("cross-midnight duration and timezone representations are real instants", () => {
  assert.ok(overlaps(slot("23:30", 90), { ...slot("00:00"), startsAt: new Date("2030-01-02T00:15:00+05:45") }));
  assert.ok(overlaps(slot("17:00"), { ...slot("17:00"), startsAt: new Date("2030-01-01T11:15:00Z") }));
  assert.match(slotDescription(slot("17:00")), /17:00.*18:00.*Nepal time/);
});
test("internal conflicts name both lessons and external conflicts name the actual class", () => {
  assert.match(conflictMessages([slot("17:00", 60, "Lesson 1"), slot("17:30", 30, "Lesson 2")], [])[0]!, /Lesson 2.*Lesson 1/);
  assert.match(conflictMessages([slot("17:30", 30, "Lesson 1")], [slot("17:00")])[0]!, /Lesson 1.*Guitar/);
  assert.equal(conflictMessages(Array.from({ length: 60 }, () => slot("17:00")), []).length, 10);
});
