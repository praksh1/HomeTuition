/**
 * Reading the server's answer when it will not open a classroom.
 *
 * Both classrooms asked the same question and got it wrong the same way. Every timing refusal
 * arrived as a 409 with `expired: true`, so both treated "you are twenty minutes early" exactly
 * like "this finished on Tuesday": the student's screen went to an ending, and the teacher's
 * offered **"Session already expired — create a new session."** A teacher who opened their own
 * class fifteen minutes before the doors was told to throw it away and build another one.
 *
 * The server now says which kind of refusal it is. This file is the one place that reads it, so
 * the two screens cannot drift apart again — the same argument `sessionWindow.ts` makes about the
 * clock itself, one level up.
 *
 * Pure, and importing nothing, so every branch can be tested without a server or a render.
 */

export type RoomRefusalKind =
  /** The door has not opened yet, and it will. Nothing is wrong and nothing is over. */
  | "waiting"
  /** Genuinely elapsed, or cancelled. This is the one that ends a screen. */
  | "over"
  /** Not a timing answer at all — no room, a network failure, a provider that is down. */
  | "error";

export interface RoomRefusal {
  kind: RoomRefusalKind;
  /** What to show. The server's own sentence when it has one, because it is more specific. */
  message: string;
  /**
   * Unix ms when the door opens, on `waiting` only.
   *
   * Present so a waiting screen can come back at the exact moment rather than polling — and so
   * it never asks somebody to keep pressing a button until a class lets them in.
   */
  opensAt?: number;
}

/** How long to wait before trying again when the server did not say when the door opens. */
export const RETRY_WITHOUT_OPENS_AT_MS = 60_000;

/**
 * Never sleep for hours on a timer a phone will not honour anyway, and never spin.
 *
 * A backgrounded browser tab throttles timers, and Android may not run one at all across a
 * doze — so a single `setTimeout` for "in 26 hours" is a promise this app cannot keep. Waking at
 * most every five minutes and checking the clock is both cheap and correct.
 */
export const MAX_RETRY_DELAY_MS = 5 * 60_000;
export const MIN_RETRY_DELAY_MS = 1_000;

/**
 * Classify a failed room request.
 *
 * Takes the pieces rather than the error object so that it stays free of the api client — and so
 * a test can hand it a shape the server has not produced yet.
 */
export function readRoomRefusal(
  status: number | undefined,
  body: Record<string, unknown> | undefined,
  fallbackMessage?: string,
): RoomRefusal {
  const data = body ?? {};
  const message =
    (typeof data.error === "string" && data.error.trim()) ||
    (fallbackMessage ?? "").trim() ||
    "This class cannot be opened just now.";

  if (status !== 409) return { kind: "error", message };

  const code = typeof data.code === "string" ? data.code : "";
  if (code === "too_early") {
    const opensAt = typeof data.opensAt === "number" && Number.isFinite(data.opensAt)
      ? data.opensAt
      : undefined;
    return { kind: "waiting", message, ...(opensAt !== undefined ? { opensAt } : null) };
  }

  /**
   * An older server, or a code this build has not heard of.
   *
   * Falls back to `expired`, which every version of this API has sent. Unknown reads as over
   * rather than as waiting, deliberately: a screen that waits forever for a class that finished
   * is worse than one that says it is over a few minutes early, and the person can reopen it.
   */
  if (code === "finished" || code === "cancelled") return { kind: "over", message };
  return { kind: data.expired === false ? "waiting" : "over", message };
}

/**
 * How long to wait before asking again, or null if there is nothing to wait for.
 *
 * Clamped at both ends: never busier than once a second, never lazier than five minutes.
 */
export function retryDelayMs(refusal: RoomRefusal, now: number): number | null {
  if (refusal.kind !== "waiting") return null;
  if (refusal.opensAt === undefined) return RETRY_WITHOUT_OPENS_AT_MS;
  const until = refusal.opensAt - now;
  if (until <= 0) return MIN_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, until));
}
