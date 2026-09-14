import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRosterStudents,
  rosterActivityCounts,
  rosterPresenceSummary,
  studentInitials,
  type RosterStudent,
} from "./classRoster.ts";

const students: RosterStudent[] = [
  { name: "Anisha Rai", joinedAt: "2026-09-10T10:00:00Z", attendance: { lessonsAttended: 2, presentMs: 60_000, lastSeenAt: null } },
  { name: "Bikash Thapa", joinedAt: "2026-09-11T10:00:00Z", attendance: { lessonsAttended: 0, presentMs: 0, lastSeenAt: null } },
  { name: "Chetan Karki", joinedAt: "2026-09-12T10:00:00Z", attendance: null },
];

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

test("search and activity filters organize a large register without inventing absence", () => {
  assert.deepEqual(filterRosterStudents(students, "rai", "all", true).map((student) => student.name), ["Anisha Rai"]);
  assert.deepEqual(filterRosterStudents(students, "", "joined", true).map((student) => student.name), ["Anisha Rai"]);
  assert.deepEqual(filterRosterStudents(students, "", "not_yet", true).map((student) => student.name), ["Bikash Thapa"]);
  assert.deepEqual(filterRosterStudents(students, "", "not_yet", false), []);
});

test("activity counts distinguish recorded zero from unavailable evidence", () => {
  assert.deepEqual(rosterActivityCounts(students, true), { all: 3, joined: 1, notYet: 1 });
  assert.deepEqual(rosterActivityCounts(students, false), { all: 3, joined: 1, notYet: null });
});

test("student avatars use short human initials", () => {
  assert.equal(studentInitials("Anisha Rai"), "AR");
  assert.equal(studentInitials("  Bikash  "), "B");
  assert.equal(studentInitials(""), "?");
});
