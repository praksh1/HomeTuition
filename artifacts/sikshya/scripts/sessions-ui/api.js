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

export async function apiGet(url) {
  if (new URLSearchParams(location.search).get("fail") === "1") {
    throw new Error("synthetic connection failure");
  }
  if (url.includes("teacherId=")) {
    if (url.includes("status=completed")) {
      return { sessions: [row(70, "Final revision", now - 2 * day, "completed")] };
    }
    if (url.includes("status=cancelled")) {
      return { sessions: [row(71, "Cancelled revision", now - day, "cancelled")] };
    }
    if (url.includes("status=live")) {
      return { sessions: [row(72, "Live algebra clinic", now, "live")] };
    }
    return { sessions: teacherUpcoming };
  }
  if (url.includes("studentId=")) return { sessions: studentClass };
  throw new Error(`Unexpected sessions request: ${url}`);
}
