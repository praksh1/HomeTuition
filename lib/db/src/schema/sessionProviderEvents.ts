import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";

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
     * The Sikshya user, only when the provider echoes one back from a token this server minted.
     *
     * Null for every event today. `lib/daily.ts` mints tokens without a `user_id` claim, so Daily
     * can report that *an owner* joined and never *which account*. Deliberately not a foreign key:
     * a value that arrives from outside should not be able to fail an insert, and a webhook that
     * throws is a webhook that gets retried forever.
     */
    participantUserId: integer("participant_user_id"),
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
    // The hot read: everything about one class, in order.
    index("session_provider_events_session_idx").on(table.sessionId, table.eventAt),
    // Retention sweeps by age; see `lib/sessionProof/retention.ts`.
    index("session_provider_events_event_at_idx").on(table.eventAt),
  ],
);

export type SessionProviderEvent = typeof sessionProviderEventsTable.$inferSelect;
