import assert from "node:assert/strict";
import test from "node:test";
import { classHomeworkOverview, type ClassHomeworkCounts } from "./classHomeworkOverview.ts";

const counts = (values: Partial<ClassHomeworkCounts> = {}): ClassHomeworkCounts => ({
  homework: 0,
  homeworkToDo: 0,
  homeworkLate: 0,
  homeworkAwaitingReview: 0,
  ...values,
});

test("teachers see work needing review before the number of open tasks", () => {
  assert.equal(
    classHomeworkOverview(counts({ homework: 3, homeworkAwaitingReview: 2 }), true),
    "2 hand-ins to review · 3 open",
  );
  assert.equal(
    classHomeworkOverview(counts({ homework: 1, homeworkAwaitingReview: 1 }), true),
    "1 hand-in to review · 1 open",
  );
});

test("teachers are told when open homework is caught up or when none exists", () => {
  assert.equal(classHomeworkOverview(counts({ homework: 3 }), true), "3 open · all caught up");
  assert.equal(classHomeworkOverview(counts(), true), "Set the first task");
});

test("students see late work first without repeating the same count", () => {
  assert.equal(
    classHomeworkOverview(counts({ homework: 3, homeworkToDo: 3, homeworkLate: 1 }), false),
    "1 late · 3 to do",
  );
  assert.equal(
    classHomeworkOverview(counts({ homework: 1, homeworkToDo: 1, homeworkLate: 1 }), false),
    "1 late",
  );
});

test("students can distinguish unfinished, completed and absent homework", () => {
  assert.equal(classHomeworkOverview(counts({ homework: 2, homeworkToDo: 1 }), false), "1 to do");
  assert.equal(classHomeworkOverview(counts({ homework: 2 }), false), "All handed in");
  assert.equal(classHomeworkOverview(counts(), false), "Nothing due yet");
});
