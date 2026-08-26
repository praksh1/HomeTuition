/**
 * What happens to a call when the other side is not in it.
 *
 * The owner's rule, from watching it go wrong: *"If a teacher disconnects, the student should
 * be able to still stay active for 5 minutes — and if the teacher has still not rejoined, the
 * message appears... You may stay here for the next 10 minutes or end this call now."* And the
 * same at the other end: a teacher with nobody in the room gets the same 15 minutes.
 *
 * Three reasons this is a file of its own rather than two screens' worth of timers:
 *
 * - There are two classrooms, teacher and student, and a rule about when a call stops that is
 *   written twice will eventually be written differently twice. The same argument the call's
 *   own time limit makes in `sessionWindow.ts`.
 * - It is pure, so the fifteen minutes can be tested in milliseconds instead of waited out.
 * - It is the difference between a disconnect and an ending, and that difference is the whole
 *   bug: the app treated the teacher pressing "End call" and the teacher's connection dropping
 *   as the same event, so a student got "they may rejoin shortly", pressed OK, and was
 *   immediately thrown out with "the teacher has ended this call".
 */

/** How long the call waits before saying anything. A dropped connection usually comes back. */
export const QUIET_MS = 5 * 60_000;

/** How much longer they may stay after being told. */
export const NOTICE_MS = 10 * 60_000;

/** The whole allowance, after which the call ends itself. */
export const TOTAL_MS = QUIET_MS + NOTICE_MS;

export type AlonePhase =
  /** The other side is here. Nothing to say. */
  | { phase: "together" }
  /** Alone, but not long enough to be worth mentioning. */
  | { phase: "quiet" }
  /** Alone long enough to be told, with the time left before the call ends itself. */
  | { phase: "warned"; minutesLeft: number }
  /** The allowance is spent. */
  | { phase: "over" };

/**
 * Where a call stands, given when the other side left.
 *
 * `aloneSince` is null whenever somebody else is in the room — including the moment they come
 * back, which is what silently cancels a warning already on screen. Nothing here decides *who*
 * counts as the other side; the screens do, because for a student it is their teacher and for a
 * teacher it is any student at all.
 */
export function aloneState(aloneSince: number | null, now: number): AlonePhase {
  if (aloneSince === null) return { phase: "together" };

  const gone = now - aloneSince;
  if (gone < QUIET_MS) return { phase: "quiet" };
  if (gone >= TOTAL_MS) return { phase: "over" };

  /*
   * Rounded up, so the last fifty seconds read "1 minute left" rather than "0 minutes left" on
   * a call that is still running. A countdown that reaches zero and keeps going is the kind of
   * detail that makes people distrust the rest of the screen.
   */
  return { phase: "warned", minutesLeft: Math.max(1, Math.ceil((TOTAL_MS - gone) / 60_000)) };
}

/**
 * What to say, in the fewest words that still answer "what do I do now?".
 *
 * The owner asked for something "a little shorter and to the point" than their own draft, and
 * for it to name the way out: the class can be rejoined from the Sessions tab, and the fifteen
 * minutes start again when it is.
 */
export function aloneMessage(waitingFor: "teacher" | "students", minutesLeft: number): string {
  const left = `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`;
  return waitingFor === "teacher"
    ? `Your teacher has not come back. This class will end in ${left}. You can wait, or leave now and rejoin from Sessions.`
    : `Nobody has joined yet. This class will end in ${left}. You can wait, or end now and start it again from Sessions.`;
}
