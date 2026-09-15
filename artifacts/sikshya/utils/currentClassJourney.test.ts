import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(path.join(appRoot, ...parts), "utf8");
const studentSessions = read("app", "(student)", "sessions.tsx");
const teacherDashboard = read("app", "(teacher)", "index.tsx");
const teacherSessions = read("app", "(teacher)", "sessions.tsx");
const teacherClasses = read("app", "(teacher)", "teaching-classes.tsx");
const teacherStudents = read("app", "(teacher)", "students.tsx");
const classSetup = read("components", "classes", "ClassSetup.tsx");
const teachingEarnings = read("components", "commerce", "TeachingEarnings.tsx");

test("student Sessions is a grouped learning timetable rather than one row per generated lesson", () => {
  assert.match(studentSessions, /My classes/);
  assert.match(studentSessions, /student-class-group-/);
  assert.match(studentSessions, /pathname: "\/class-home"/);
  assert.match(studentSessions, /lessonCount/);
  assert.match(studentSessions, /remainingCount/);
  assert.match(studentSessions, /type ViewMode = "upcoming" \| "live" \| "history"/);
  assert.match(studentSessions, /studentClassSection/);
  assert.match(studentSessions, /studentSessionSection/);
  assert.doesNotMatch(studentSessions, /MonthlyClass|student-monthly-|student-group-monthly/);
  assert.match(studentSessions, /Your classes could not be loaded/);
  assert.match(studentSessions, /Nothing was removed\. Check your connection and try again\./);
});

test("teacher Schedule is a lesson agenda while the student tab remains a class library", () => {
  assert.match(teacherSessions, /Teaching schedule/);
  assert.match(teacherSessions, /One-time lesson/);
  assert.match(teacherSessions, /type ViewMode = "upcoming" \| "live" \| "history"/);
  assert.match(teacherSessions, /classGroup\.lessonPosition/);
  assert.match(teacherSessions, /sequence === requestSequence\.current/);
  assert.doesNotMatch(teacherSessions, /NPR \{session\.price/);
});

test("retired Monthly and test-tool entry points remain hidden from current teacher screens", () => {
  for (const source of [teacherDashboard, teacherSessions, teacherClasses, teachingEarnings]) {
    assert.doesNotMatch(source, /Earlier test tools/);
    assert.doesNotMatch(source, /Monthly class|Open existing monthly class/);
  }
  assert.doesNotMatch(teachingEarnings, /LegacyTeacherPlans/);
  assert.doesNotMatch(teacherSessions + teacherStudents, /session-create/);
  assert.match(teacherSessions + teacherStudents, /create-class/);
});

test("one lesson uses the current class setup and every fresh Create action clears prior review state", () => {
  assert.match(classSetup, /label="Just one lesson"[\s\S]{0,260}setCount\("1"\)/);
  assert.doesNotMatch(classSetup, /label="Just one lesson"[\s\S]{0,260}session-create/);
  assert.match(classSetup, /setItem\(null\)/);
  assert.match(classSetup, /setStep\(0\)/);
  assert.match(classSetup, /key\.current = Crypto\.randomUUID\(\)/);
});
