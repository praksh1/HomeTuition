/**
 * The timeline of a class: when its doors open, when they close, and when the call is over.
 *
 * Everything here is measured from the **scheduled** start and the booked length, never from
 * when the teacher happened to press start. That is the owner's rule and it is worth stating
 * plainly, because it has a consequence: a teacher who begins twenty minutes late does not get
 * twenty extra minutes at the end. The call still stops ten minutes after the booked finish.
 * A predictable clock both people can see beats a generous one only the server understands —
 * a student who booked 10:00 to 11:00 needs to know they are free at 11:00.
 *
 * ```
 *   T-10m ─────── T ──────────────── T+duration ── +5m ─────── +10m
 *   doors open   scheduled start     scheduled end  │           │
 *                                                   │           └─ call ends, nobody may reopen
 *                                                   └─ students see "Session Expired"
 * ```
 *
 * Pure and dependency-free, like sessionStaleness.ts and for the same reason: a rule about
 * when a class is over that can only be exercised with a database and a WebSocket hub is a
 * rule nobody tests, and this project has already had that rule written twice, differently.
 */

/**
 * How early the doors open, in minutes before the scheduled start.
 *
 * Long enough that a class opens with people already in it rather than with the teacher
 * talking to an empty room. Was five; the owner raised it to ten.
 */
export const DOORS_OPEN_MINUTES = 10;

/**
 * How long past the scheduled finish a student may still join, in minutes.
 *
 * The owner's rule: "Exactly 5 minutes past the scheduled end time, grey out the button and
 * display 'Session Expired'." Late enough to cover a class that overran slightly, early enough
 * that nobody wanders into the last minute of a lesson they missed.
 */
export const STUDENT_GRACE_MINUTES = 5;

/**
 * When the call stops, in minutes past the scheduled finish.
 *
 * Both the hard cutoff for a call in progress and the last moment a teacher may reopen a class
 * they ended by mistake. One number for both, because they are the same question — is this
 * class still happening? — and answering it twice is how this project ended up with two
 * disagreeing rules before.
 *
 * This replaces a three-hour restart window. Three hours meant a teacher could bring a finished
 * class back to life long after everyone had gone.
 */
export const OVERTIME_CUTOFF_MINUTES = 10;

/**
 * How long before the finish the room is warned, in minutes.
 *
 * Enough to wrap up a thought and set homework, not so much that it interrupts teaching.
 */
export const WRAP_UP_WARNING_MINUTES = 5;

/**
 * How long a live class waits for its teacher before it is treated as finished.
 *
 * Long enough to ride out a phone changing cell or a browser tab being backgrounded — the
 * classroom socket reconnects in well under a second, and its heartbeat notices a dead
 * connection within about 25. Short enough that a teacher who force-quits is not locked out
 * of their own next class for an hour.
 */
export const TEACHER_ABSENCE_MINUTES = 2;

export interface StartableSession {
  date: Date | string;
  duration: number;
  startedAt: Date | string | null;
  /** Set when the class was ended, however it ended. Null for one that never started. */
  endedAt: Date | string | null;
  status: string;
}

function ms(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** When the doors open: `DOORS_OPEN_MINUTES` before the booked start. Null if unreadable. */
/**
 * How far into the past a newly created class may be dated, in minutes.
 *
 * Not zero, because "Create & Go Live Now" sends the current time and a request takes a moment
 * to arrive — a strict comparison would reject the teacher's own clock. Small enough that a
 * class dated yesterday is impossible.
 */
export const BACKDATE_GRACE_MINUTES = 5;

/** Whether a class may be created at this time at all. */
export function isCreatableAt(date: Date | string, now: number = Date.now()): boolean {
  const at = new Date(date).getTime();
  if (!Number.isFinite(at)) return false;
  return at >= now - BACKDATE_GRACE_MINUTES * 60_000;
}

export function doorsOpenAt(session: StartableSession): number | null {
  const scheduled = ms(session.date);
  return scheduled === null ? null : scheduled - DOORS_OPEN_MINUTES * 60_000;
}

/**
 * When the class was booked to finish.
 *
 * The booked slot, not what happened. See the note at the top of this file for why.
 */
export function scheduledEndAt(session: StartableSession): number | null {
  const scheduled = ms(session.date);
  return scheduled === null ? null : scheduled + session.duration * 60_000;
}

/** The moment a class in progress is stopped, and the last moment it may be reopened. */
export function cutoffAt(session: StartableSession): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end + OVERTIME_CUTOFF_MINUTES * 60_000;
}

/** The moment a student's Join button greys out. */
export function studentDoorClosesAt(session: StartableSession): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end + STUDENT_GRACE_MINUTES * 60_000;
}

/** The moment the room should be told five minutes remain. */
export function wrapUpWarningAt(session: StartableSession): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end - WRAP_UP_WARNING_MINUTES * 60_000;
}

export type StartCheck = { ok: true } | { ok: false; reason: string };

/** How long until a time, in words a person would use. */
function inWords(msUntil: number): string {
  const minutes = Math.round(msUntil / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Whether the teacher may take this class live, or get back into one they ended.
 *
 * Two closed doors rather than one. Too early is now a refusal in its own right — a teacher
 * could previously open a class booked for next week and pull anyone who happened to be there
 * into it. Too late is the old rule, tightened from three hours to ten minutes past the booked
 * finish.
 */
export function canStart(session: StartableSession, now: number = Date.now()): StartCheck {
  if (session.status === "cancelled") {
    return { ok: false, reason: "This class was cancelled. Create a new one to teach it again." };
  }

  const opensAt = doorsOpenAt(session);
  // A date we cannot read is not a reason to refuse a teacher their class.
  if (opensAt === null) return { ok: true };

  /**
   * A class held and ended before its own booked slot.
   *
   * Narrow on purpose: only when a finished class is *also* still ahead of its doors, which is
   * the one state where "not open yet" is nonsense to say about a lesson that has been taught.
   * Everything else falls through to the ordinary checks, which say how long ago it finished.
   */
  if (session.status === "completed" && session.startedAt && now < opensAt) {
    return {
      ok: false,
      reason: "This class was opened and ended early. Create a new session for it instead.",
    };
  }

  if (now < opensAt) {
    return {
      ok: false,
      reason:
        `This class opens ${DOORS_OPEN_MINUTES} minutes before it starts — ` +
        `that is in ${inWords(opensAt - now)}.`,
    };
  }

  const cutoff = cutoffAt(session);
  if (cutoff !== null && now > cutoff) {
    return {
      ok: false,
      reason:
        `This class finished ${inWords(now - cutoff)} ago and can no longer be opened. ` +
        `Create a new session for it instead.`,
    };
  }

  return { ok: true };
}

/**
 * Whether a paid student may go into the classroom.
 *
 * Deliberately a wider door than the teacher's in one direction and a narrower one in the
 * other. Wider: it does **not** ask whether the teacher has arrived, because the owner's rule
 * is that a student can go in and wait — "allowing students to join even if the teacher is
 * absent" — and a student sitting in an empty room is exactly the evidence a refund needs.
 * Narrower: it shuts five minutes after the booked finish rather than ten, so a student cannot
 * still be arriving while the room is being closed around them.
 */
export function canJoin(session: StartableSession, now: number = Date.now()): StartCheck {
  if (session.status === "cancelled") {
    return { ok: false, reason: "This class was cancelled." };
  }

  const opensAt = doorsOpenAt(session);
  if (opensAt === null) return { ok: true };

  if (now < opensAt) {
    return {
      ok: false,
      reason:
        `This class opens ${DOORS_OPEN_MINUTES} minutes before it starts — ` +
        `that is in ${inWords(opensAt - now)}.`,
    };
  }

  const closesAt = studentDoorClosesAt(session);
  if (closesAt !== null && now > closesAt) {
    return { ok: false, reason: "Session expired." };
  }

  return { ok: true };
}

/**
 * Whether a live call has run past the point where it is stopped.
 *
 * Read on a timer inside the classroom, so it takes the clock rather than reading it.
 */
export function isPastCutoff(session: StartableSession, now: number = Date.now()): boolean {
  const cutoff = cutoffAt(session);
  return cutoff !== null && now > cutoff;
}

/**
 * Whether a class marked live has lost its teacher.
 *
 * A class that has only just started has not lost anybody — the teacher's socket takes a
 * moment to connect, and treating that gap as absence would end every class at the instant it
 * began.
 */
export function teacherHasGone(
  session: { startedAt: Date | string | null },
  teacherLastSeenAt: Date | string | null,
  now: number = Date.now(),
): boolean {
  const window = TEACHER_ABSENCE_MINUTES * 60_000;

  const started = ms(session.startedAt);
  if (started !== null && now - started < window) return false;

  const seen = ms(teacherLastSeenAt);
  // Never seen, and not newly started: nobody is holding this class open.
  if (seen === null) return started !== null;

  return now - seen > window;
}
