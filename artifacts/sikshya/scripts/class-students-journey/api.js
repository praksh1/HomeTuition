export async function apiGet() {
  if (location.search.includes("failure")) throw new Error("The roster is temporarily unavailable.");
  const students = [
    { name: "Anisha Rai", joinedAt: "2026-09-10T10:00:00.000Z", attendance: { lessonsAttended: 2, presentMs: 5_430_000, lastSeenAt: "2026-09-13T10:00:00.000Z" } },
    { name: "Bikash Thapa", joinedAt: "2026-09-11T10:00:00.000Z", attendance: { lessonsAttended: 0, presentMs: 0, lastSeenAt: null } },
    ...Array.from({ length: 38 }, (_, index) => ({
      name: `Student ${String(index + 3).padStart(2, "0")}`,
      joinedAt: "2026-09-12T10:00:00.000Z",
      attendance: index % 2
        ? { lessonsAttended: 1, presentMs: 2_700_000, lastSeenAt: "2026-09-13T10:00:00.000Z" }
        : { lessonsAttended: 0, presentMs: 0, lastSeenAt: null },
    })),
  ];
  return {
    title: "SEE Maths evening tuition",
    lessonCount: 12,
    attendanceKnown: !location.search.includes("unknown"),
    students: location.search.includes("empty") ? [] : students,
  };
}
