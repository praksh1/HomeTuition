import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const teacherPage = readFileSync(path.join(appRoot, "app", "(student)", "teacher", "[id].tsx"), "utf8");
const programPage = readFileSync(path.join(appRoot, "app", "(student)", "program", "[id].tsx"), "utf8");
const bookingPanel = readFileSync(path.join(appRoot, "components", "classes", "BatchTestPanel.tsx"), "utf8");
const loginPage = readFileSync(path.join(appRoot, "app", "(auth)", "login.tsx"), "utf8");

test("shared teacher pages show Fadko and do not advertise legacy booking totals", () => {
  assert.match(teacherPage, /<PublicFadkoHome inverse/);
  assert.doesNotMatch(teacherPage, /teacher\.totalStudents|Paid bookings/);
  assert.match(teacherPage, /new Set\(\[teacher\.subject, \.\.\.teacher\.subjects\]/);
  assert.match(teacherPage, /Subjects taught \(\{declaredSubjects\.length\}\)/);
});

test("shared class pages identify signed-out visitors before checkout", () => {
  assert.match(programPage, /publicVisitor=\{!user\}/);
  assert.match(programPage, /onOpenHome=\{\(\) => router\.replace\("\/welcome"\)\}/);
  const guard = bookingPanel.indexOf("if (accountRequired)");
  const requestButton = bookingPanel.indexOf("Try test checkout");
  assert.ok(guard >= 0 && guard < requestButton, `${appRoot}: account guard must precede checkout`);
  assert.match(bookingPanel, /Sign in to join/);
  assert.match(bookingPanel, /Create a student account/);
  assert.match(bookingPanel, /next: returnPath/);
  assert.match(loginPage, /open redirect[\s\S]*const safeNext = resolvedRole === "student"[\s\S]*requestedNext/);
  assert.match(loginPage, /router\.replace\(\(safeNext \?\? "\/"\) as never\)/);
});
