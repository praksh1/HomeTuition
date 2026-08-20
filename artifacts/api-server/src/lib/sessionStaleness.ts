/**
 * When is a live class actually over?
 *
 * Deliberately a module with no imports. Everything else that answers this question needs a
 * database and a WebSocket hub, and a rule that can only be exercised with both is a rule
 * nobody tests — which is how this one came to be written twice, differently, and to end live
 * classes that were still running.
 */

/** Lessons run long. A class is not abandoned the moment its scheduled minutes are up. */
export const GRACE_MINUTES = 15;

export interface LiveSessionRow {
  id: number;
  date: Date | string;
  startedAt: Date | string | null;
  duration: number;
}

/**
 * True when a class marked "live" is really just left over — a crashed browser, seed data, a
 * teacher who closed the tab.
 *
 * Measured from `startedAt`, when the teacher actually began, and only from the scheduled
 * `date` for rows old enough to predate that column. Measuring from the scheduled slot is a
 * bug with history: a class started even slightly late already counted as expired, so the next
 * client to load the live list ended it and told the room to go home. A student opening their
 * own Sessions tab was enough to kill their teacher's lesson.
 */
export function isLeftOver(session: LiveSessionRow, now: number = Date.now()): boolean {
  const begunAt = session.startedAt ?? session.date;
  const startedMs = new Date(begunAt).getTime();
  if (!Number.isFinite(startedMs)) return false;
  return startedMs + (session.duration + GRACE_MINUTES) * 60_000 < now;
}
