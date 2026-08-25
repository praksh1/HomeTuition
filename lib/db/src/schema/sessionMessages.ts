import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * The message thread that belongs to one class.
 *
 * Not the same thing as the chat inside a lesson, and the difference is the whole reason this
 * table exists. The classroom chat lives in the hub's memory and is gone when the room empties
 * or the server restarts; it is a conversation *during* a call. This is a conversation *about*
 * a class — before it, during it, and afterwards — and the owner's two uses for it are both
 * ones a disappearing chat cannot serve:
 *
 * - a teacher running late telling the people waiting for them, and
 * - evidence in a refund argument weeks later.
 *
 * Both mean it has to survive a restart and outlive the lesson, so it is written down.
 *
 * Everyone with a place in the class shares one thread — the teacher and every paying student.
 * That is deliberately unlike `messages`, which is one person to one person: "the teacher is
 * ten minutes late" is not something anybody should have to send five times.
 */
export const sessionMessagesTable = pgTable(
  "session_messages",
  {
    id: serial("id").primaryKey(),
    /**
     * The class this thread belongs to — null for a monthly course's thread.
     *
     * A monthly course has thirty classes and **one** conversation, which is the point: a
     * teacher saying "bring your compass tomorrow" should not have to pick which of thirty
     * threads to say it in, and a student should not have to hunt for it. So a monthly thread
     * hangs off `recurringId` instead, and the two never both apply.
     */
    sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "cascade" }),
    /** The monthly course this thread belongs to, when it is one. */
    recurringId: integer("recurring_id"),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * The sender's name as it was when they wrote it.
     *
     * Copied rather than joined, because this is evidence: a thread read in a dispute should
     * say who said what at the time, and not quietly change because somebody edited their
     * profile afterwards.
     */
    senderName: text("sender_name").notNull(),
    /** Their part in this class — "teacher" only for the teacher who owns it. */
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    /**
     * When a teacher pinned this, if they did.
     *
     * Pinning exists because a monthly thread runs for a month and the thing that matters —
     * the exam date, what to bring, the homework — scrolls away in a day. Only the teacher can
     * pin: a class of forty-five where anybody may pin has nothing pinned.
     */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedBy: integer("pinned_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Every read is "this class's messages, oldest first" — often "since message N", when a
    // page that is already open is catching up.
    index("session_messages_session_id_idx").on(table.sessionId, table.id),
    // The same read, for a monthly course's one thread.
    index("session_messages_recurring_idx").on(table.recurringId, table.id),
  ],
);

export type SessionMessage = typeof sessionMessagesTable.$inferSelect;
