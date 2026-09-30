export type LessonAttendanceState = "joined" | "not_recorded" | "unavailable" | "not_enrolled";

/** Date/status alone cannot establish a student no-show or a completed make-up. */
export function lessonHistoryLabel({ status, previous, current, attendance, isTeacher }: {
  status?: string; previous: boolean; current: boolean; attendance?: LessonAttendanceState; isTeacher: boolean;
}): string {
  if (status === "cancelled") return "Cancelled";
  if (!isTeacher && previous && attendance === "not_enrolled") return "Not included";
  if (!isTeacher && previous && attendance === "joined") return "Joined";
  if (!isTeacher && previous && attendance === "not_recorded") return "No attendance recorded";
  if (!isTeacher && previous) return "Attendance unavailable";
  if (status === "completed") return "Completed";
  if (previous) return "Needs review";
  return current ? "Now" : "";
}
