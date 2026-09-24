/** Dashboard and Sessions read the same clock-filtered, server-ordered agenda. */
export function teacherAgendaPath(teacherId: number, mode: "upcoming" | "missed", limit: number) {
  return `/sessions?teacherId=${teacherId}&status=upcoming&agenda=${mode}&limit=${limit}`;
}
