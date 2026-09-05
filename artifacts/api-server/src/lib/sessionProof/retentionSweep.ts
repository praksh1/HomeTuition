import { and, asc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import {
  db,
  sessionProofAggregatesTable,
  sessionProviderEventsTable,
  sessionQualitySamplesTable,
} from "@workspace/db";
import {
  RETENTION_WINDOW_MS,
  mergeSummary,
  planRetention,
  sessionRollUpEligibility,
  summariseExpiring,
  type ExistingSummary,
  type ExpiringEvent,
  type ExpiringSample,
} from "./retention";

/**
 * Summarising a class's fine-grained proof, and only then removing it.
 *
 * ## Nothing runs this
 *
 * **This function is not scheduled, not called at boot, not mounted on a route, and not invoked
 * anywhere in this repository.** It is written and tested so that the retention decision can be
 * reviewed as code rather than as a promise, and so that whoever eventually schedules it is
 * reviewing a thing that already works instead of writing it under time pressure.
 *
 * Turning it on is a separate, explicit decision: a job that deletes evidence must not appear
 * quietly in a diff, and it must not be switched on before provider ingestion has ever been proven
 * against a real delivery. Deleting rows that were never verified to be correct is deleting the
 * only chance to find out that they were not. See SESSION-PROOF.md.
 *
 * ## Why deletion is the goal at all
 *
 * `session_provider_events` and `session_quality_samples` are a per-person record of when
 * somebody's device was on a call and how well their line was working. Kept forever, that is a
 * behavioural history of every teacher and student on the platform, accumulating silently and
 * useful to nobody after the window in which a class can still be disputed. `retention.ts` holds
 * the window and the reasoning; this file is the mechanism.
 *
 * ## A class moves all at once, or not at all
 *
 * The defect this design replaces: retention used to work row by row. A meeting that started at
 * 10:00 and ended at 11:00 has two rows an hour apart, so on the day the window passed **the start
 * expired an hour before the end**. One sweep took the start and recorded "1 meeting, span 0"; the
 * next took the end and added another. The class ended up permanently summarised as two meetings
 * of no length — a lesson that plainly happened, reduced to evidence that it did not, with the
 * rows gone and no way to correct it.
 *
 * So every row a class has must be past the window, or none of them moves. A class held back costs
 * a few days of storage; a class rolled up in halves costs the lesson.
 *
 * ## Age is measured from arrival, not from the event's own clock
 *
 * `received_at` — when this server wrote the row — not `event_at`, which is when the provider says
 * the thing happened. A webhook delivered a week late carries an `event_at` a week old, so an age
 * taken from it would delete the row after twenty-three days of actually holding it. Thirty days
 * has to mean thirty days of us having it.
 *
 * ## Aggregate first, delete second, one transaction
 *
 * The ordering is the safety property. A crash between "deleted the samples" and "wrote the
 * summary" destroys evidence and leaves nothing behind that says what it was — and unlike almost
 * every other failure in this product, that one cannot be retried into correctness.
 *
 * So: every row for the class is locked, checked for eligibility, summarised, the summary is
 * written, and only then are those exact rows removed **by id**. Locking rather than re-querying
 * by age matters because a row inserted between the read and the delete would otherwise be deleted
 * without ever being counted.
 */

/** What each source could say, stated by the caller and never inferred from an empty list. */
export interface SweepAvailability {
  /** True when provider ingestion was configured and working over the period being summarised. */
  provider: boolean;
  /** True when client telemetry was being collected over the period being summarised. */
  telemetry: boolean;
}

export interface SweepOptions {
  nowMs: number;
  available: SweepAvailability;
  /**
   * Compute and report, change nothing.
   *
   * The mode this should be run in for a long time before it is ever run in the other one.
   */
  dryRun?: boolean;
  /** Most classes to process in one pass, so a first run cannot lock a large table for minutes. */
  limitSessions?: number;
}

export interface SweepResult {
  cutoffMs: number;
  dryRun: boolean;
  sessionsSummarised: number;
  /**
   * Classes that had *something* past the window but were left alone because something else was
   * not.
   *
   * Reported rather than hidden: on any given day this is where every class mid-expiry sits, and a
   * sweep that quietly did nothing to them would be indistinguishable from one that had nothing to
   * do.
   */
  sessionsHeldBack: number;
  providerEventsRemoved: number;
  qualitySamplesRemoved: number;
  /** Rows removed for a class that had already been summarised. See `late_arrivals`. */
  lateArrivalsRemoved: number;
  /** Expired events that never correlated to a class. Summarised nowhere; there is nothing to say. */
  unattachedEventsRemoved: number;
}

const DEFAULT_SESSION_LIMIT = 200;

/**
 * Summarise and remove fine-grained proof older than the retention window.
 *
 * Returns what it did — or, with `dryRun`, what it would have done. **Call it from nowhere until
 * the decision to run it has been taken explicitly.**
 */
export async function sweepExpiredSessionProof(options: SweepOptions): Promise<SweepResult> {
  const { nowMs, available, dryRun = false, limitSessions = DEFAULT_SESSION_LIMIT } = options;
  const cutoffMs = nowMs - RETENTION_WINDOW_MS;
  const cutoff = new Date(cutoffMs);

  return db.transaction(async (tx) => {
    const result: SweepResult = {
      cutoffMs,
      dryRun,
      sessionsSummarised: 0,
      sessionsHeldBack: 0,
      providerEventsRemoved: 0,
      qualitySamplesRemoved: 0,
      lateArrivalsRemoved: 0,
      unattachedEventsRemoved: 0,
    };

    /*
      Which classes have anything past the window. Bounded and ordered, so a first run over a long
      backlog is a series of short predictable passes rather than one that locks a table for
      minutes on a database that is also serving live classes.

      This is only the candidate list. Whether a class may actually move is decided below, after
      *all* of its rows are locked — a class with one row past the window and one inside it appears
      here and is then held back.
    */
    const [fromEvents, fromSamples] = await Promise.all([
      tx
        .selectDistinct({ sessionId: sessionProviderEventsTable.sessionId })
        .from(sessionProviderEventsTable)
        .where(and(isNotNull(sessionProviderEventsTable.sessionId), lt(sessionProviderEventsTable.receivedAt, cutoff)))
        .orderBy(asc(sessionProviderEventsTable.sessionId))
        .limit(limitSessions),
      tx
        .selectDistinct({ sessionId: sessionQualitySamplesTable.sessionId })
        .from(sessionQualitySamplesTable)
        .where(lt(sessionQualitySamplesTable.receivedAt, cutoff))
        .orderBy(asc(sessionQualitySamplesTable.sessionId))
        .limit(limitSessions),
    ]);
    const sessionIds = [
      ...new Set(
        [...fromEvents, ...fromSamples]
          .map((r) => r.sessionId)
          .filter((id): id is number => typeof id === "number"),
      ),
    ]
      .sort((a, b) => a - b)
      .slice(0, limitSessions);

    for (const sessionId of sessionIds) {
      /*
        Every row the class has, locked — not just the expired ones.

        Two reasons, and both are load-bearing. The eligibility rule needs to see the rows that are
        *still inside* the window, because one of those holds the whole class back. And `FOR UPDATE`
        pins exactly this set for the rest of the transaction, so the ids summarised below and the
        ids deleted below are the same ones; deleting by age instead would also sweep away anything
        that arrived in between, uncounted.
      */
      const eventRows = await tx
        .select({
          id: sessionProviderEventsTable.id,
          eventType: sessionProviderEventsTable.eventType,
          eventAt: sessionProviderEventsTable.eventAt,
          receivedAt: sessionProviderEventsTable.receivedAt,
          providerMeetingId: sessionProviderEventsTable.providerMeetingId,
          participantUserId: sessionProviderEventsTable.participantUserId,
        })
        .from(sessionProviderEventsTable)
        .where(eq(sessionProviderEventsTable.sessionId, sessionId))
        .orderBy(asc(sessionProviderEventsTable.id))
        .for("update");

      const sampleRows = await tx
        .select({
          id: sessionQualitySamplesTable.id,
          quality: sessionQualitySamplesTable.quality,
          reconnect: sessionQualitySamplesTable.reconnect,
          receivedAt: sessionQualitySamplesTable.receivedAt,
        })
        .from(sessionQualitySamplesTable)
        .where(eq(sessionQualitySamplesTable.sessionId, sessionId))
        .orderBy(asc(sessionQualitySamplesTable.id))
        .for("update");

      if (eventRows.length === 0 && sampleRows.length === 0) continue;

      /*
        All or nothing.

        A concurrent sweep that got here first will have committed its deletes, so this one now
        sees no rows and skipped above. A class with anything still inside the window is left
        entirely alone — including the parts of it that *are* past the window, which is the point.
      */
      const eligibility = sessionRollUpEligibility(
        [...eventRows.map((r) => r.receivedAt.getTime()), ...sampleRows.map((r) => r.receivedAt.getTime())],
        nowMs,
      );
      if (!eligibility.eligible) {
        result.sessionsHeldBack += 1;
        continue;
      }

      const events: ExpiringEvent[] = eventRows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        eventAtMs: row.eventAt.getTime(),
        providerMeetingId: row.providerMeetingId,
        participantUserId: row.participantUserId,
      }));
      const samples: ExpiringSample[] = sampleRows.map((row) => ({
        id: row.id,
        quality: row.quality,
        reconnect: row.reconnect,
      }));

      const delta = summariseExpiring(events, samples);
      result.sessionsSummarised += 1;
      result.providerEventsRemoved += events.length;
      result.qualitySamplesRemoved += samples.length;

      if (dryRun) continue;

      /*
        The summary row, locked before it is read.

        Locked after the evidence rows and never before, so two sweeps always take the two locks in
        the same order and cannot deadlock. Read-then-write is safe here precisely because of the
        lock — and it is worth the extra statement: the merge rule below has three cases per source
        and expressing it as an `ON CONFLICT DO UPDATE` expression made it unreadable, which is how
        a rule that fabricates zeroes hides.
      */
      const [existingRow] = await tx
        .select()
        .from(sessionProofAggregatesTable)
        .where(eq(sessionProofAggregatesTable.sessionId, sessionId))
        .for("update");

      const existing: ExistingSummary | null = existingRow
        ? {
            providerCovered: existingRow.providerMeetingCount !== null,
            telemetryCovered: existingRow.qualityGood !== null,
            providerSawMeeting: existingRow.providerSawMeeting,
            providerMeetingCount: existingRow.providerMeetingCount,
            providerMeetingSpanMs: existingRow.providerMeetingSpanMs,
            providerMeetingsUnmeasured: existingRow.providerMeetingsUnmeasured,
            providerParticipantJoinEvents: existingRow.providerParticipantJoinEvents,
            reportedReconnectsTotal: existingRow.reportedReconnectsTotal,
            qualityGood: existingRow.qualityGood,
            qualityWarning: existingRow.qualityWarning,
            qualityBad: existingRow.qualityBad,
            qualityUnknown: existingRow.qualityUnknown,
            lateArrivals: existingRow.lateArrivals,
          }
        : null;

      const merged = mergeSummary(existing, delta, available, {
        providerEvents: events.length,
        qualitySamples: samples.length,
      });
      result.lateArrivalsRemoved += merged.lateArrivals - (existing?.lateArrivals ?? 0);

      const values = {
        providerSawMeeting: merged.providerSawMeeting,
        providerMeetingCount: merged.providerMeetingCount,
        providerMeetingSpanMs: merged.providerMeetingSpanMs,
        providerMeetingsUnmeasured: merged.providerMeetingsUnmeasured,
        providerParticipantJoinEvents: merged.providerParticipantJoinEvents,
        reportedReconnectsTotal: merged.reportedReconnectsTotal,
        qualityGood: merged.qualityGood,
        qualityWarning: merged.qualityWarning,
        qualityBad: merged.qualityBad,
        qualityUnknown: merged.qualityUnknown,
        unavailableSources: merged.unavailableSources,
        lateArrivals: merged.lateArrivals,
        coveredUntil: cutoff,
        updatedAt: new Date(),
      };

      if (existingRow) {
        await tx
          .update(sessionProofAggregatesTable)
          .set(values)
          .where(eq(sessionProofAggregatesTable.sessionId, sessionId));
      } else {
        await tx.insert(sessionProofAggregatesTable).values({ sessionId, ...values });
      }

      // Only now, and only the rows that were locked and counted above.
      if (events.length > 0) {
        await tx.delete(sessionProviderEventsTable).where(inArray(sessionProviderEventsTable.id, events.map((e) => e.id)));
      }
      if (samples.length > 0) {
        await tx.delete(sessionQualitySamplesTable).where(inArray(sessionQualitySamplesTable.id, samples.map((s) => s.id)));
      }
    }

    /*
      Events that never correlated to a class expire on their own, row by row.

      Safe to sweep individually because there is nothing to pair them with: the all-or-nothing
      rule above exists to keep a meeting's two ends together, and an uncorrelated event belongs to
      no meeting and no summary. They exist so an operator can see that deliveries were arriving
      and failing to correlate — a live diagnostic, not an archive.
    */
    const unattachedRows = await tx
      .select({ id: sessionProviderEventsTable.id, receivedAt: sessionProviderEventsTable.receivedAt })
      .from(sessionProviderEventsTable)
      .where(and(isNull(sessionProviderEventsTable.sessionId), lt(sessionProviderEventsTable.receivedAt, cutoff)))
      .limit(1000)
      .for("update");
    const plan = planRetention(
      unattachedRows.map((r) => ({ id: r.id, sessionId: null, receivedAtMs: r.receivedAt.getTime() })),
      nowMs,
    );
    result.unattachedEventsRemoved = plan.expiredIds.length;
    if (!dryRun && plan.expiredIds.length > 0) {
      await tx.delete(sessionProviderEventsTable).where(inArray(sessionProviderEventsTable.id, plan.expiredIds));
    }

    return result;
  });
}
