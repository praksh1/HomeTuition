import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * What the video provider independently says happened in a class.
 *
 * The attendance ledger in `session_participation` is this app's own account, written from its own
 * socket. It is the right primary source and it has one weakness a refund argument will find: a
 * teacher disputing it is disputing the very record being used against them, and there is nothing
 * to check it against. This table is the second opinion — the same call, described by somebody with
 * no stake in the outcome.
 *
 * ## A new table, not columns on `session_participation`
 *
 * The reason recorded on `session_activity` and `session_participation` before it: Drizzle names
 * every column in a bare `select()`, several routes select that way, and a column added to a table
 * already in use is a 500 on that path from the moment the code deploys until somebody runs
 * `db:push` by hand. A new table is invisible to old code.
 *
 * It is also the wrong shape for a column. Participation is one row per person per class; this is
 * an append-only event log with several rows per person, arriving out of order, hours late, or
 * twice.
 *
 * ## What is deliberately not here
 *
 * No raw payload, no signature, no token, no participant name, no IP address, no device
 * identifier, and nothing about audio or video. Storing a provider's whole callback "in case it is
 * useful later" builds a behavioural archive of every teacher and student that nobody chose and
 * nobody reviews. Every column below is one this product can say why it needs.
 */
export const sessionProviderEventsTable = pgTable(
  "session_provider_events",
  {
    id: serial("id").primaryKey(),
    /** Which provider said it. Daily today; the seam in `lib/video/` allows others. */
    provider: text("provider").notNull(),
    /**
     * The provider's own id for this delivery, and the idempotency key.
     *
     * A webhook that is retried must not be counted twice: a duplicated `participant.left` would
     * understate somebody's attendance, which is exactly the direction that costs a teacher money.
     */
    providerEventId: text("provider_event_id").notNull(),
    /** One of the four types in `lib/sessionProof/providerEvents.ts`. */
    eventType: text("event_type").notNull(),
    /** When the provider says it happened, which is not when it reached us. */
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    /**
     * Which of the provider's clocks `event_at` came from: `occurred` or `delivery`.
     *
     * Three different instants are involved and conflating them costs money. `occurred` is the
     * provider's timestamp for the thing itself (`start_ts`, `end_ts`, `joined_at`); `delivery` is
     * `event_ts`, when it generated the callback, which after a retry can sit long after the
     * event; `received_at` below is when this server wrote the row. A span whose ends come from
     * different clocks can be minutes longer than the meeting was, so a reader is told.
     */
    eventAtSource: text("event_at_source").notNull().default("delivery"),
    /**
     * The class it belongs to, derived from the room name, or null.
     *
     * Nullable on purpose: a webhook for a room this app did not create is stored unattached rather
     * than dropped, so an operator asking "why is there no provider evidence" can see that events
     * are arriving and failing to correlate. `set null` rather than cascade for the same reason —
     * losing the class should not silently erase that the provider saw something.
     */
    sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
    /** The provider's room name, kept so an uncorrelated event is still diagnosable. */
    providerRoom: text("provider_room").notNull(),
    /** The provider's id for the meeting instance, where it supplies one. */
    providerMeetingId: text("provider_meeting_id"),
    /** The provider's id for one participant's connection, where it supplies one. */
    providerParticipantId: text("provider_participant_id"),
    /**
     * The Sikshya user, only when the provider echoed one back from a token this server minted
     * **and** that user really is part of this class.
     *
     * A foreign key, which it could not have been while the value came straight off the wire — an
     * insert that fails is a webhook that gets retried forever. It is safe now because the route
     * checks the claim against `getSessionMembership` first and nulls anything that does not
     * belong to this class, so by the time a value reaches this column it names a real member.
     *
     * `set null` on delete rather than cascade: when somebody deletes their account this row must
     * stop pointing at them, but the fact that the provider saw a participant is still true and
     * still the answer to "was anybody in the room". Deleting an account must not quietly rewrite
     * the evidence about a class — nor leave a durable internal identifier behind, which is why
     * this is a real reference and not a loose integer.
     */
    participantUserId: integer("participant_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /**
     * True when the provider named a user who is not part of this class, and we discarded the id.
     *
     * The contradiction is worth keeping. A stream of events claiming accounts that are not in the
     * class means room names are colliding, a token is being reused, or somebody is forging
     * payloads — and every one of those is invisible if a bad id is silently blanked. Null for
     * events that carried no id at all, which is an absence rather than a disagreement.
     */
    identityRejected: boolean("identity_rejected"),
    /**
     * Whether the provider believed this participant was a moderator.
     *
     * Corroborating only. Rights are decided by this server's membership check and never by the
     * provider — see VIDEO.md. This records what the provider thought, not what anyone was owed.
     */
    participantIsOwner: boolean("participant_is_owner"),
    /** Seconds the provider says it lasted, where supplied. */
    durationSeconds: integer("duration_seconds"),
    /** When this row was written, as distinct from when the event happened. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotency, enforced by the database rather than by a read-then-write that can race two
    // concurrent deliveries of the same event.
    uniqueIndex("session_provider_events_provider_event_idx").on(table.provider, table.providerEventId),
    /*
      The second idempotency key, and the one that actually catches Daily.

      Daily warns that a duplicate `participant.joined` or `participant.left` **can arrive with a
      different event id**, and recommends deduplicating on the event type together with
      `payload.session_id` — the id of that participant's connection, which this table stores as
      `provider_participant_id`. The unique index above is powerless against that: two rows, two
      event ids, one arrival, counted twice. In attendance evidence a duplicated `participant.left`
      understates somebody's time and a duplicated `joined` overstates their comings and goings,
      and both distort the record in a money argument.

      Partial, and deliberately so:
      - `provider_participant_id IS NOT NULL` — a delivery that carried no participant id cannot be
        deduplicated this way, and must not collide with every other such delivery.
      - the two participant types only — `meeting.started` and `meeting.ended` describe the room
        rather than a person, carry no participant id, and a room legitimately holds several
        meetings.

      Postgres treats a partial unique index as a real constraint, so this is enforced by the
      database rather than by a read-then-write that two concurrent deliveries could race.
    */
    uniqueIndex("session_provider_events_participant_dedupe_idx")
      .on(table.provider, table.eventType, table.providerParticipantId)
      .where(
        sql`${table.providerParticipantId} is not null and ${table.eventType} in ('participant.joined', 'participant.left')`,
      ),
    // The hot read: everything about one class, in order.
    index("session_provider_events_session_idx").on(table.sessionId, table.eventAt),
    // Retention sweeps by *arrival*, not by when the event says it happened; see
    // `lib/sessionProof/retentionSweep.ts` for why the two are not interchangeable.
    index("session_provider_events_received_at_idx").on(table.receivedAt),
    index("session_provider_events_event_at_idx").on(table.eventAt),
  ],
);

export type SessionProviderEvent = typeof sessionProviderEventsTable.$inferSelect;
