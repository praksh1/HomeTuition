let reads = 0;
const at = "2026-09-26T10:00:00Z";
export async function apiGet() {
  const mode = new URLSearchParams(location.search).get("mode");
  if (mode === "retry" && reads++ === 0) throw Error("Unavailable");
  return {
    ticket: { id: 1, ref: "HT-000001", reason: "Class connection issue", description: "I could not hear my teacher.", status: "opened", statusLabel: "Opened by an agent", createdAt: at, reporterId: 2, reporterName: "Test student", reporterRole: "student", assignedTo: null },
    session: mode === "unlinked" ? null : { id: 3, topic: "Algebra", subject: "Maths", date: at, duration: 60, status: "ended", teacherName: "Test teacher" },
    attendance: { known: mode !== "unknown", rows: [] },
    caseNarrative: mode === "unlinked" ? null : { sessionId: 3, summary: [{ code: "session", detail: "Scheduled for one hour." }], timeline: [{ at, code: "joined", detail: "A connection was recorded.", source: "classroom-socket" }], unavailable: ["Audio quality was not measured."], sourceNotes: ["A connection is not proof of teaching quality."] },
    findings: [], messages: [{ senderName: "Test student", senderRole: "student", body: "Can you hear me?", createdAt: at }],
    reporterActivity: { known: false, rows: [] },
    history: [{ id: 1, at, status: "opened", label: "Opened by an agent", note: "Investigating connection.", by: "Support" }],
    nextStatuses: [{ value: "processing", label: "Being worked on" }, { value: "resolved", label: "Resolved" }, { value: "denied", label: "Denied" }],
  };
}
export async function apiPatch() { return apiGet(); }
export async function apiPost() { return {}; }
export async function attachmentUrl() { throw Error("Not used"); }
