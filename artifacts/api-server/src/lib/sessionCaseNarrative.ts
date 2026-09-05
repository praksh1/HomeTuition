/**
 * A customer-care account of one class, written from stored facts rather than event codes.
 *
 * This file is deliberately dependency-free. Refund evidence needs tests that can pin the clock
 * and read every sentence. It does not decide a refund and it does not turn missing telemetry into
 * a claim that something did not happen.
 */

export interface CaseSession {
  id: number;
  teacherId: number;
  teacherName: string;
  subject: string;
  topic: string;
  date: Date | string;
  duration: number;
  price: number;
  status: string;
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CaseAttendance {
  userId: number;
  name: string;
  role: "teacher" | "student";
  firstJoinedAt: Date | string;
  lastSeenAt: Date | string;
  presentMs: number;
  joinCount: number;
  drawCount: number;
  messageCount: number;
}

export interface CaseEnrollment {
  userId: number;
  name: string;
  enrolledAt: Date | string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentReference: string | null;
}

export interface CaseScheduleChange {
  previousDate: Date | string;
  newDate: Date | string;
  affectedStudents: number;
  changedAt: Date | string;
}

export interface CaseMessage {
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: Date | string;
}

export interface CaseNarrativeLine {
  code: string;
  detail: string;
}

export interface CaseTimelineEntry {
  at: string;
  code: string;
  detail: string;
  source: "session" | "booking" | "message" | "classroom-socket";
}

export interface SessionCaseNarrative {
  sessionId: number;
  summary: CaseNarrativeLine[];
  timeline: CaseTimelineEntry[];
  unavailable: string[];
}

export interface NarrativeInput {
  session: CaseSession;
  reporterId: number | null;
  attendanceKnown: boolean;
  attendance: CaseAttendance[];
  enrollments: CaseEnrollment[];
  scheduleChanges: CaseScheduleChange[];
  messages: CaseMessage[];
  formatTime?: (value: Date | string) => string;
}

function atMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultFormatTime(value: Date | string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "an unreadable time";
  return new Intl.DateTimeFormat("en-NP", {
    timeZone: "Asia/Kathmandu",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed) + " Nepal time";
}

function quote(value: string, limit = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  const shortened = clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
  return `“${shortened}”`;
}

function minutes(ms: number): number {
  return Math.max(0, Math.round(ms / 60_000));
}

function timingSentence(actualMs: number, expectedMs: number, subject: string): string {
  const delta = Math.round((actualMs - expectedMs) / 60_000);
  if (Math.abs(delta) <= 1) return `${subject} on time.`;
  if (delta > 0) return `${subject} ${delta} minutes late.`;
  return `${subject} ${Math.abs(delta)} minutes early.`;
}

function paymentSentence(
  enrollment: CaseEnrollment,
  amount: number,
  formatTime: (value: Date | string) => string,
): string {
  const who = enrollment.name;
  const when = formatTime(enrollment.enrolledAt);
  if (enrollment.paymentStatus === "test") {
    return `${who} received operator-granted test access on ${when}. No payment was processed.`;
  }
  if (enrollment.paymentStatus === "paid") {
    const method = enrollment.paymentMethod ? ` through ${enrollment.paymentMethod}` : "";
    if (enrollment.paymentReference) {
      return (
        `Sikshya's booking record marks NPR ${amount} from ${who} as paid on ${when}${method} ` +
        `and stores provider reference ${enrollment.paymentReference}. This page has not ` +
        "independently reconciled that reference with the payment provider."
      );
    }
    return (
      `Sikshya's booking record marks NPR ${amount} from ${who} as paid on ${when}${method}, ` +
      "but no provider receipt reference is stored, so payment settlement is not independently confirmed here."
    );
  }
  if (enrollment.paymentStatus === "refunded") {
    return `${who}'s booking record is marked refunded. Check the refund record and payment reference before relying on the amount.`;
  }
  return `${who} has a booking record with status ${quote(enrollment.paymentStatus)}. It is not proof of a completed payment.`;
}

/** Build the readable summary and its inspectable event trail for one unique session. */
export function buildSessionCaseNarrative(input: NarrativeInput): SessionCaseNarrative {
  const { session } = input;
  const formatTime = input.formatTime ?? defaultFormatTime;
  const scheduledMs = atMs(session.date);
  const scheduledEndMs = scheduledMs === null ? null : scheduledMs + session.duration * 60_000;
  const summary: CaseNarrativeLine[] = [];
  const timeline: CaseTimelineEntry[] = [];

  summary.push({
    code: "created",
    detail:
      `${session.teacherName} created session #${session.id} on ${formatTime(session.createdAt)} ` +
      `to teach ${quote(session.topic)} in ${session.subject}. It is currently scheduled for ` +
      `${formatTime(session.date)} for ${session.duration} minutes.`,
  });
  timeline.push({
    at: new Date(session.createdAt).toISOString(),
    code: "session_created",
    detail: `${session.teacherName} created the class ${quote(session.topic)} (${session.subject}).`,
    source: "session",
  });

  if (input.scheduleChanges.length === 0) {
    summary.push({
      code: "schedule_unchanged",
      detail: "No date or time change is recorded for this session. Other wording edits are not historically retained.",
    });
  } else {
    const last = input.scheduleChanges[input.scheduleChanges.length - 1];
    summary.push({
      code: "schedule_changed",
      detail:
        `The teacher changed this session's date or time ${input.scheduleChanges.length} ` +
        `${input.scheduleChanges.length === 1 ? "time" : "times"}. The latest change was on ` +
        `${formatTime(last.changedAt)}, from ${formatTime(last.previousDate)} to ${formatTime(last.newDate)}.`,
    });
    for (const change of input.scheduleChanges) {
      timeline.push({
        at: new Date(change.changedAt).toISOString(),
        code: "schedule_changed",
        detail:
          `The teacher moved the class from ${formatTime(change.previousDate)} to ` +
          `${formatTime(change.newDate)}. ${change.affectedStudents} paid ` +
          `${change.affectedStudents === 1 ? "student was" : "students were"} affected.`,
        source: "session",
      });
    }
  }

  const reporterEnrollment = input.reporterId === null
    ? null
    : input.enrollments.find((row) => row.userId === input.reporterId) ?? null;
  if (reporterEnrollment) {
    summary.push({
      code: "reporter_booking",
      detail: paymentSentence(reporterEnrollment, session.price, formatTime),
    });
  } else if (input.reporterId !== null) {
    summary.push({
      code: "reporter_booking_missing",
      detail: "No booking record for the person who filed this request was found on this session.",
    });
  }

  for (const enrollment of input.enrollments) {
    timeline.push({
      at: new Date(enrollment.enrolledAt).toISOString(),
      code: "student_enrolled",
      detail: paymentSentence(enrollment, session.price, formatTime),
      source: "booking",
    });
  }

  const bookedBeforeStart = scheduledMs === null
    ? []
    : input.enrollments.filter((row) => {
      const enrolled = atMs(row.enrolledAt);
      return enrolled !== null && enrolled <= scheduledMs && (row.paymentStatus === "paid" || row.paymentStatus === "test");
    });
  summary.push({
    code: "booked_students",
    detail:
      `${bookedBeforeStart.length} ${bookedBeforeStart.length === 1 ? "student had" : "students had"} ` +
      "a paid or operator-granted test place before the scheduled start.",
  });

  const teacherMessages = input.messages.filter((message) => {
    const sent = atMs(message.createdAt);
    return message.senderRole === "teacher" && scheduledMs !== null && sent !== null && sent < scheduledMs;
  });
  if (teacherMessages.length > 0) {
    const latest = teacherMessages[teacherMessages.length - 1];
    summary.push({
      code: "teacher_message_before_class",
      detail:
        `The teacher sent ${teacherMessages.length} class-thread ` +
        `${teacherMessages.length === 1 ? "message" : "messages"} before the scheduled start. ` +
        `The latest, at ${formatTime(latest.createdAt)}, said ${quote(latest.body)}`,
    });
  } else {
    summary.push({
      code: "no_teacher_message_before_class",
      detail: "No teacher message is recorded in the persistent class thread before the scheduled start.",
    });
  }
  for (const message of input.messages) {
    timeline.push({
      at: new Date(message.createdAt).toISOString(),
      code: "class_message_sent",
      detail: `${message.senderName} (${message.senderRole}) wrote ${quote(message.body)}.`,
      source: "message",
    });
  }

  const startedMs = atMs(session.startedAt);
  if (startedMs !== null && scheduledMs !== null) {
    summary.push({
      code: "class_started",
      detail:
        `The class was taken live on ${formatTime(session.startedAt!)}. ` +
        timingSentence(startedMs, scheduledMs, "That was"),
    });
    timeline.push({
      at: new Date(session.startedAt!).toISOString(),
      code: "class_started",
      detail: "The teacher took the Sikshya classroom live.",
      source: "session",
    });
  } else {
    summary.push({ code: "class_not_started", detail: "No class-start time is recorded." });
  }

  if (!input.attendanceKnown) {
    summary.push({
      code: "attendance_unavailable",
      detail: "The classroom attendance ledger could not be read. This is not evidence that nobody attended.",
    });
  } else {
    const teacher = input.attendance.find((row) => row.role === "teacher") ?? null;
    if (!teacher) {
      summary.push({
        code: "teacher_not_in_ledger",
        detail: "The classroom socket ledger has no teacher attendance record for this session.",
      });
    } else {
      const joinedMs = atMs(teacher.firstJoinedAt);
      const lastSeenMs = atMs(teacher.lastSeenAt);
      const disconnectedMs = joinedMs === null || lastSeenMs === null
        ? 0
        : Math.max(0, lastSeenMs - joinedMs - teacher.presentMs);
      summary.push({
        code: "teacher_attendance",
        detail:
          `The teacher's authenticated classroom connection first appeared on ` +
          `${formatTime(teacher.firstJoinedAt)} and was present for about ${minutes(teacher.presentMs)} minutes. ` +
          `The ledger recorded ${Math.max(0, teacher.joinCount - 1)} reconnections and about ` +
          `${minutes(disconnectedMs)} disconnected minutes between first arrival and last sighting.`,
      });
      summary.push({
        code: "teacher_classroom_activity",
        detail:
          `The teacher produced ${teacher.drawCount} accepted whiteboard ` +
          `${teacher.drawCount === 1 ? "change" : "changes"} and ${teacher.messageCount} in-class chat ` +
          `${teacher.messageCount === 1 ? "message" : "messages"}. The current ledger does not store ` +
          "the first drawing time, clears, or tool types.",
      });
    }

    for (const person of input.attendance) {
      timeline.push({
        at: new Date(person.firstJoinedAt).toISOString(),
        code: "participant_first_seen",
        detail:
          `${person.name} (${person.role}) first opened the classroom. The socket ledger records ` +
          `${minutes(person.presentMs)} minutes present across ${person.joinCount} ` +
          `${person.joinCount === 1 ? "connection" : "connections"}.`,
        source: "classroom-socket",
      });
    }
  }

  const endedMs = atMs(session.endedAt);
  if (endedMs !== null && scheduledEndMs !== null) {
    summary.push({
      code: "class_ended",
      detail:
        `The class was marked ended on ${formatTime(session.endedAt!)}. ` +
        timingSentence(endedMs, scheduledEndMs, "That was"),
    });
    timeline.push({
      at: new Date(session.endedAt!).toISOString(),
      code: "class_ended",
      detail: "Sikshya marked the classroom ended.",
      source: "session",
    });
  } else {
    summary.push({ code: "class_end_unavailable", detail: "No class-end time is recorded." });
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    sessionId: session.id,
    summary,
    timeline,
    unavailable: [
      "Camera, microphone, reactions, hand-raise and screen-share state are not recorded by Sikshya.",
      "Message read/seen receipts are not stored, so this record cannot say who read a message.",
      "The first whiteboard stroke, clear actions and per-tool use are not stored; only accepted change counts are available.",
      "Connection-quality labels such as strong, moderate or weak are not collected yet. Reconnects and socket gaps are available.",
      "A stored payment status or reference is not independent confirmation that the payment provider settled the money.",
      "The current attendance record proves the authenticated Sikshya classroom socket was open; it does not by itself prove usable Daily audio or video.",
    ],
  };
}

