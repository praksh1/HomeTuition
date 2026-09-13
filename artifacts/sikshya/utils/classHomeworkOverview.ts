export interface ClassHomeworkCounts {
  homework: number;
  homeworkToDo: number;
  homeworkLate: number;
  homeworkAwaitingReview: number;
}

/** Short, role-specific status for the class-home card. */
export function classHomeworkOverview(
  counts: ClassHomeworkCounts,
  isTeacher: boolean,
): string {
  if (isTeacher) {
    if (counts.homeworkAwaitingReview > 0) {
      const noun = counts.homeworkAwaitingReview === 1 ? "hand-in" : "hand-ins";
      return `${counts.homeworkAwaitingReview} ${noun} to review${
        counts.homework > 0 ? ` · ${counts.homework} open` : ""
      }`;
    }
    return counts.homework > 0
      ? `${counts.homework} open · all caught up`
      : "Set the first task";
  }

  if (counts.homeworkLate > 0) {
    return counts.homeworkToDo > counts.homeworkLate
      ? `${counts.homeworkLate} late · ${counts.homeworkToDo} to do`
      : `${counts.homeworkLate} late`;
  }
  if (counts.homeworkToDo > 0) return `${counts.homeworkToDo} to do`;
  return counts.homework > 0 ? "All handed in" : "Nothing due yet";
}
