import {
  batchMatchesPublication,
  lessonDraft,
  type OwnerProgramBatch,
  type ProgramBatchLessonDraft,
} from "./programBatches.ts";
export interface TeachingClass {
  title: string;
  summary: string;
  teachingLanguage: string;
  outline: string;
  programUpdatedAt: string;
  batch: OwnerProgramBatch;
  publishedDescription: {
    title: string;
    summary: string;
    teachingLanguage: string;
    outline?: string;
  } | null;
}
export interface ClassForm {
  title: string;
  summary: string;
  teachingLanguage: string;
  outline: string;
  format: "ongoing" | "fixed";
  capacity: string;
  totalTuitionNpr: string;
  lessons: ProgramBatchLessonDraft[];
}

/** Renewal dates belong to the same class, not a second card with the same name. */
export function groupTeachingClasses(items: TeachingClass[]) {
  const groups = new Map<
    string,
    { key: string; title: string; items: TeachingClass[] }
  >();
  for (const item of items) {
    const key =
      item.batch.format === "ongoing" && item.batch.tuitionGroupId
        ? `tuition-${item.batch.tuitionGroupId}`
        : `class-${item.batch.id}`;
    const group = groups.get(key) ?? { key, title: item.title, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function emptyClassForm(): ClassForm {
  return {
    title: "",
    summary: "",
    teachingLanguage: "",
    outline: "",
    format: "ongoing",
    capacity: "",
    totalTuitionNpr: "",
    lessons: [{ date: "", time: "", durationMinutes: 60 }],
  };
}
export function formFromClass(item: TeachingClass): ClassForm {
  return {
    title: item.title,
    summary: item.summary,
    teachingLanguage: item.teachingLanguage,
    outline: item.outline,
    format: item.batch.format === "ongoing" ? "ongoing" : "fixed",
    capacity: String(item.batch.capacity ?? ""),
    totalTuitionNpr: String(item.batch.totalTuitionNpr ?? ""),
    lessons: item.batch.lessons.length
      ? item.batch.lessons.map(lessonDraft)
      : emptyClassForm().lessons,
  };
}
export function classDescriptionIssues(form: ClassForm): string[] {
  const issues: string[] = [];
  for (const [field, label, min, max] of [
    ["title", "Class name", 8, 90],
    ["summary", "Class description", 24, 240],
    ["teachingLanguage", "Teaching language", 2, 100],
    ["outline", "Optional teaching plan", 0, 2000],
  ] as const) {
    if (form[field].trim().length < min)
      issues.push(`${label} needs a little more detail.`);
    if (form[field].trim().length > max) issues.push(`${label} is too long.`);
  }
  return issues;
}
export function classIsPublished(item: TeachingClass): boolean {
  return (
    batchMatchesPublication(item.batch) &&
    !!item.publishedDescription &&
    (["title", "summary", "teachingLanguage", "outline"] as const).every(
      (key) => item[key] === (item.publishedDescription![key] ?? ""),
    )
  );
}
