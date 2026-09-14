export interface RosterAttendance {
  lessonsAttended: number;
  presentMs: number;
  lastSeenAt: string | null;
}

export interface RosterStudent {
  name: string;
  joinedAt: string;
  attendance: RosterAttendance | null;
}

export type RosterFilter = "all" | "joined" | "not_yet";

/** Ten rows keep the register useful on a phone without turning Class Home into an endless page. */
export const ROSTER_PAGE_SIZE = 10;

export function studentInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

export function filterRosterStudents(
  students: RosterStudent[],
  query: string,
  filter: RosterFilter,
  attendanceKnown: boolean,
) {
  const needle = query.trim().toLocaleLowerCase();
  return students.filter((student) => {
    if (needle && !student.name.toLocaleLowerCase().includes(needle)) return false;
    if (filter === "joined") return Boolean(student.attendance?.lessonsAttended);
    if (filter === "not_yet") {
      return attendanceKnown && Boolean(student.attendance) && !student.attendance?.lessonsAttended;
    }
    return true;
  });
}

export function rosterActivityCounts(students: RosterStudent[], attendanceKnown: boolean) {
  return {
    all: students.length,
    joined: students.filter((student) => Boolean(student.attendance?.lessonsAttended)).length,
    notYet: attendanceKnown
      ? students.filter((student) => Boolean(student.attendance) && !student.attendance?.lessonsAttended).length
      : null,
  };
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
