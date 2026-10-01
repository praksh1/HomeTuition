const hour = 3_600_000;
const day = 24 * hour;
const now = Date.now();

const row = (id, topic, at, status = "upcoming", extra = {}) => ({
  id,
  teacherName: "Maya Adhikari",
  subject: "Mathematics",
  topic,
  date: new Date(at).toISOString(),
  duration: 60,
  maxStudents: 30,
  enrolledCount: 24,
  price: 6000,
  status,
  ...extra,
});

const teacherUpcoming = Array.from({ length: 12 }, (_, index) =>
  row(index + 1, index < 6 ? "SEE Maths evening tuition" : "Science revision", now + (index + 1) * day),
);
teacherUpcoming.push(
  row(50, "Algebra review", now - 4 * day, "upcoming", { expired: true }),
  row(51, "Geometry practice", now - 6 * day, "upcoming", { expired: true }),
);

const studentClass = Array.from({ length: 30 }, (_, index) =>
  row(100 + index, "SEE Maths evening tuition", now + (index + 1) * day, "upcoming", {
    enrolment: "paid",
    classGroup: {
      batchId: 701,
      title: "SEE Maths evening tuition",
      lessonPosition: index,
      lessonCount: 30,
    },
  }),
);

const largeStudentClasses = Array.from({ length: 140 }, (_, index) => {
  const classNumber = Math.floor(index / 28);
  return row(1000 + index, `Course ${classNumber + 1}`, now + (index + 1) * hour, "upcoming", {
    enrolment: "paid",
    classGroup: { batchId: 801 + classNumber, title: `Course ${classNumber + 1}`, lessonPosition: index % 28, lessonCount: 28 },
  });
});

export async function apiGet(url) {
  if (new URLSearchParams(location.search).get("fail") === "1") {
    throw new Error("synthetic connection failure");
  }
  if (url.includes("teacherId=")) {
    const query = new URL(url, "http://localhost").searchParams;
    const page = Number(query.get("page") ?? 1);
    const limit = Number(query.get("limit") ?? 20);
    const status = query.get("status");
    const agenda = query.get("agenda");
    const sessions = status === "completed"
      ? [row(70, "Final revision", now - 2 * day, "completed")]
      : status === "cancelled"
        ? [row(71, "Cancelled revision", now - day, "cancelled")]
        : status === "live"
          ? [row(72, "Live algebra clinic", now, "live")]
          : teacherUpcoming.filter((session) => agenda === "missed" ? session.expired : !session.expired);
    return { sessions: sessions.slice((page - 1) * limit, page * limit), total: sessions.length, page, limit };
  }
  if (url.includes("studentId=")) {
    const query = new URL(url, "http://localhost").searchParams;
    const page = Number(query.get("page") ?? 1);
    const limit = Number(query.get("limit") ?? 20);
    if (new URLSearchParams(location.search).get("large") === "1") {
      return { sessions: largeStudentClasses.slice((page - 1) * limit, page * limit), total: largeStudentClasses.length, page, limit };
    }
    return { sessions: studentClass.slice((page - 1) * limit, page * limit), total: studentClass.length, page, limit };
  }
  throw new Error(`Unexpected sessions request: ${url}`);
}
