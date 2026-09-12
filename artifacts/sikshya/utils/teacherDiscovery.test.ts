import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_TEACHER_SEARCH,
  activeTeacherFilterCount,
  appendTeacherPage,
  teacherSearchPath,
} from "./teacherDiscovery.ts";

test("teacher search is one bounded server page", () => {
  assert.equal(teacherSearchPath(EMPTY_TEACHER_SEARCH), "/teachers?page=1&limit=12&sort=name");
});

test("teacher search sends the Nepal location and institution choices to the server", () => {
  const path = teacherSearchPath({
    query: " Prakash ", subject: "Mathematics", province: "Bagmati Province",
    district: "Kathmandu", localLevel: "Kathmandu Metropolitan City",
    institution: "Shree School", affiliation: "affiliated",
  }, 3);
  const url = new URL(path, "https://fadko.example");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("limit"), "12");
  assert.equal(url.searchParams.get("search"), "Prakash");
  assert.equal(url.searchParams.get("province"), "Bagmati Province");
  assert.equal(url.searchParams.get("district"), "Kathmandu");
  assert.equal(url.searchParams.get("localLevel"), "Kathmandu Metropolitan City");
  assert.equal(url.searchParams.get("institution"), "Shree School");
  assert.equal(url.searchParams.get("affiliation"), "affiliated");
});

test("pagination keeps one card per teacher", () => {
  const base = { id: "1", userId: 1, name: "A", subject: "Math", subjects: [], bio: "", approvalStatus: "approved" as const, rating: 0, reviewCount: 0 };
  assert.deepEqual(appendTeacherPage([base], [{ ...base }, { ...base, id: "2", userId: 2, name: "B" }]).map((row) => row.userId), [1, 2]);
});

test("typed name is not counted as a hidden filter", () => {
  assert.equal(activeTeacherFilterCount({ ...EMPTY_TEACHER_SEARCH, query: "Anjali" }), 0);
  assert.equal(activeTeacherFilterCount({ ...EMPTY_TEACHER_SEARCH, province: "Koshi", affiliation: "independent" }), 2);
});
