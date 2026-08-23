/**
 * Changing a class after people have paid for it, and getting out of one.
 *
 * The owner's policy, in one place and pure, for the reason sessionStart.ts is pure: these
 * decide whether somebody gets their money back, and a rule about money that can only be
 * exercised with a database is a rule nobody tests.
 *
 * ```
 *   ← 5 edits/month →
 *   ─────────────────────┬──────────────┬──────────────── T
 *      teacher may        │  locked      │
 *      move the class     │              │
 *                    T-48h              T-24h
 *                         └ students may still drop ┘
 * ```
 *
 * Two ways out, and they are not the same thing:
 *
 * - **The teacher moved it.** Not the student's doing, so the refund is the whole price. The
 *   window is 24 hours from the change; because a class cannot be moved inside 48 hours, that
 *   window always closes at or before the ordinary drop deadline.
 * - **The student changed their mind.** Half back. The other half is split: a quarter to the
 *   teacher, who held the slot, and a quarter to the platform.
 *
 * A third way is the teacher calling the class off entirely. Same cause as moving it, so the
 * same answer — everything back — and deliberately *not* rationed the way moving is. A teacher
 * who is ill has to be able to cancel; making them keep a class they cannot teach in order to
 * stay inside a quota would be worse for everybody in it.
 *
 * A fourth exists and is not decided here: a support agent can grant a full refund for
 * something outside anybody's control. That is a person's judgement and lives with the person.
 */

/** How close to the start a class stops being movable, in hours. */
export const RESCHEDULE_LOCK_HOURS = 48;

/**
 * How far ahead a class must be moved *to*, in hours.
 *
 * Without this the promise of 24 hours to decide can be broken by moving a class forward: a
 * lesson pushed from next Friday to tomorrow leaves nobody time to react. Same number as the
 * lock, so the rule reads as one thing — a class always sits at least two days away from any
 * change made to it.
 */
export const RESCHEDULE_MIN_NOTICE_HOURS = 48;

/** How long before the start a student may still drop, in hours. */
export const DROP_DEADLINE_HOURS = 24;

/** How long a schedule change entitles the affected students to a full refund, in hours. */
export const SCHEDULE_CHANGE_REFUND_HOURS = 24;

/**
 * How many schedule changes a teacher gets each calendar month.
 *
 * Counted per *change*, not per class: moving one lesson five times spends the whole
 * allowance. The owner was explicit — "strictly 5 edits for any session - this way the teacher
 * is not abusing the system". Other details stay editable; only the date and time are capped.
 */
export const SCHEDULE_EDITS_PER_MONTH = 5;

/** What a student gets back when the decision is theirs. */
export const STUDENT_DROP_REFUND_SHARE = 0.5;
/** What the teacher keeps for having held the slot. */
export const TEACHER_CANCELLATION_SHARE = 0.25;
/** What the platform keeps. A cancellation fee — not a processing fee, which is 2-3%. */
export const PLATFORM_CANCELLATION_SHARE = 0.25;

export interface ScheduledClass {
  date: Date | string;
  status: string;
}

function ms(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export type Allowed = { ok: true } | { ok: false; reason: string };

/** How long until a time, in words a person would use. */
function inWords(msUntil: number): string {
  const hours = Math.round(msUntil / 3_600_000);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * May this class still be moved?
 *
 * Refuses inside the lock, and refuses outright for a class that has been held or cancelled —
 * moving a lesson that already happened is not rescheduling, it is rewriting history, and the
 * students who attended it would be told their class had moved.
 */
export function canReschedule(session: ScheduledClass, now: number = Date.now()): Allowed {
  if (session.status === "cancelled") {
    return { ok: false, reason: "This class was cancelled." };
  }
  if (session.status === "completed" || session.status === "live") {
    return { ok: false, reason: "This class has already been held and cannot be moved." };
  }

  const starts = ms(session.date);
  if (starts === null) return { ok: true };

  const locksAt = starts - RESCHEDULE_LOCK_HOURS * 3_600_000;
  if (now >= locksAt) {
    return {
      ok: false,
      reason:
        `A class can only be moved more than ${RESCHEDULE_LOCK_HOURS} hours before it starts. ` +
        `This one starts in ${inWords(Math.max(0, starts - now))}.`,
    };
  }
  return { ok: true };
}

/** Is this a time a class may be moved *to*? */
export function isAcceptableNewDate(newDate: Date | string, now: number = Date.now()): Allowed {
  const at = ms(newDate);
  if (at === null) return { ok: false, reason: "That is not a date we can read." };

  const earliest = now + RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000;
  if (at < earliest) {
    return {
      ok: false,
      reason:
        `A moved class must be at least ${RESCHEDULE_MIN_NOTICE_HOURS} hours away, so the ` +
        `students who booked it have time to decide whether the new time suits them.`,
    };
  }
  return { ok: true };
}

/** Has the schedule actually moved? Only the date and time count — not the topic or the price. */
export function scheduleMoved(previous: Date | string, next: Date | string): boolean {
  const a = ms(previous);
  const b = ms(next);
  if (a === null || b === null) return false;
  return a !== b;
}

/** Whether a teacher has any of this month's changes left. */
export function hasEditsLeft(usedThisMonth: number): Allowed {
  if (usedThisMonth < SCHEDULE_EDITS_PER_MONTH) return { ok: true };
  return {
    ok: false,
    reason:
      `You have already moved ${SCHEDULE_EDITS_PER_MONTH} classes this month, which is the ` +
      `limit. You can still change everything else about a class — just not its time.`,
  };
}

/** May this student still drop out? */
export function canDrop(session: ScheduledClass, now: number = Date.now()): Allowed {
  if (session.status === "cancelled") {
    return { ok: false, reason: "This class was cancelled." };
  }

  const starts = ms(session.date);
  if (starts === null) return { ok: true };

  const deadline = starts - DROP_DEADLINE_HOURS * 3_600_000;
  if (now >= deadline) {
    return {
      ok: false,
      reason:
        `Classes can only be dropped more than ${DROP_DEADLINE_HOURS} hours before they ` +
        `start. If something went wrong, you can still report it from Support.`,
    };
  }
  return { ok: true };
}

/**
 * Whether a student is still inside the full-refund window opened by the teacher moving the
 * class. Null when the class has never been moved.
 */
export function inScheduleChangeWindow(
  lastChangedAt: Date | string | null,
  now: number = Date.now(),
): boolean {
  const changed = ms(lastChangedAt);
  if (changed === null) return false;
  return now < changed + SCHEDULE_CHANGE_REFUND_HOURS * 3_600_000;
}

export type RefundReason =
  | "schedule_change"
  | "teacher_cancelled"
  | "student_drop"
  | "agent_discretion";

export interface RefundSplit {
  /** What goes back to the student. */
  studentRefund: number;
  /** What the teacher keeps for holding the slot. */
  teacherShare: number;
  /** What the platform keeps. */
  platformShare: number;
  reason: RefundReason;
}

/**
 * How a cancelled booking's money is divided.
 *
 * Whole rupees throughout, and the student is rounded *up*: a 50% split of an odd price has to
 * put its stray rupee somewhere, and it should not be taken from the person getting a refund.
 * The shares are then whatever is left, so the three parts always add back to the price and no
 * arithmetic can invent or lose money.
 */
export function refundSplit(price: number, reason: RefundReason): RefundSplit {
  const total = Math.max(0, Math.round(price));

  if (reason === "schedule_change" || reason === "teacher_cancelled" || reason === "agent_discretion") {
    // Not the student's doing: all of it back, and nobody keeps a share.
    return { studentRefund: total, teacherShare: 0, platformShare: 0, reason };
  }

  const studentRefund = Math.ceil(total * STUDENT_DROP_REFUND_SHARE);
  const remainder = total - studentRefund;
  const teacherShare = Math.round(remainder * (TEACHER_CANCELLATION_SHARE / (TEACHER_CANCELLATION_SHARE + PLATFORM_CANCELLATION_SHARE)));
  return {
    studentRefund,
    teacherShare,
    platformShare: remainder - teacherShare,
    reason,
  };
}
