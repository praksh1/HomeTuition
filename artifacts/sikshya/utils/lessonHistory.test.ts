import assert from "node:assert/strict";
import test from "node:test";
import { lessonHistoryLabel } from "./lessonHistory.ts";

const past = { previous: true, current: false, isTeacher: false };
test("an elapsed date is not proof a student missed a class", () => {
  assert.equal(lessonHistoryLabel(past), "Attendance unavailable");
  assert.equal(lessonHistoryLabel({ ...past, status: "completed" }), "Attendance unavailable");
  assert.equal(lessonHistoryLabel({ ...past, attendance: "unavailable" }), "Attendance unavailable");
  assert.equal(lessonHistoryLabel({ ...past, status: "completed", attendance: "not_recorded" }), "No attendance recorded");
});
test("only actual connection evidence says joined, not full delivery or completion", () => {
  assert.equal(lessonHistoryLabel({ ...past, status: "upcoming", attendance: "joined" }), "Joined");
  assert.equal(lessonHistoryLabel({ ...past, status: "completed", attendance: "joined" }), "Joined");
});
test("late joins cannot be accused of missing unpurchased lessons", () => {
  assert.equal(lessonHistoryLabel({ ...past, status: "completed", attendance: "not_enrolled" }), "Not included");
});
test("cancelled, teacher completion and current states retain their meanings", () => {
  assert.equal(lessonHistoryLabel({ ...past, status: "cancelled", attendance: "joined" }), "Cancelled");
  assert.equal(lessonHistoryLabel({ ...past, status: "completed", isTeacher: true }), "Completed");
  assert.equal(lessonHistoryLabel({ ...past, previous: false, current: true }), "Now");
});
