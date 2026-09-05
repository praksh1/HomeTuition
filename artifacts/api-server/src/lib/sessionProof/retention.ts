/**
 * How long fine-grained proof is kept, and what survives it.
 *
 * ## Why anything is deleted at all
 *
 * Provider events and connection samples are a per-person record of when somebody's device was on
 * a call and how well their line was working. Kept forever, that is a behavioural history of every
 * teacher and student on the platform, accumulating silently, useful to nobody after the window in
 * which a class could still be disputed.
 *
 * So the fine-grained rows expire and a small per-session aggregate does not. The aggregate is what
 * a refund argued months later actually needs; the individual samples are what it needed on the day.
 *
 * ## This file plans; it does not delete
 *
 * Deliberately pure and import-free. It computes *which* rows are past the window and what the
 * surviving aggregate should say. **No job, timer, cron or destructive production task is created
 * anywhere in this change**, and nothing here can run by itself.
 *
 * Wiring it to an actual `DELETE` is a separate decision with its own review, because a scheduled
 * job that removes evidence is exactly the sort of thing that must not appear quietly in a diff. If
 * that is ever done, it belongs behind an explicit operator action or a reviewed migration script,
 * with the aggregate written *before* anything is removed, in one transaction.
 */

/**
 * Thirty days of fine-grained provider and quality rows.
 *
 * Long enough to cover the dispute window in REFUNDS.md — a student has days to raise a complaint
 * and a teacher days to respond — with room for an appeal, and short enough that this is not a
 * standing archive of who was online when.
 *
 * Expressed as days rather than a calendar month for the reason recorded in
 * `.agents/memory/`: Bikram Sambat months run 29-32 days and Gregorian 28-31, so calendar
 * arithmetic gives two different answers to the same policy.
 */
export const FINE_GRAINED_RETENTION_DAYS = 30;

export const RETENTION_WINDOW_MS = FINE_GRAINED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** A row old enough to be summarised and removed. */
export interface RetainableRow {
  id: number;
  sessionId: number | null;
  atMs: number;
}

export interface RetentionPlan {
  /** The instant before which fine-grained rows are past their window. */
  cutoffMs: number;
  /** Ids that would be removed. Sorted, so a dry run is diffable between invocations. */
  expiredIds: number[];
  /** Ids that stay. */
  keptIds: number[];
  /** Sessions that would lose fine-grained rows, so an aggregate can be written first. */
  sessionsNeedingAggregate: number[];
}

/**
 * What a retention pass *would* do, given rows and a clock.
 *
 * `now` is a parameter so tests pin it; nothing here reads the wall clock. The boundary is
 * inclusive of the cutoff — a row exactly at the edge is kept, because deleting evidence one
 * millisecond early is the error worth avoiding.
 */
export function planRetention(rows: RetainableRow[], now: number): RetentionPlan {
  const cutoffMs = now - RETENTION_WINDOW_MS;
  const expired: RetainableRow[] = [];
  const kept: RetainableRow[] = [];

  for (const row of rows) {
    if (row.atMs < cutoffMs) expired.push(row);
    else kept.push(row);
  }

  const sessions = new Set<number>();
  for (const row of expired) if (row.sessionId !== null) sessions.add(row.sessionId);

  return {
    cutoffMs,
    expiredIds: expired.map((r) => r.id).sort((a, b) => a - b),
    keptIds: kept.map((r) => r.id).sort((a, b) => a - b),
    sessionsNeedingAggregate: [...sessions].sort((a, b) => a - b),
  };
}

/**
 * The durable per-session shape that outlives the fine-grained rows.
 *
 * Counts and spans, never per-sample timestamps. "The teacher's device reported three bad-quality
 * periods" survives; "at 19:42:11 this person's connection was bad" does not, because after the
 * dispute window the second one is surveillance and the first is a fact about a lesson.
 *
 * Intentionally not written by this change. It is the contract a future aggregate table would use,
 * recorded here so the retention decision and the shape it implies are reviewed together.
 */
export interface DurableSessionProofAggregate {
  sessionId: number;
  providerSawMeeting: boolean | null;
  providerMeetingSpanMs: number | null;
  providerParticipantJoinEvents: number | null;
  reportedReconnectsTotal: number | null;
  qualityGood: number | null;
  qualityWarning: number | null;
  qualityBad: number | null;
  /** Set when a source was unavailable, so a later reader still knows zero from unknown. */
  unavailableSources: string[];
}
