import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const teacherLayout = readFileSync(path.join(appRoot, "app", "(teacher)", "_layout.tsx"), "utf8");
const rootLayout = readFileSync(path.join(appRoot, "app", "_layout.tsx"), "utf8");
const login = readFileSync(path.join(appRoot, "app", "(auth)", "login.tsx"), "utf8");

test("a hidden teacher tab tree cannot sign out a newly logged-in student", () => {
  assert.doesNotMatch(teacherLayout, /TeacherRoleGuard/);
  assert.doesNotMatch(teacherLayout, /\blogout\s*\(/);
  assert.doesNotMatch(teacherLayout, /Access Denied/);
});

test("the active root navigator remains the single role-routing authority", () => {
  assert.match(rootLayout, /user\.role === "teacher"/);
  assert.match(rootLayout, /user\.role === "student"/);
  assert.match(rootLayout, /router\.replace\("\/\(teacher\)"\)/);
  assert.match(rootLayout, /router\.replace\("\/\(student\)"\)/);
});

test("the selected login door still refuses a genuinely mismatched account", () => {
  assert.match(login, /loggedInUser\.role !== resolvedRole/);
  assert.match(login, /await logout\(\)/);
  assert.match(login, /This account is registered as a/);
});
