export interface RosterAttendance {
  lessonsAttended: number;
  presentMs: number;
  lastSeenAt: string | null;
}

/** Human-readable evidence without turning partial presence into a judgement about attendance. */
export function rosterPresenceSummary(
  attendance: RosterAttendance | null,
  lessonCount: number,
  attendanceKnown: boolean,
) {
  if (!attendanceKnown || !attendance) return "Attendance record unavailable";
  if (!attendance.lessonsAttended) return "No lesson presence recorded yet";
  const minutes = Math.max(1, Math.round(attendance.presentMs / 60_000));
  const lessonWord = lessonCount === 1 ? "lesson" : "lessons";
  return `${attendance.lessonsAttended} of ${lessonCount} ${lessonWord} joined · ${minutes} min recorded`;
}
