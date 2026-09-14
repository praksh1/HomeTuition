const lessons = [
  [1, 101, "2026-09-13T10:00:00.000Z"],
  [2, 102, "2026-09-14T10:00:00.000Z"],
  [3, 103, "2026-09-15T10:00:00.000Z"],
  [4, 104, "2026-09-16T10:00:00.000Z"],
].map(([position, sessionId, startsAt]) => ({
  position,
  sessionId,
  startsAt,
  durationMinutes: 60,
}));

export async function apiGet() {
  const serverNow = location.search.includes("finished")
    ? "2026-09-17T10:00:00.000Z"
    : location.search.includes("upcoming")
      ? "2026-09-13T09:00:00.000Z"
      : "2026-09-13T10:30:00.000Z";
  return {
    title: "SEE Maths evening tuition",
    isTeacher: location.search.includes("teacher"),
    serverNow,
    lessons,
    counts: {
      messages: 6,
      unreadMessages: 2,
      homework: 2,
      homeworkToDo: 1,
      homeworkLate: 0,
      homeworkAwaitingReview: 1,
      materials: 3,
    },
  };
}
