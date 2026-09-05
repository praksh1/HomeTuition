import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * What a participant's own device said about its connection.
 *
 * The owner's rule is that "any network related issue from the teacher is an automatic refund", and
 * nothing else in this product can see a bad line. The socket ledger records that a connection
 * opened and closed; it cannot tell a teacher who walked away from a teacher whose broadband died.
 *
 * ## This is the weakest evidence in the product, and is stored as such
 *
 * A sample is a number a participant's own device chose to send about a dispute that participant
 * may be a party to. It is kept in its own table, separate from provider events, precisely so the
 * two are never read as equally authoritative — a summary that mixed them would launder a claim
 * into a fact. `lib/sessionProof/aggregate.ts` labels every figure derived from here as
 * self-reported.
 *
 * ## Deliberately coarse
 *
 * Four words and a flag. No jitter, no packet counts, no bitrates, no candidate addresses, no
 * device identifiers — none of which this product would read, all of which would make this a
 * detailed technical profile of somebody's home. `lib/sessionProof/telemetryBounds.ts` is the
 * sanitiser and drops everything else on the way in.
 *
 * A new table rather than columns on `session_participation` for the reason recorded there: a
 * column on a table read with a bare `select()` is a 500 until `db:push` runs. This is also
 * append-only and many-per-person, which participation is not.
 */
export const sessionQualitySamplesTable = pgTable(
  "session_quality_samples",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    /**
     * Whose device reported it, taken from the authenticated caller and never from the body.
     *
     * A client that could name the subject of its own report could file connection trouble against
     * the other party to its dispute.
     */
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Their part in *this* class, resolved server-side from the membership check.
     *
     * Stored rather than joined so a summary written after an enrolment is removed still says
     * whether the trouble was the teacher's, which is the half that decides most disputes.
     */
    role: text("role").notNull(),
    /** One of good | warning | bad | unknown. Anything else became unknown at the boundary. */
    quality: text("quality").notNull(),
    /** Whether the device reported this sample as following a reconnection. */
    reconnect: boolean("reconnect").notNull().default(false),
    /** When the device says it observed this, bounded to the class's own window. */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    /** When the server accepted it, as distinct from when the device claims it happened. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The hot read: one class's samples in order, and the per-user count the rate limit checks.
    index("session_quality_samples_session_idx").on(table.sessionId, table.userId, table.observedAt),
    // Retention sweeps by age; see `lib/sessionProof/retention.ts`.
    // Retention sweeps by arrival, so a sample is kept the full window from when we got it rather
    // than from a timestamp its own device chose. See `lib/sessionProof/retentionSweep.ts`.
    index("session_quality_samples_received_at_idx").on(table.receivedAt),
    index("session_quality_samples_observed_at_idx").on(table.observedAt),
  ],
);

export type SessionQualitySample = typeof sessionQualitySamplesTable.$inferSelect;
