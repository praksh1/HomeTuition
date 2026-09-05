import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";

/**
 * What survives when the fine-grained proof for a class is deleted.
 *
 * ## Why a second table rather than keeping everything
 *
 * `session_provider_events` and `session_quality_samples` are a per-person record of when
 * somebody's device was on a call and how well their line was working. Kept forever, that is a
 * behavioural history of every teacher and student on the platform, accumulating silently and
 * useful to nobody once a class can no longer be disputed.
 *
 * So the fine-grained rows expire after thirty days and this does not. "The teacher's device
 * reported three bad periods" is a fact about a lesson and belongs in an argument months later;
 * "at 19:42:11 this person's connection was bad" is surveillance and does not.
 *
 * ## Counts and spans only
 *
 * No timestamps for individual samples, no per-participant rows, no room names, no ids belonging
 * to anyone. Whatever is here outlives the window on purpose, so it is deliberately the smallest
 * thing that can still answer a refund question.
 *
 * ## Nothing writes this on a schedule
 *
 * `sweepExpiredSessionProof` in `lib/sessionProof/retentionSweep.ts` fills it, in the same
 * transaction that removes the rows it summarises. **It is not scheduled, not called at boot, and
 * not wired to any route.** A job that deletes evidence must not appear quietly in a diff; see
 * `lib/sessionProof/retention.ts` for the reasoning and SESSION-PROOF.md for what has to be
 * approved before it runs anywhere.
 */
export const sessionProofAggregatesTable = pgTable(
  "session_proof_aggregates",
  {
    id: serial("id").primaryKey(),
    /**
     * The class this summarises.
     *
     * `cascade`, unlike the event table's `set null`: a summary of a class that no longer exists
     * answers no question, and keeping an orphan row would be retaining exactly the thing this
     * table exists to bound.
     */
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    /** Whether the provider independently recorded a meeting at all. Null when never ingested. */
    providerSawMeeting: boolean("provider_saw_meeting"),
    /** Number of distinct meeting instances the provider reported for this room. */
    providerMeetingCount: integer("provider_meeting_count"),
    /**
     * The total of every meeting instance's own span, in milliseconds.
     *
     * A sum of separately-measured spans, never the distance from the earliest start to the latest
     * end. Those differ whenever a call dropped and restarted, and the difference is the gap — time
     * nobody was in the room, which the second form would silently bill as teaching.
     */
    providerMeetingSpanMs: integer("provider_meeting_span_ms"),
    /** Provider `participant.joined` events that named a verified member of this class. */
    providerParticipantJoinEvents: integer("provider_participant_join_events"),
    /** Reconnections the participants' own devices reported. Self-reported; never authoritative. */
    reportedReconnectsTotal: integer("reported_reconnects_total"),
    qualityGood: integer("quality_good"),
    qualityWarning: integer("quality_warning"),
    qualityBad: integer("quality_bad"),
    qualityUnknown: integer("quality_unknown"),
    /**
     * Sources that had nothing to say, comma-separated, so a later reader still knows zero from
     * unknown.
     *
     * The single most important column here. Without it a summary written while provider ingestion
     * was switched off is indistinguishable from one written about a class the provider never saw.
     */
    unavailableSources: text("unavailable_sources"),
    /** The instant before which fine-grained rows were removed to produce this. */
    coveredUntil: timestamp("covered_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One summary per class. A second sweep updates it rather than adding a row, so the count of
    // rows here is the count of classes summarised and not the count of times a job has run.
    uniqueIndex("session_proof_aggregates_session_idx").on(table.sessionId),
  ],
);

export type SessionProofAggregate = typeof sessionProofAggregatesTable.$inferSelect;
