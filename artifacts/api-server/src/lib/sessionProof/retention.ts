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

/**
 * A row old enough to be summarised and removed.
 *
 * `receivedAtMs` is when **this server wrote the row**, not when the provider says the thing
 * happened. Those differ, and using the wrong one shortens the window: a webhook delivered a week
 * late carries an `event_at` a week old, so an age measured from it would delete the row after
 * twenty-three days of actually being held. Thirty days has to mean thirty days of us having it.
 */
export interface RetainableRow {
  id: number;
  sessionId: number | null;
  receivedAtMs: number;
}

/**
 * Whether a whole class's evidence may be rolled up yet.
 *
 * ## The bug this exists to prevent
 *
 * Retention used to work row by row: anything past the window was summarised and deleted on its
 * own. A meeting that started at 10:00 and ended at 11:00 has two rows an hour apart, so on the
 * day the window passed, **the start expired an hour before the end.** One sweep took the start
 * and wrote "1 meeting, span 0"; the next sweep took the end and added "1 meeting, span 0". The
 * class was left permanently recorded as two meetings of no length — a lesson that plainly did
 * happen, summarised into evidence that it did not. The rows were gone, so it could never be
 * corrected.
 *
 * So a class is now all-or-nothing: every row it has must be past the window, or none of them
 * moves. Holding a class back costs a few days of storage. Getting it wrong costs the lesson.
 */
export interface RollUpEligibility {
  cutoffMs: number;
  /** True when every row arrived before the cutoff, so the whole set may be rolled up together. */
  eligible: boolean;
  /** How many rows are still inside the window and are holding the whole class back. */
  heldBack: number;
  /** The most recent arrival, so a caller can say when this class becomes eligible. */
  newestReceivedAtMs: number | null;
}

export function sessionRollUpEligibility(receivedAtMs: number[], now: number): RollUpEligibility {
  const cutoffMs = now - RETENTION_WINDOW_MS;
  // The boundary is inclusive of the cutoff — a row exactly at the edge is kept, because deleting
  // evidence one millisecond early is the error worth avoiding.
  const heldBack = receivedAtMs.filter((at) => at >= cutoffMs).length;
  return {
    cutoffMs,
    eligible: receivedAtMs.length > 0 && heldBack === 0,
    heldBack,
    newestReceivedAtMs: receivedAtMs.length > 0 ? Math.max(...receivedAtMs) : null,
  };
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
 * What a row-by-row retention pass would do, given rows and a clock.
 *
 * Used for evidence that has **no class to belong to** — provider events whose room never
 * correlated. Those can be swept individually because there is nothing to pair them with and no
 * summary to write; the all-or-nothing rule above exists to protect a *meeting's* two ends from
 * being separated, and an uncorrelated event has no meeting.
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
    if (row.receivedAtMs < cutoffMs) expired.push(row);
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

/* ------------------------------------------------------------- what the survivors should say */

/** The subset of a stored provider event a summary is computed from. */
export interface ExpiringEvent {
  id: number;
  eventType: string;
  eventAtMs: number;
  providerMeetingId: string | null;
  participantUserId: number | null;
}

/** The subset of a stored quality sample a summary is computed from. */
export interface ExpiringSample {
  id: number;
  quality: string;
  reconnect: boolean;
}

/** Counts and spans for one class's expiring rows. Never a timestamp for an individual sample. */
export interface AggregateDelta {
  providerSawMeeting: boolean;
  providerMeetingCount: number;
  providerMeetingSpanMs: number;
  /**
   * Meetings the provider reported only one end of, so their length is unknown.
   *
   * Without this the summed span silently understates. "Two meetings totalling thirty minutes"
   * reads as a complete measurement when one of the two was never measured at all, and after the
   * rows are deleted there is nothing left to notice the difference against. Same rule as
   * `Measured<T>` in `aggregate.ts`: a figure that could not be taken is not a zero.
   */
  providerMeetingsUnmeasured: number;
  providerParticipantJoinEvents: number;
  reportedReconnectsTotal: number;
  qualityGood: number;
  qualityWarning: number;
  qualityBad: number;
  qualityUnknown: number;
}

/**
 * The durable figures for one class's expiring rows.
 *
 * Pure, so the arithmetic that decides what survives a deletion can be exercised without a
 * database — which matters more here than anywhere else in this directory, because getting it
 * wrong is not a bug that can be fixed later. The rows it summarises are gone.
 *
 * Spans are summed **per meeting instance**, never taken from the earliest start to the latest
 * end. A room that held two twenty-minute meetings an hour apart did not hold one meeting of an
 * hour and forty, and the difference is time nobody was teaching.
 */
export function summariseExpiring(events: ExpiringEvent[], samples: ExpiringSample[]): AggregateDelta {
  const delta: AggregateDelta = {
    providerSawMeeting: false,
    providerMeetingCount: 0,
    providerMeetingSpanMs: 0,
    providerMeetingsUnmeasured: 0,
    providerParticipantJoinEvents: 0,
    reportedReconnectsTotal: 0,
    qualityGood: 0,
    qualityWarning: 0,
    qualityBad: 0,
    qualityUnknown: 0,
  };

  const meetings = new Map<string | null, { start: number | null; end: number | null }>();
  for (const event of events) {
    if (event.eventType === "participant.joined" && event.participantUserId !== null) {
      // Counted only when the provider could name a verified member of this class. An anonymous
      // join is evidence somebody was there and no evidence at all about who.
      delta.providerParticipantJoinEvents += 1;
    }
    if (
      event.eventType === "meeting.started" ||
      event.eventType === "meeting.ended" ||
      event.eventType === "participant.joined" ||
      event.eventType === "participant.left"
    ) {
      delta.providerSawMeeting = true;
    }
    if (event.eventType !== "meeting.started" && event.eventType !== "meeting.ended") continue;

    const found = meetings.get(event.providerMeetingId) ?? { start: null, end: null };
    if (event.eventType === "meeting.started") {
      found.start = found.start === null ? event.eventAtMs : Math.min(found.start, event.eventAtMs);
    } else {
      found.end = found.end === null ? event.eventAtMs : Math.max(found.end, event.eventAtMs);
    }
    meetings.set(event.providerMeetingId, found);
  }

  delta.providerMeetingCount = meetings.size;
  for (const { start, end } of meetings.values()) {
    if (start !== null && end !== null && end >= start) delta.providerMeetingSpanMs += end - start;
    // A meeting the provider only reported one end of contributes no span, and says so, rather
    // than quietly contributing a zero to a total somebody will read as a measurement.
    else delta.providerMeetingsUnmeasured += 1;
  }

  for (const sample of samples) {
    if (sample.reconnect) delta.reportedReconnectsTotal += 1;
    if (sample.quality === "good") delta.qualityGood += 1;
    else if (sample.quality === "warning") delta.qualityWarning += 1;
    else if (sample.quality === "bad") delta.qualityBad += 1;
    else delta.qualityUnknown += 1;
  }

  return delta;
}

/** One class's stored summary, as the merge below needs it. */
export interface ExistingSummary {
  providerCovered: boolean;
  telemetryCovered: boolean;
  providerSawMeeting: boolean | null;
  providerMeetingCount: number | null;
  providerMeetingSpanMs: number | null;
  providerMeetingsUnmeasured: number | null;
  providerParticipantJoinEvents: number | null;
  reportedReconnectsTotal: number | null;
  qualityGood: number | null;
  qualityWarning: number | null;
  qualityBad: number | null;
  qualityUnknown: number | null;
  lateArrivals: number;
}

export interface MergedSummary extends Omit<ExistingSummary, "providerCovered" | "telemetryCovered"> {
  unavailableSources: string | null;
}

/**
 * Fold one roll-up into whatever summary is already there.
 *
 * Pure, and the whole of the "do not fabricate, do not double-count" rule lives here:
 *
 * - **A source that was not being ingested contributes nothing at all.** Not a zero, not a delta —
 *   its columns are left exactly as they were, including null. A zero written for a source nobody
 *   was watching is indistinguishable from a real zero, and this project has shipped that bug on
 *   two dashboards already.
 * - **A source that is available and has never been covered is filled in.** Null becomes a real
 *   number. This is how a class summarised while provider ingestion was off can still be resolved
 *   honestly if provider evidence turns up later.
 * - **A source that is available and has already been covered is not added to.** The class was
 *   rolled up all at once, so anything arriving afterwards is a late delivery, and merging a
 *   partial delta is exactly how a lone `meeting.ended` becomes "a second meeting of no length".
 *   Those rows are counted in `lateArrivals` instead.
 *
 * `unavailableSources` is *derived* from the merged figures rather than accumulated, so it can
 * never contradict them: a source is listed precisely while its columns are still null.
 */
export function mergeSummary(
  existing: ExistingSummary | null,
  delta: AggregateDelta,
  available: { provider: boolean; telemetry: boolean },
  rowCounts: { providerEvents: number; qualitySamples: number },
): MergedSummary {
  const before: ExistingSummary = existing ?? {
    providerCovered: false,
    telemetryCovered: false,
    providerSawMeeting: null,
    providerMeetingCount: null,
    providerMeetingSpanMs: null,
    providerMeetingsUnmeasured: null,
    providerParticipantJoinEvents: null,
    reportedReconnectsTotal: null,
    qualityGood: null,
    qualityWarning: null,
    qualityBad: null,
    qualityUnknown: null,
    lateArrivals: 0,
  };

  const takeProvider = available.provider && !before.providerCovered;
  const takeTelemetry = available.telemetry && !before.telemetryCovered;

  // Rows whose figures could not be folded in anywhere are late, not lost silently.
  let lateArrivals = before.lateArrivals;
  if (!takeProvider && rowCounts.providerEvents > 0) lateArrivals += rowCounts.providerEvents;
  if (!takeTelemetry && rowCounts.qualitySamples > 0) lateArrivals += rowCounts.qualitySamples;

  const merged: MergedSummary = {
    providerSawMeeting: takeProvider ? delta.providerSawMeeting : before.providerSawMeeting,
    providerMeetingCount: takeProvider ? delta.providerMeetingCount : before.providerMeetingCount,
    providerMeetingSpanMs: takeProvider ? delta.providerMeetingSpanMs : before.providerMeetingSpanMs,
    providerMeetingsUnmeasured: takeProvider ? delta.providerMeetingsUnmeasured : before.providerMeetingsUnmeasured,
    providerParticipantJoinEvents: takeProvider
      ? delta.providerParticipantJoinEvents
      : before.providerParticipantJoinEvents,
    reportedReconnectsTotal: takeTelemetry ? delta.reportedReconnectsTotal : before.reportedReconnectsTotal,
    qualityGood: takeTelemetry ? delta.qualityGood : before.qualityGood,
    qualityWarning: takeTelemetry ? delta.qualityWarning : before.qualityWarning,
    qualityBad: takeTelemetry ? delta.qualityBad : before.qualityBad,
    qualityUnknown: takeTelemetry ? delta.qualityUnknown : before.qualityUnknown,
    lateArrivals,
    unavailableSources: null,
  };

  const missing: string[] = [];
  if (merged.providerMeetingCount === null) missing.push("provider");
  if (merged.qualityGood === null) missing.push("client-telemetry");
  merged.unavailableSources = missing.length > 0 ? missing.join(",") : null;

  return merged;
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
