import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const teacherProfileSource = readFileSync(
  path.resolve(here, "..", "app", "(teacher)", "profile.tsx"),
  "utf8",
);
const studentProfileSource = readFileSync(
  path.resolve(here, "..", "app", "(student)", "profile.tsx"),
  "utf8",
);
const studentPaymentsSource = readFileSync(
  path.resolve(here, "..", "app", "(student)", "payments.tsx"),
  "utf8",
);

test("a successful credential upload refreshes the server-owned teaching status", () => {
  assert.match(teacherProfileSource, /const \{ user, logout, refreshUser \} = useAuth\(\)/);
  assert.match(
    teacherProfileSource,
    /await apiPost\([\s\S]*await loadCredentials\(\);[\s\S]*await refreshUser\(\);/,
  );
});

test("credential actions name their document type to assistive technology", () => {
  assert.match(teacherProfileSource, /`Select \$\{type\.label\} file`/);
  assert.match(teacherProfileSource, /`Choose another \$\{type\.label\} file`/);
  assert.match(teacherProfileSource, /`Upload selected \$\{type\.label\}`/);
  assert.match(teacherProfileSource, /`Delete submitted \$\{type\.label\}`/);
});

test("students reach their receipt history from Profile", () => {
  assert.match(studentProfileSource, /student-payments-link/);
  assert.match(studentProfileSource, /Payments & receipts/);
  assert.match(studentPaymentsSource, /BatchTestMoneySummary role="student"/);
  assert.doesNotMatch(studentPaymentsSource, /Held by Fadko|Fadko fee|Fadko earned/);
});
