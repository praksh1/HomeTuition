import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyClassForm,
  classDescriptionIssues,
  groupTeachingClasses,
  type TeachingClass,
} from "./teachingClass.ts";
test("new teachers start with no fabricated description or price", () => {
  const form = emptyClassForm();
  assert.equal(form.title, "");
  assert.equal(form.totalTuitionNpr, "");
  assert.equal(form.capacity, "");
  assert.equal(form.format, "ongoing");
  assert.equal(form.lessons[0]!.date, "");
});

test("renewals share one class card without merging unrelated courses or dropping dates", () => {
  const fixture = (id: number, groupId?: number) =>
    ({
      title: "Maths tuition",
      batch: {
        id,
        format: groupId ? "ongoing" : "fixed",
        tuitionGroupId: groupId ?? null,
      },
    }) as TeachingClass;
  const items = [
    fixture(13, 4),
    fixture(12, 4),
    fixture(11, 5),
    fixture(10),
    fixture(9),
  ];
  const groups = groupTeachingClasses(items);
  assert.equal(groups.length, 4);
  assert.deepEqual(
    groups[0]!.items.map((item) => item.batch.id),
    [13, 12],
  );
  assert.deepEqual(
    groups.flatMap((group) => group.items.map((item) => item.batch.id)),
    [13, 12, 11, 10, 9],
  );
  assert.deepEqual(groupTeachingClasses([]), []);
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
