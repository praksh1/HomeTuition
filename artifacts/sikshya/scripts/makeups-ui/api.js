const query = new URLSearchParams(location.search);
const role = query.has("operator")
  ? "admin"
  : query.has("teacher")
    ? "teacher"
    : "student";
const actions = {
  withdraw: false,
  offer: false,
  reject: false,
  accept: false,
  decline: false,
  confirmDelivery: false,
  resolve: false,
};
const pending = {
  id: 7,
  status: "requested",
  reason: "student_missed",
  teacherNonDeliveryConfirmed: false,
  requestedAt: "2026-09-30T01:00:00Z",
  replacementDeadlineAt: "2026-10-30T04:15:00Z",
  replacementReviewClosesAt: null,
  outcome: null,
  requestNote: "I have a school activity and need another date.",
  teacherDecisionReason: null,
  offer: null,
  actions: {
    ...actions,
    withdraw: role === "student",
    offer: role === "teacher",
    reject: role === "teacher",
    resolve: role === "admin",
  },
};
const data = {
  enabled: !query.has("disabled"),
  role,
  serverNow: "2026-09-30T03:15:00Z",
  quotas: [
    {
      bookingId: 10,
      batchId: 12,
      classTitle: "Mathematics · Synthetic test",
      limit: 2,
      used: 0,
      remaining: 2,
      noRollover: true,
    },
  ],
  lessons: [
    {
      bookingId: 10,
      batchId: 12,
      classTitle: "Mathematics · Synthetic test",
      originalPosition: 4,
      originalSessionId: 105,
      title: "Lesson 5",
      startsAt: "2026-09-30T03:15:00Z",
      endsAt: "2026-09-30T04:15:00Z",
      studentName: "Synthetic Student",
      canRequest: role === "student",
      canReportTeacherMissed: role === "student",
      quota: { limit: 2, used: 0, remaining: 2 },
      case: null,
    },
  ],
};
if (query.has("pending") || role !== "student") {
  data.lessons[0].case = pending;
  data.lessons[0].canRequest = false;
  data.lessons[0].canReportTeacherMissed = false;
  data.quotas[0].used = 1;
  data.quotas[0].remaining = 1;
}
if (query.has("teacher-missed")) data.lessons[0].case.reason = "teacher_missed";
if (query.has("offered") || query.has("accepted")) {
  data.lessons[0].canRequest = false;
  data.lessons[0].canReportTeacherMissed = false;
  data.lessons[0].case = {
    ...pending,
    status: query.has("accepted") ? "accepted" : "offered",
    offer: {
      id: 9,
      status: query.has("accepted") ? "accepted" : "proposed",
      startsAt: "2026-10-01T03:15:00Z",
      endsAt: "2026-10-01T04:15:00Z",
      expiresAt: "2026-10-01T03:15:00Z",
      replacementSessionId: query.has("accepted") ? 200 : null,
    },
    actions: {
      ...actions,
      accept: !query.has("accepted") && role === "student",
      decline: !query.has("accepted") && role === "student",
      resolve: role === "admin",
    },
  };
}
if (query.has("full-quota")) {
  data.quotas[0].used = 2;
  data.quotas[0].remaining = 0;
  data.lessons[0].canRequest = false;
  data.lessons[0].disallowedReason =
    "Your courtesy make-up allowance for this purchase is used. Refund review remains available.";
  data.lessons[0].quota = { limit: 2, used: 2, remaining: 0 };
}
if (query.has("history")) {
  data.lessons[0].case = {
    ...pending,
    status: "resolved",
    outcome: "replacement_delivered",
    actions,
  };
  data.lessons[0].canRequest = false;
  data.lessons[0].canReportTeacherMissed = false;
}
if (query.has("disabled")) {
  data.lessons[0].canRequest = false;
  data.lessons[0].canReportTeacherMissed = false;
  if (data.lessons[0].case) data.lessons[0].case.actions = actions;
}
window.requests = [];
window.fixture = data;
export async function apiGet(path) {
  window.requests.push({ method: "GET", path });
  if (query.has("load-failed"))
    throw new Error("Synthetic temporary load failure");
  return structuredClone(data);
}
export async function apiPost(path, body) {
  window.requests.push({ method: "POST", path, body });
  if (
    query.has("retry") &&
    window.requests.filter((item) => item.method === "POST").length === 1
  )
    throw new Error("Synthetic request timed out. Please retry.");
  if (path.endsWith("makeup-request")) {
    data.lessons[0].case = { ...pending, reason: body.reason };
    data.lessons[0].canRequest = false;
    data.lessons[0].canReportTeacherMissed = false;
    data.quotas[0].used++;
    data.quotas[0].remaining--;
  } else if (path.endsWith("/accept")) {
    data.lessons[0].case.status = "accepted";
    data.lessons[0].case.offer.status = "accepted";
    data.lessons[0].case.offer.replacementSessionId = 200;
    data.lessons[0].case.actions = actions;
  } else if (path.endsWith("/withdraw")) {
    data.lessons[0].case.status = "withdrawn";
    data.lessons[0].case.actions = actions;
  } else if (path.endsWith("/resolve")) {
    data.lessons[0].case.status =
      body.outcome === "replacement_delivered"
        ? "delivered_review"
        : "review_required";
    if (body.outcome === "replacement_delivered")
      data.lessons[0].case.replacementReviewClosesAt = "2026-10-03T04:15:00Z";
    data.lessons[0].case.outcome = body.outcome;
    data.lessons[0].case.actions = actions;
  } else if (path.endsWith("/offer")) {
    data.lessons[0].case.status = "offered";
    data.lessons[0].case.offer = {
      id: 9,
      status: "proposed",
      startsAt: body.startsAt,
      endsAt: new Date(Date.parse(body.startsAt) + 3600000).toISOString(),
      expiresAt: body.startsAt,
      replacementSessionId: null,
    };
  }
  return {
    caseId: 7,
    batchId: 12,
    originalSessionId: 105,
    replacementSessionId:
      data.lessons[0].case?.offer?.replacementSessionId ?? null,
  };
}
