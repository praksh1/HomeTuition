/**
 * The clock a session page runs on, and what its buttons should say.
 *
 * Pure and dependency-free so it can be tested without a screen, for the reason
 * sessionWindow.ts gives: these rules decide whether somebody can get into a lesson they paid
 * for, and a rule that needs a rendered component to exercise is a rule nobody exercises.
 *
 * The clock is the server's, not the handset's. That is not fussiness — the market here is
 * cheap Android phones, a good number of which have a clock that is minutes or hours out, and
 * every rule on this page is a comparison against a time. A phone that thinks it is 11:40 when
 * it is 11:10 would show its owner that their teacher is half an hour late and offer them a
 * refund for a class that has not started.
 */

/**
 * The server's time, carried forward by how long ago we heard it.
 *
 * `receivedAt` and `now` both come from the same local clock, so the difference between them
 * is a duration and is right even when the clock itself is wrong. Only the *offset* is taken
 * from the server, which is the part the handset cannot know.
 */
export function serverNow(serverTime: string | null, receivedAt: number, now: number): number {
  if (!serverTime) return now;
  const parsed = Date.parse(serverTime);
  if (Number.isNaN(parsed)) return now;
  return parsed + (now - receivedAt);
}

/** "5 minutes", "1 hour 20 minutes", "under a minute" — a duration a person would say aloud. */
export function humanDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** How long until the class, or how long since it should have begun. */
export function countdown(scheduledFor: string | Date, now: number): string {
  const at = new Date(scheduledFor).getTime();
  if (!Number.isFinite(at)) return "";
  if (at > now) return `Starts in ${humanDuration(at - now)}`;
  return `Started ${humanDuration(now - at)} ago`;
}

export interface WaitingState {
  /** What the student should be told about the teacher, in one line. */
  message: string;
  /** True once the wait has been long enough to offer a way to reach somebody. */
  offerHelp: boolean;
}

/**
 * What a waiting student sees.
 *
 * `teacherJoinedAt` answers "is the teacher here"; `teacherIsLate` answers "were they late".
 * They are separate on purpose — a teacher who walks in at minute fifteen is here, and was
 * late, and the student is still owed the way out they were promised at minute ten.
 */
export function waitingState(
  input: {
    teacherJoinedAt: string | null;
    teacherIsLate: boolean;
    teacherLateBy: number | null;
    /** False when the server could not read its own record — which decides nothing. */
    known: boolean;
  },
): WaitingState {
  if (!input.known) {
    return { message: "We could not check whether your teacher has joined.", offerHelp: false };
  }

  if (input.teacherJoinedAt) {
    if (input.teacherIsLate) {
      const late = input.teacherLateBy ?? 0;
      return {
        message: `Your teacher joined ${late} minutes after the start time.`,
        offerHelp: true,
      };
    }
    return { message: "Your teacher has joined.", offerHelp: false };
  }

  if (input.teacherIsLate) {
    const late = input.teacherLateBy;
    return {
      message:
        late === null
          ? "Your teacher has not joined yet."
          : `Your teacher is ${late} minutes late.`,
      offerHelp: true,
    };
  }

  return { message: "Waiting for your teacher to join.", offerHelp: false };
}
