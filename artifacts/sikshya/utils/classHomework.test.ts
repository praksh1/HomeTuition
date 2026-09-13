import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { homeworkDeadlineIso, homeworkDeadlineParts } from "./classHomework.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const screen = readFileSync(path.join(root, "app", "class-homework.tsx"), "utf8");
const files = readFileSync(
  path.join(root, "components", "classes", "HomeworkFileControls.tsx"),
  "utf8",
);

test("new class homework preserves text and adds an explicit photo or PDF upload", () => {
  assert.match(screen, /Write your answer or a note for your teacher/);
  assert.match(screen, /await uploadFile\(file\)/);
  assert.match(screen, /fileKey, fileName: file\?\.name/);
  assert.match(files, /\["image\/\*", "application\/pdf"\]/);
  assert.match(files, /Remove selected file/);
});

test("teacher feedback and marked copies reach the same student submission", () => {
  assert.match(screen, /submissions\/\$\{submission\.id\}\/feedback/);
  assert.match(screen, /Return feedback/);
  assert.match(screen, /Open marked copy/);
  assert.match(screen, /clears earlier feedback/);
});

test("file controls explain their action and meet the phone touch floor", () => {
  assert.match(files, /accessibilityLabel=\{file \?/);
  assert.match(files, /minHeight: 48/);
  assert.match(files, /minHeight: 44/);
  assert.match(files, /openAttachment\(fileKey\)/);
});

test("homework deadlines are pinned to Nepal time on every device", () => {
  const instant = homeworkDeadlineIso("2026-09-13", "18:30");
  assert.equal(instant, "2026-09-13T12:45:00.000Z");
  assert.deepEqual(homeworkDeadlineParts(instant!), { date: "2026-09-13", time: "18:30" });
  assert.equal(homeworkDeadlineIso("2026-02-30", "18:30"), null);
  assert.equal(homeworkDeadlineIso("2026-09-13", "25:00"), null);
});

test("teacher chooses an optional deadline and students can still submit after it", () => {
  assert.match(screen, /Choose homework deadline/);
  assert.match(screen, /class-homework-due-time/);
  assert.match(screen, /dueAt,/);
  assert.match(screen, /The deadline has passed, but you can still hand in your work/);
  assert.doesNotMatch(screen, /disabled=\{[^}]*overdue/);
});
