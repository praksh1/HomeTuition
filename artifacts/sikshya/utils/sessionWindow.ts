/**
 * Whether a class can still be opened, decided from what the app already knows.
 *
 * The owner's requirement, and the wording is theirs: "Entering a completed session is a hard
 * No. A tap should say 'Session already Expired. Please create a new one' for anything that
 * was over 3 hours ago. With one tap, the system to check the timestamp and immediately
 * allow/refuse."
 *
 * So this is deliberately local and instant. The list already holds the date, the length and
 * the status, so a tap can be refused without waiting for a round trip — and, more to the
 * point, without opening the classroom first. Opening it is what asked the server for a video
 * room, which created one and set the phone asking for camera and microphone.
 *
 * The server enforces the same window on the room endpoint (api-server/src/lib/sessionStart.ts).
 * This is the courtesy; that is the control. They are kept deliberately identical, and both
 * are tested, because a screen that allows what the server refuses is just a confusing error
 * and a screen that refuses what the server allows locks a teacher out of their own class.
 */

/** Matches RESTART_WINDOW_HOURS on the server. */
export const RESTART_WINDOW_HOURS = 3;

export interface SessionWindowInput {
  date: string | Date;
  duration: number;
  status: string;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
}

function ms(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** When this class finished, or would have finished if left to run. */
export function finishedAt(session: SessionWindowInput): number | null {
  const ended = ms(session.endedAt);
  if (ended !== null) return ended;
  const started = ms(session.startedAt);
  if (started !== null) return started + session.duration * 60_000;
  const scheduled = ms(session.date);
  if (scheduled !== null) return scheduled + session.duration * 60_000;
  return null;
}

export type OpenCheck = { ok: true } | { ok: false; title: string; message: string };

/**
 * Whether tapping this class should open it.
 *
 * A class still running, or one scheduled for later, opens. One that finished inside the
 * window opens, because the teacher may have ended the call by accident. Anything older is
 * refused outright — no navigation, no room request, no camera.
 */
export function canOpenSession(session: SessionWindowInput, now: number = Date.now()): OpenCheck {
  if (session.status === "cancelled") {
    return {
      ok: false,
      title: "Session cancelled",
      message: "This class was cancelled. Please create a new one.",
    };
  }

  const finished = finishedAt(session);
  // A date we cannot read is not a reason to lock a teacher out of their own class; the
  // server still has the final say.
  if (finished === null) return { ok: true };

  if (now - finished > RESTART_WINDOW_HOURS * 3_600_000) {
    return {
      ok: false,
      title: "Session already expired",
      message: "This class ended more than 3 hours ago. Please create a new one.",
    };
  }

  return { ok: true };
}
