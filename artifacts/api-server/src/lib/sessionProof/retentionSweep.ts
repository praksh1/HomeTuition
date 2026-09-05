import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  sessionProofAggregatesTable,
  sessionProviderEventsTable,
  sessionQualitySamplesTable,
} from "@workspace/db";
import {
  RETENTION_WINDOW_MS,
  summariseExpiring,
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
 * ## Aggregate first, delete second, one transaction
 *
 * The ordering is the safety property. A crash between "deleted the samples" and "wrote the
 * summary" destroys evidence and leaves nothing behind that says what it was — and unlike almost
 * every other failure in this product, that one cannot be retried into correctness.
 *
 * So: the expiring rows are locked, summarised, the summary is written, and only then are those
 * exact rows removed **by id**. Locking rather than re-querying by age matters because a row
 * inserted between the read and the delete would otherwise be deleted without ever being counted.
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
  providerEventsRemoved: number;
  qualitySamplesRemoved: number;
  /** Expired events that never correlated to a class. Summarised nowhere; there is nothing to say. */
  unattachedEventsRemoved: number;
}

const DEFAULT_SESSION_LIMIT = 200;

/** Sources that had nothing to say, so a later reader still knows zero from unknown. */
function unavailableSources(available: SweepAvailability): string | null {
  const missing: string[] = [];
  if (!available.provider) missing.push("provider");
  if (!available.telemetry) missing.push("client-telemetry");
  return missing.length > 0 ? missing.join(",") : null;
}

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
      providerEventsRemoved: 0,
      qualitySamplesRemoved: 0,
      unattachedEventsRemoved: 0,
    };

    /*
      Which classes have anything expiring. Bounded, and ordered, so a first run over a long
      backlog is a series of short predictable passes rather than one that locks a table for
      minutes on a database that is also serving live classes.
    */
    const [fromEvents, fromSamples] = await Promise.all([
      tx
        .selectDistinct({ sessionId: sessionProviderEventsTable.sessionId })
        .from(sessionProviderEventsTable)
        .where(and(isNotNull(sessionProviderEventsTable.sessionId), lt(sessionProviderEventsTable.eventAt, cutoff))),
      tx
        .selectDistinct({ sessionId: sessionQualitySamplesTable.sessionId })
        .from(sessionQualitySamplesTable)
        .where(lt(sessionQualitySamplesTable.observedAt, cutoff)),
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
        Locked, not merely read.

        `FOR UPDATE` pins exactly these rows for the rest of the transaction, so the ids summarised
        below and the ids deleted below are the same set. Deleting by age instead would also remove
        anything that arrived in between — rows that were never counted into the summary that
        replaced them.
      */
      const eventRows = await tx
        .select({
          id: sessionProviderEventsTable.id,
          eventType: sessionProviderEventsTable.eventType,
          eventAt: sessionProviderEventsTable.eventAt,
          providerMeetingId: sessionProviderEventsTable.providerMeetingId,
          participantUserId: sessionProviderEventsTable.participantUserId,
        })
        .from(sessionProviderEventsTable)
        .where(and(eq(sessionProviderEventsTable.sessionId, sessionId), lt(sessionProviderEventsTable.eventAt, cutoff)))
        .orderBy(asc(sessionProviderEventsTable.id))
        .for("update");
      const events: ExpiringEvent[] = eventRows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        eventAtMs: row.eventAt.getTime(),
        providerMeetingId: row.providerMeetingId,
        participantUserId: row.participantUserId,
      }));

      const samples: ExpiringSample[] = await tx
        .select({
          id: sessionQualitySamplesTable.id,
          quality: sessionQualitySamplesTable.quality,
          reconnect: sessionQualitySamplesTable.reconnect,
        })
        .from(sessionQualitySamplesTable)
        .where(and(eq(sessionQualitySamplesTable.sessionId, sessionId), lt(sessionQualitySamplesTable.observedAt, cutoff)))
        .orderBy(asc(sessionQualitySamplesTable.id))
        .for("update");

      if (events.length === 0 && samples.length === 0) continue;

      const delta = summariseExpiring(events, samples);
      result.sessionsSummarised += 1;
      result.providerEventsRemoved += events.length;
      result.qualitySamplesRemoved += samples.length;

      if (dryRun) continue;

      /*
        Merged into any summary already there, rather than replacing it.

        A class can expire in pieces — a sweep that ran last month took the first week's rows — and
        an overwrite would silently drop everything the earlier pass recorded. Addition is right
        for every figure here because every figure here is a count or a sum of per-meeting spans.
      */
      await tx
        .insert(sessionProofAggregatesTable)
        .values({
          sessionId,
          providerSawMeeting: available.provider ? delta.providerSawMeeting : null,
          providerMeetingCount: available.provider ? delta.providerMeetingCount : null,
          providerMeetingSpanMs: available.provider ? delta.providerMeetingSpanMs : null,
          providerParticipantJoinEvents: available.provider ? delta.providerParticipantJoinEvents : null,
          reportedReconnectsTotal: available.telemetry ? delta.reportedReconnectsTotal : null,
          qualityGood: available.telemetry ? delta.qualityGood : null,
          qualityWarning: available.telemetry ? delta.qualityWarning : null,
          qualityBad: available.telemetry ? delta.qualityBad : null,
          qualityUnknown: available.telemetry ? delta.qualityUnknown : null,
          unavailableSources: unavailableSources(available),
          coveredUntil: cutoff,
        })
        .onConflictDoUpdate({
          target: sessionProofAggregatesTable.sessionId,
          set: {
            providerSawMeeting: sql`coalesce(${sessionProofAggregatesTable.providerSawMeeting}, false) OR ${delta.providerSawMeeting}`,
            providerMeetingCount: sql`coalesce(${sessionProofAggregatesTable.providerMeetingCount}, 0) + ${delta.providerMeetingCount}`,
            providerMeetingSpanMs: sql`coalesce(${sessionProofAggregatesTable.providerMeetingSpanMs}, 0) + ${delta.providerMeetingSpanMs}`,
            providerParticipantJoinEvents: sql`coalesce(${sessionProofAggregatesTable.providerParticipantJoinEvents}, 0) + ${delta.providerParticipantJoinEvents}`,
            reportedReconnectsTotal: sql`coalesce(${sessionProofAggregatesTable.reportedReconnectsTotal}, 0) + ${delta.reportedReconnectsTotal}`,
            qualityGood: sql`coalesce(${sessionProofAggregatesTable.qualityGood}, 0) + ${delta.qualityGood}`,
            qualityWarning: sql`coalesce(${sessionProofAggregatesTable.qualityWarning}, 0) + ${delta.qualityWarning}`,
            qualityBad: sql`coalesce(${sessionProofAggregatesTable.qualityBad}, 0) + ${delta.qualityBad}`,
            qualityUnknown: sql`coalesce(${sessionProofAggregatesTable.qualityUnknown}, 0) + ${delta.qualityUnknown}`,
            coveredUntil: cutoff,
            updatedAt: new Date(),
          },
        });

      // Only now, and only the rows that were locked and counted above.
      if (events.length > 0) {
        await tx.delete(sessionProviderEventsTable).where(inArray(sessionProviderEventsTable.id, events.map((e) => e.id)));
      }
      if (samples.length > 0) {
        await tx.delete(sessionQualitySamplesTable).where(inArray(sessionQualitySamplesTable.id, samples.map((s) => s.id)));
      }
    }

    /*
      Events that never correlated to a class expire with nothing written.

      There is no session to summarise them against and no question they could answer later. They
      exist so an operator can see that deliveries were arriving and failing to correlate, and that
      is a live diagnostic, not an archive.
    */
    const unattached = await tx
      .select({ id: sessionProviderEventsTable.id })
      .from(sessionProviderEventsTable)
      .where(and(isNull(sessionProviderEventsTable.sessionId), lt(sessionProviderEventsTable.eventAt, cutoff)))
      .limit(1000)
      .for("update");
    result.unattachedEventsRemoved = unattached.length;
    if (!dryRun && unattached.length > 0) {
      await tx.delete(sessionProviderEventsTable).where(inArray(sessionProviderEventsTable.id, unattached.map((r) => r.id)));
    }

    return result;
  });
}
