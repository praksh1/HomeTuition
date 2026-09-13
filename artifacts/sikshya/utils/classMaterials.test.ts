import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const screen = readFileSync(path.join(root, "app", "class-materials.tsx"), "utf8");

test("a teacher explicitly selects and then uploads a class handout", () => {
  assert.match(screen, /Choose a handout photo or PDF \(optional\)/);
  assert.match(screen, /await uploadFile\(file\)/);
  assert.match(screen, /fileKey,/);
  assert.match(screen, /fileName: file\?\.name/);
  assert.match(screen, /setFile\(null\)/);
  assert.match(screen, /if \(addInFlight\.current\) return/);
});

test("booked students can open a shared handout from the material card", () => {
  assert.match(screen, /HomeworkFileButton/);
  assert.match(screen, /material\.file\.fileKey/);
  assert.match(screen, /Open handout/);
});
