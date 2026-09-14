export async function apiGet() {
  if (location.search.includes("failure")) throw new Error("The roster is temporarily unavailable.");
  return {
    title: "SEE Maths evening tuition",
    lessonCount: 12,
    attendanceKnown: !location.search.includes("unknown"),
    students: location.search.includes("empty")
      ? []
      : [
          { name: "Anisha Rai", joinedAt: "2026-09-10T10:00:00.000Z", attendance: { lessonsAttended: 2, presentMs: 5_430_000, lastSeenAt: "2026-09-13T10:00:00.000Z" } },
          { name: "Bikash Thapa", joinedAt: "2026-09-11T10:00:00.000Z", attendance: { lessonsAttended: 0, presentMs: 0, lastSeenAt: null } },
        ],
  };
}
