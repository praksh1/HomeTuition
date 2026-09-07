/**
 * When a Monthly class may open its discussion.
 *
 * ## One timeline, and this joins it rather than starting a second one
 *
 * `lib/sessionStart.ts` already owns the clock a class runs on: doors ten minutes before, a
 * student's Join greying out five minutes after the booked finish, the hard cutoff ten minutes
 * after that. Every one of those is measured from the **booked slot**, never from when the
 * teacher pressed start, and CLAUDE.md records why: a teacher who begins twenty minutes late
 * does not get twenty extra minutes, because a student who booked 10:00 to 11:00 needs to know
 * they are free at 11:00.
 *
 * The discussion window is the same rule one more time. It opens twenty minutes before the
 * booked finish and closes with the class. A late teacher gets a shorter discussion, not a
 * later one — which is the correct answer commercially as well as technically, since the
 * student paid for a slot rather than for a duration starting whenever the teacher arrived.
 *
 * ## The clock is the server's
 *
 * `now` is passed in and every caller passes the server's own time. A phone whose clock is half
 * an hour fast must not be able to open a discussion early, and this project has already been
 * bitten by device clocks once — the class page takes its time from the server for exactly that
 * reason. Nothing here reads `Date.now()` implicitly.
 */
// Named with its extension so `--experimental-strip-types` can resolve it, which is what the
// api-server tsconfig turns `allowImportingTsExtensions` on for. Nothing is emitted from here
// by tsc — the build is esbuild — so the extension never reaches runtime JavaScript.
import { scheduledEndAt, type StartableSession } from "../sessionStart.ts";

/** How long before the booked finish the discussion may be opened. */
export const DISCUSSION_WINDOW_MINUTES = 20;

/**
 * The instant "Start discussion" becomes available.
 *
 * Null when the session has no usable time, which is the same answer the rest of the timeline
 * gives — a class with no date has no window, rather than a window at the epoch.
 */
export function discussionOpensAt(session: StartableSession): number | null {
  const end = scheduledEndAt(session);
  return end === null ? null : end - DISCUSSION_WINDOW_MINUTES * 60_000;
}

export type WindowCheck =
  | { open: true }
  | { open: false; code: "no-schedule" | "too-early" | "finished"; reason: string; opensAt: number | null };

/**
 * May the discussion be opened right now?
 *
 * Separate from eligibility on purpose. "Not yet" and "not on this plan" are different answers
 * and a teacher acts on them differently — one is a wait, the other is never. Collapsing them
 * into one boolean is the mistake `refusals-must-name-their-reason.md` was written about.
 *
 * `cutoff` is the class's own hard stop, passed in rather than recomputed so this cannot drift
 * from the single timeline it belongs to.
 */
export function discussionWindow(
  session: StartableSession,
  cutoff: number | null,
  now: number,
): WindowCheck {
  const opensAt = discussionOpensAt(session);
  if (opensAt === null) {
    return { open: false, code: "no-schedule", reason: "This class has no scheduled time.", opensAt: null };
  }
  if (cutoff !== null && now >= cutoff) {
    return { open: false, code: "finished", reason: "This class is over.", opensAt };
  }
  if (now < opensAt) {
    return {
      open: false,
      code: "too-early",
      reason: `Discussion opens in the last ${DISCUSSION_WINDOW_MINUTES} minutes of the class.`,
      opensAt,
    };
  }
  return { open: true };
}

/**
 * How long is left, for a teacher's own display.
 *
 * Returned as milliseconds rather than a formatted string: the app formats, and it already owns
 * both calendars. A server sending "in 12 minutes" would be a third place that has to know how
 * Fadko writes a time.
 */
export function discussionOpensIn(session: StartableSession, now: number): number | null {
  const at = discussionOpensAt(session);
  return at === null ? null : Math.max(0, at - now);
}
