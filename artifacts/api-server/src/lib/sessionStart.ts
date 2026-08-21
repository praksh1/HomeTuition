/**
 * May this class be started, and is its teacher still in it?
 *
 * Two rules that were missing entirely, both reported from a real session:
 *
 * 1. A teacher could scroll back to a class from days ago and start it. Some of those showed a
 *    warning and many simply began, which means students could be pulled into a lesson that
 *    was over, and the teacher's list of past work was one tap away from becoming live again.
 *
 * 2. Force-closing the browser left the class "live" with nobody in it. The teacher could then
 *    neither start a new class — "you still have an active session" — nor get back into the
 *    old one. The only way out was to wait for the class's own length to run out.
 *
 * Pure and dependency-free, like sessionStaleness.ts and for the same reason: a rule about
 * when a class is over that can only be exercised with a database and a WebSocket hub is a
 * rule nobody tests, and this project has already had that rule written twice, differently.
 */

/**
 * How long after a class finishes a teacher may still start it again.
 *
 * The owner's reasoning, kept because it is the whole justification for the window existing:
 * a teacher may have ended the call by accident, and should be able to get straight back in.
 * Past that, starting it again is much more likely to be a mistake than an intention.
 */
export const RESTART_WINDOW_HOURS = 3;

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

/**
 * When this class finished, or would have finished if left to run.
 *
 * Prefers what actually happened over what was scheduled, in that order: when it was ended,
 * else when it was started plus its length, else the slot it was booked into. A class started
 * late and still running has a finish time in the future, which is the point.
 */
export function finishedAt(session: StartableSession): number | null {
  const ended = ms(session.endedAt);
  if (ended !== null) return ended;

  const started = ms(session.startedAt);
  if (started !== null) return started + session.duration * 60_000;

  const scheduled = ms(session.date);
  if (scheduled !== null) return scheduled + session.duration * 60_000;

  return null;
}

export type StartCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a teacher may take this class live.
 *
 * A class that is over stays over. The only exception is the window above, which exists for
 * the teacher who hung up by mistake.
 */
export function canStart(session: StartableSession, now: number = Date.now()): StartCheck {
  if (session.status === "cancelled") {
    return { ok: false, reason: "This class was cancelled. Create a new one to teach it again." };
  }

  const finished = finishedAt(session);
  // A date we cannot read is not a reason to refuse a teacher their class.
  if (finished === null) return { ok: true };

  const overBy = now - finished;
  if (overBy > RESTART_WINDOW_HOURS * 3_600_000) {
    const hours = Math.floor(overBy / 3_600_000);
    const when = hours < 24 ? `${hours} hours ago` : `${Math.floor(hours / 24)} days ago`;
    return {
      ok: false,
      reason:
        `This class finished ${when} and can no longer be started. ` +
        `Create a new session for it instead.`,
    };
  }

  return { ok: true };
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
