/**
 * The timeline of a class, as the app sees it.
 *
 * Mirrors artifacts/api-server/src/lib/sessionStart.ts — the two packages deliberately do not
 * share code, so this is the app's copy and the numbers below must match it. They are kept
 * identical and both are tested, because a screen that allows what the server refuses is a
 * confusing error, and a screen that refuses what the server allows locks a teacher out of
 * their own class.
 *
 * ```
 *   T-10m ─────── T ──────────────── T+duration ── +5m ─────── +10m
 *   doors open   scheduled start     scheduled end  │           │
 *                                                   │           └─ call ends, nobody may reopen
 *                                                   └─ students see "Session Expired"
 * ```
 *
 * Everything is measured from the **booked** slot, never from when the teacher pressed start.
 * A teacher who begins twenty minutes late does not get twenty extra minutes: a student who
 * booked 10:00 to 11:00 needs to know they are free at 11:00.
 *
 * Deliberately local and instant. The list already holds the date, the length and the status,
 * so a tap can be refused without waiting for a round trip — and, more to the point, without
 * opening the classroom first. Opening it is what asked the server for a video room, which
 * created one and set the phone asking for camera and microphone.
 */

/** Matches DOORS_OPEN_MINUTES on the server. */
export const DOORS_OPEN_MINUTES = 10;
/** Matches STUDENT_GRACE_MINUTES on the server. */
export const STUDENT_GRACE_MINUTES = 5;
/** Matches OVERTIME_CUTOFF_MINUTES on the server. */
export const OVERTIME_CUTOFF_MINUTES = 10;
/** Matches WRAP_UP_WARNING_MINUTES on the server. */
export const WRAP_UP_WARNING_MINUTES = 5;

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

/** When the doors open: `DOORS_OPEN_MINUTES` before the booked start. */
export function doorsOpenAt(session: SessionWindowInput): number | null {
  const scheduled = ms(session.date);
  return scheduled === null ? null : scheduled - DOORS_OPEN_MINUTES * 60_000;
}

/** When the class was booked to finish — the slot, not what happened. */
export function scheduledEndAt(session: SessionWindowInput): number | null {
  const scheduled = ms(session.date);
  return scheduled === null ? null : scheduled + session.duration * 60_000;
}

/** The moment a class in progress is stopped, and the last moment it may be reopened. */
export function cutoffAt(session: SessionWindowInput): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end + OVERTIME_CUTOFF_MINUTES * 60_000;
}

/** The moment a student's Join button greys out. */
export function studentDoorClosesAt(session: SessionWindowInput): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end + STUDENT_GRACE_MINUTES * 60_000;
}

/** The moment the room should be told five minutes remain. */
export function wrapUpWarningAt(session: SessionWindowInput): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end - WRAP_UP_WARNING_MINUTES * 60_000;
}

export type OpenCheck = { ok: true } | { ok: false; title: string; message: string };

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
 * Whether the teacher may open this class.
 *
 * Mirrors `canStart` on the server. Two closed doors: too early, which is new — a teacher could
 * previously open a class booked for next week — and too late, tightened from three hours past
 * the finish to ten minutes.
 */
export function canOpenSession(session: SessionWindowInput, now: number = Date.now()): OpenCheck {
  if (session.status === "cancelled") {
    return {
      ok: false,
      title: "Session cancelled",
      message: "This class was cancelled. Please create a new one.",
    };
  }

  const opensAt = doorsOpenAt(session);
  // A date we cannot read is not a reason to lock a teacher out of their own class; the
  // server still has the final say.
  if (opensAt === null) return { ok: true };

  /**
   * A class held and ended before its own booked slot.
   *
   * Narrow on purpose: it fires only when a finished class is *also* still ahead of its doors,
   * the one state where "not open yet" is nonsense. A teacher opened a class booked for next
   * week, ended it, and tapping it said the class had not opened yet — about a lesson they had
   * just taught. Everything else falls through to the ordinary checks below, which say how
   * long ago a class finished and are more useful than this.
   */
  if (session.status === "completed" && session.startedAt && now < opensAt) {
    return {
      ok: false,
      title: "Session held and ended",
      message: "This class was opened and ended early. Please create a new one.",
    };
  }

  if (now < opensAt) {
    return {
      ok: false,
      title: "Not open yet",
      message:
        `This class opens ${DOORS_OPEN_MINUTES} minutes before it starts — ` +
        `that is in ${inWords(opensAt - now)}.`,
    };
  }

  const cutoff = cutoffAt(session);
  if (cutoff !== null && now > cutoff) {
    return {
      ok: false,
      title: "Session expired",
      message: "This class is over and can no longer be opened. Please create a new one.",
    };
  }

  return { ok: true };
}

/**
 * Whether a paid student may go into this class.
 *
 * Mirrors `canJoin` on the server, and differs from the teacher's door in both directions on
 * purpose. It never asks whether the teacher has arrived — the owner's rule is that a student
 * goes in and waits, and a student sitting in an empty room is exactly what a refund is argued
 * from. And it shuts five minutes after the booked finish rather than ten, so nobody is still
 * arriving while the room is closed around them.
 */
export function canJoinSession(session: SessionWindowInput, now: number = Date.now()): OpenCheck {
  if (session.status === "cancelled") {
    return { ok: false, title: "Session cancelled", message: "This class was cancelled." };
  }

  const opensAt = doorsOpenAt(session);
  if (opensAt === null) return { ok: true };

  if (now < opensAt) {
    return {
      ok: false,
      title: "Not open yet",
      message:
        `This class opens ${DOORS_OPEN_MINUTES} minutes before it starts — ` +
        `that is in ${inWords(opensAt - now)}.`,
    };
  }

  const closesAt = studentDoorClosesAt(session);
  if (closesAt !== null && now > closesAt) {
    return {
      ok: false,
      title: "Session expired",
      message: "This class is over. If something went wrong, you can report it from Support.",
    };
  }

  return { ok: true };
}

/** Whether a live call has run past the point where it is stopped. */
export function isPastCutoff(session: SessionWindowInput, now: number = Date.now()): boolean {
  const cutoff = cutoffAt(session);
  return cutoff !== null && now > cutoff;
}

export interface StartState {
  /** Whether the button does anything. False means it is shown greyed out, never hidden. */
  enabled: boolean;
  label: string;
  /**
   * Why it is greyed out, shown next to the button rather than only on tapping it.
   *
   * The owner asked for the button to be *grey*, not merely to refuse: a teacher who has to
   * tap something to be told it will not work has already been given a reason to think the app
   * is broken.
   */
  reason: string | null;
}

/**
 * What the teacher's button on a session page should look like right now.
 *
 * Named "Open the Session" rather than "Start", at the owner's request — opening the room and
 * going live are the same action here, but the teacher is opening a door, not launching
 * something irreversible.
 */
export function startState(session: SessionWindowInput, now: number = Date.now()): StartState {
  const check = canOpenSession(session, now);
  if (!check.ok) {
    return {
      enabled: false,
      label: session.status === "cancelled" ? "Cancelled" : "Session expired",
      reason: check.message,
    };
  }

  if (session.status === "live") return { enabled: true, label: "Rejoin the session", reason: null };
  if (session.status === "completed") {
    // Inside the window a finished class can still be reopened, because the teacher may have
    // ended the call by accident — that is the whole reason the window exists. Named so it is
    // obvious this is a recovery, not a fresh start.
    return { enabled: true, label: "Reopen the session", reason: null };
  }
  return { enabled: true, label: "Open the Session", reason: null };
}

/** What the student's button should look like right now. */
export function joinState(session: SessionWindowInput, now: number = Date.now()): StartState {
  const check = canJoinSession(session, now);
  if (!check.ok) {
    return {
      enabled: false,
      label: session.status === "cancelled" ? "Cancelled" : "Session Expired",
      reason: check.message,
    };
  }
  return { enabled: true, label: "Join the Class", reason: null };
}

export interface CallTimeState {
  /** True once the class is inside its last five minutes and should be told so. */
  pastWarning: boolean;
  /** True once the call has run past the point where it is stopped. */
  overtime: boolean;
  /** Whole minutes until the booked finish. Zero once it has passed; never negative. */
  minutesLeft: number;
}

/**
 * Where a running call sits against its own clock.
 *
 * Pure, so the two things that happen to a call as it runs out of time can be tested without
 * mounting a classroom: the five-minute warning, and the hard stop ten minutes past the booked
 * finish. The hook that uses this (hooks/useCallTimeLimit.ts) is then only timers and a
 * dismiss button, which is the part that genuinely needs React.
 *
 * `now` is the **server's** clock. A handset twenty minutes fast would otherwise cut a lesson
 * short twenty minutes early, which on this app's target market is not a hypothetical.
 */
export function callTimeState(session: SessionWindowInput, now: number): CallTimeState {
  const warnAt = wrapUpWarningAt(session);
  const stopAt = cutoffAt(session);
  const endsAt = scheduledEndAt(session);

  return {
    pastWarning: warnAt !== null && now >= warnAt,
    overtime: stopAt !== null && now > stopAt,
    minutesLeft: endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 60_000)),
  };
}
