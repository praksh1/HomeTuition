/**
 * What the attendance ledger says happened in a class.
 *
 * Pure and dependency-free, like sessionStart.ts and for the same reason: these are the rules
 * a refund will be argued over, and a rule that can only be exercised with a database and a
 * WebSocket hub is a rule nobody tests.
 *
 * **These functions do not decide anything.** They turn rows into plainly stated findings with
 * the numbers attached, and a person reads them. That is deliberate, and REFUNDS.md says why:
 * the outcome is binary — a full refund or none — the money is somebody's month, and an
 * automatic verdict from a heuristic about socket counts is not a thing this product should
 * ship. A finding says "the teacher's connection dropped 9 times and they were absent for 14
 * of the 60 minutes"; whether that is worth a refund is a judgement, and judgement has an
 * owner.
 */

/**
 * How late a teacher may be before the student is offered a way out.
 *
 * The owner's rule, in his words: "if [the teacher is] more than 10 minutes late, a customer
 * service menu activates". Ten minutes is his number, not a derived one.
 */
export const TEACHER_LATE_MINUTES = 10;

/**
 * How many separate connections stop looking like a person and start looking like a bad line.
 *
 * Nobody rejoins a class four times on purpose. Below this, reconnections are ordinary — a
 * phone changing cell, a tab reloaded, a laptop closed and opened.
 */
export const UNSTABLE_JOIN_COUNT = 4;

/**
 * The share of their own time in the room a person can be missing before absence is the story.
 *
 * A fifth of a lesson is roughly twelve minutes of an hour: long enough that a student would
 * notice and complain, and far beyond a reconnection or two.
 */
export const UNSTABLE_ABSENT_SHARE = 0.2;

export interface ScheduledSession {
  /** When the class was booked to start. */
  date: Date | string;
  /** Its length in minutes. */
  duration: number;
  /** When the teacher actually took it live, if they did. */
  startedAt: Date | string | null;
  /** When it ended, however it ended. */
  endedAt: Date | string | null;
}

/** One person's presence, as the ledger recorded it. */
export interface PresenceRecord {
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

function ms(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * How long a person was missing between arriving and last being seen.
 *
 * The gap between the span they were around for and the time they were actually connected. A
 * person who joined, stayed, and left has no gap; one whose line kept dropping has all of it.
 */
export function absentMs(record: PresenceRecord): number {
  const from = ms(record.firstJoinedAt);
  const to = ms(record.lastSeenAt);
  if (from === null || to === null) return 0;
  return Math.max(0, to - from - record.presentMs);
}

/**
 * How many minutes late the teacher is. Null only when there is no readable start time.
 *
 * Measured against the booked time rather than when the class went live, because going live
 * *is* the teacher arriving — measuring one against the other would make every teacher
 * punctual by definition. Negative means early, and is reported as zero.
 *
 * A teacher who has not arrived at all is late by however long it has been so far, so the
 * number keeps climbing while a student sits waiting. That is what the student's screen needs
 * to show; whether they *ever* came is a separate question, answered by whether there is a
 * presence record at all.
 */
export function teacherMinutesLate(
  session: ScheduledSession,
  teacher: PresenceRecord | null,
  now: number = Date.now(),
): number | null {
  const scheduled = ms(session.date);
  if (scheduled === null) return null;
  const arrived = teacher ? ms(teacher.firstJoinedAt) : null;
  return Math.max(0, Math.round(((arrived ?? now) - scheduled) / 60_000));
}

/**
 * Whether the student has waited long enough to be offered help.
 *
 * Answers for a class in progress, not for one being argued over afterwards, which is why it
 * takes the clock: the student is sitting in a lobby watching a timer, and the question is
 * "has ten minutes passed with no teacher", not "was the teacher late in the end".
 */
export function teacherIsLate(
  session: ScheduledSession,
  teacher: PresenceRecord | null,
  now: number = Date.now(),
): boolean {
  const scheduled = ms(session.date);
  if (scheduled === null) return false;

  const arrived = teacher ? ms(teacher.firstJoinedAt) : null;
  const lateBy = (arrived ?? now) - scheduled;
  return lateBy > TEACHER_LATE_MINUTES * 60_000;
}

/** A statement of fact about a class, with the numbers that support it. */
export interface Finding {
  /** A stable key, so the app can style or group these without matching on English. */
  code:
    | "teacher_never_joined"
    | "teacher_late"
    | "teacher_left_early"
    | "teacher_connection_unstable"
    | "student_never_joined"
    | "student_barely_attended"
    | "board_never_used"
    | "class_never_started";
  /** Who this is about, when it is about one person. */
  userId?: number;
  /** One sentence, in the plain words the owner and a customer-service reader both need. */
  detail: string;
}

/**
 * Everything the ledger can say about one class.
 *
 * Ordered teacher-first, because a refund argument is mostly about the teacher, and a reader
 * with thirty seconds should meet the load-bearing facts first.
 */
export function findingsFor(
  session: ScheduledSession,
  records: PresenceRecord[],
  /**
   * Everyone who paid for a place.
   *
   * Needed separately because the ledger cannot say anything about a person who never opened
   * the class — they have no row in it. "The student never came" is the teacher's side of most
   * refund arguments, and it is only visible as the difference between these two lists.
   */
  expected: { userId: number; name: string }[] = [],
  now: number = Date.now(),
): Finding[] {
  const findings: Finding[] = [];
  const teacher = records.find((r) => r.role === "teacher") ?? null;
  const students = records.filter((r) => r.role === "student");

  if (!session.startedAt) {
    findings.push({
      code: "class_never_started",
      detail: "This class was never taken live.",
    });
  }

  if (!teacher) {
    findings.push({
      code: "teacher_never_joined",
      detail: "The teacher never opened this class.",
    });
  } else {
    const late = teacherMinutesLate(session, teacher, now);
    if (late !== null && late > TEACHER_LATE_MINUTES) {
      findings.push({
        code: "teacher_late",
        userId: teacher.userId,
        detail: `The teacher arrived ${late} minutes after the booked start time.`,
      });
    }

    const away = absentMs(teacher);
    const span = Math.max(1, teacher.presentMs + away);
    if (teacher.joinCount >= UNSTABLE_JOIN_COUNT && away / span >= UNSTABLE_ABSENT_SHARE) {
      findings.push({
        code: "teacher_connection_unstable",
        userId: teacher.userId,
        detail:
          `The teacher's connection dropped and came back ${teacher.joinCount} times, and they ` +
          `were disconnected for ${Math.round(away / 60_000)} of the ${Math.round(span / 60_000)} ` +
          `minutes between arriving and leaving.`,
      });
    }

    // Only meaningful once the class has actually finished; a lesson in progress has not
    // ended early, it has not ended.
    const ended = ms(session.endedAt);
    const scheduled = ms(session.date);
    if (ended !== null && ended <= now && scheduled !== null) {
      const ranFor = Math.round((ended - scheduled) / 60_000);
      // Half a lesson is the line: a class cut a few minutes short is normal teaching, one cut
      // in half is the thing a student is complaining about.
      if (ranFor > 0 && ranFor < session.duration / 2) {
        findings.push({
          code: "teacher_left_early",
          userId: teacher.userId,
          detail: `The class ended after ${ranFor} minutes of a booked ${session.duration}.`,
        });
      }
    }

    if (teacher.drawCount === 0) {
      findings.push({
        code: "board_never_used",
        userId: teacher.userId,
        detail: "Nothing was drawn on the whiteboard during this class.",
      });
    }
  }

  const attended = new Set(students.map((s) => s.userId));
  for (const student of expected) {
    if (!attended.has(student.userId)) {
      findings.push({
        code: "student_never_joined",
        userId: student.userId,
        detail: `${student.name} paid for this class and never opened it.`,
      });
    }
  }

  for (const student of students) {
    // A minute is not a lesson. Long enough to rule out a tap on the wrong card, short enough
    // that nobody who meant to attend lands here.
    if (student.presentMs < 60_000) {
      findings.push({
        code: "student_barely_attended",
        userId: student.userId,
        detail: `${student.name} was in the class for under a minute.`,
      });
    }
  }

  return findings;
}
