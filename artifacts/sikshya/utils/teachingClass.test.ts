import assert from "node:assert/strict";
import test from "node:test";
import { emptyClassForm, classDescriptionIssues } from "./teachingClass.ts";
test("new teachers start with no fabricated description or price", () => {
  const form = emptyClassForm();
  assert.equal(form.title, "");
  assert.equal(form.totalTuitionNpr, "");
  assert.equal(form.capacity, "");
  assert.equal(form.format, "ongoing");
  assert.equal(form.lessons[0]!.date, "");
});
test("ordinary tuition does not require a formal outline", () => {
  const form = {
    ...emptyClassForm(),
    title: "SEE Maths tuition",
    summary: "We practise algebra and solve school exercises together.",
    teachingLanguage: "Nepali",
  };
  assert.deepEqual(classDescriptionIssues(form), []);
  assert.equal(classDescriptionIssues({ ...form, title: "x" }).length, 1);
  assert.equal(
    classDescriptionIssues({ ...form, outline: "x".repeat(2001) }).length,
    1,
  );
});
