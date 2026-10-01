const hour = 3_600_000;
const now = Date.now();
const row = (teacherId, id, offset, status = "upcoming", extra = {}) => ({
  id: id + (teacherId === 82 ? 10_000 : 0), teacherName: "Synthetic Schedule Teacher",
  subject: "Mathematics", topic: `${teacherId === 82 ? "Other teacher" : "Teacher"} lesson ${id}`,
  date: new Date(now + offset * hour).toISOString(), duration: 60,
  maxStudents: 50, enrolledCount: 24, price: 0, status, ...extra,
});
const rows = (teacherId, status) => {
  if (status === "upcoming") return Array.from({ length: 251 }, (_, i) => row(teacherId, 1 + i, i + 1));
  if (status === "live") return Array.from({ length: 131 }, (_, i) => row(teacherId, 501 + i, i + 1, "live"));
  if (status === "completed") return Array.from({ length: 220 }, (_, i) => row(teacherId, 1001 + i, -i, "completed"));
  if (status === "cancelled") return Array.from({ length: 130 }, (_, i) => row(teacherId, 2001 + i, -500 - i, "cancelled"));
  if (status === "missed") return Array.from({ length: 105 }, (_, i) => row(teacherId, 3001 + i, -1000 - i, "upcoming", { expired: true }));
  throw new Error(`Unexpected synthetic status ${status}`);
};
window.__scheduleFixture = { requests: [], fail: null, hold: null, changed: null, pending: [], release() {
  const pending = this.pending.splice(0);
  for (const resolve of pending) resolve();
} };
export async function apiGet(url) {
  const query = new URL(url, "http://127.0.0.1").searchParams;
  const teacherId = Number(query.get("teacherId"));
  const status = query.get("agenda") === "missed" ? "missed" : query.get("status");
  const page = Number(query.get("page") ?? 1);
  const limit = Number(query.get("limit") ?? 20);
  const key = `${teacherId}:${status}:${page}`;
  const fixture = window.__scheduleFixture;
  fixture.requests.push(key);
  if (fixture.hold === key) {
    fixture.hold = null;
    await new Promise((resolve) => fixture.pending.push(resolve));
  }
  if (fixture.fail === key) { fixture.fail = null; throw new Error("Synthetic offline page"); }
  const collection = rows(teacherId, status);
  const changed = fixture.changed === key;
  if (changed) fixture.changed = null;
  return { sessions: collection.slice((page - 1) * limit, page * limit), total: collection.length + (changed ? 1 : 0), page, limit };
}
