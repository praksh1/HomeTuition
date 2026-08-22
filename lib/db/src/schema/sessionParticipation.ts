import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * Who was actually in a class, for how long, and what they did there.
 *
 * This exists because of refunds. A student who asks for their money back says one thing and
 * the teacher says another, and today there is nothing in between the two — the app knows a
 * class was booked and knows it was marked completed, and knows nothing whatsoever about
 * whether anybody turned up. Every rule the owner wants ("the teacher was more than ten
 * minutes late", "the teacher never came", "a network problem on the teacher's side is an
 * automatic refund") is a question about presence, and none of them can be answered from the
 * rows this project had.
 *
 * So this is the ledger the disputes read from. It is written by the classroom hub, from the
 * one thing neither side can argue with: whether the socket was open.
 *
 * A separate table rather than columns on `session_enrollments`, for the reason recorded on
 * `session_activity` — Drizzle names every column in a bare `select()`, several routes select
 * enrolments that way, and a column added there is a 500 on the booking path from the moment
 * the code deploys until someone runs `db:push` by hand. It also has to hold the *teacher*,
 * who has no enrolment row at all, and the teacher's attendance is the half that decides most
 * disputes.
 *
 * Nothing here is a judgement. It is what happened; the rules live in lib/sessionEvidence.ts
 * and the deciding lives with a person.
 */
export const sessionParticipationTable = pgTable(
  "session_participation",
  {
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * Their part in *this* class — "teacher" only for the teacher who owns it.
     *
     * Deliberately not the account role. A teacher who books someone else's class is a student
     * in it, and a dispute about that class must not read them as the person who should have
     * turned up to teach.
     */
    role: text("role").notNull(),
    /** The first moment their classroom connection was open. Never rewritten once set. */
    firstJoinedAt: timestamp("first_joined_at", { withTimezone: true }).notNull().defaultNow(),
    /** The last moment it was known to be open. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * How long they were connected in total, in milliseconds.
     *
     * Accumulated rather than derived from the two timestamps above, because those cannot tell
     * "present for an hour" from "looked in twice for a minute either side of an hour". The
     * difference between the two is the whole of a dispute about a teacher who left early.
     */
    presentMs: integer("present_ms").notNull().default(0),
    /**
     * How many times their connection was opened.
     *
     * One is a person who joined and stayed. Twenty is a person whose network kept dropping —
     * which is the "any network related issue from the teacher is an automatic refund" case,
     * and the only signal we have for it that does not depend on either side reporting it.
     */
    joinCount: integer("join_count").notNull().default(0),
    /**
     * Board writes: strokes committed and scene updates sent.
     *
     * One per board-changing message, not per shape — Excalidraw re-sends an element on every
     * frame of a drag, so counting shapes would say a teacher who drew one line and moved it
     * about had drawn four hundred things. Zero from a teacher is the number that matters.
     */
    drawCount: integer("draw_count").notNull().default(0),
    /** Classroom chat messages sent. */
    messageCount: integer("message_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })],
);

export type SessionParticipation = typeof sessionParticipationTable.$inferSelect;
