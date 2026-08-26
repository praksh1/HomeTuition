import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionMessagesTable } from "./sessionMessages";
import { usersTable } from "./users";

/**
 * A file sent in a class conversation.
 *
 * The owner's requirement: *"The Sikshya's chat features everywhere in the app must have
 * similar features — the chat within the Monthly Sessions/Regular Session should also have the
 * same features as in the Messages Tab."* They are right, and the reason is not consistency for
 * its own sake: a student photographing their working and sending it to their teacher is the
 * single most useful thing a chat can do in a tuition app, and it worked in one of the two
 * places that chat exists.
 *
 * ### Why a separate table from `message_attachments`
 *
 * Because a class message and a private message are different rows in different tables, with
 * different answers to "who may read this". One table with two nullable foreign keys would mean
 * every read had to remember which one applied, and the day somebody forgot, a private
 * attachment would surface in a classroom. Two tables cannot make that mistake.
 *
 * New tables rather than columns for the same reason as the private ones: `session_messages` is
 * read on the classroom path and the API redeploys itself before `db:push` runs. See
 * `.agents/memory/schema-change-deploy-window.md`.
 */
export const sessionMessageAttachmentsTable = pgTable(
  "session_message_attachments",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => sessionMessagesTable.id, { onDelete: "cascade" }),
    /** The object-store key. The bytes never pass through this server — see lib/fileStore.ts. */
    fileKey: text("file_key").notNull(),
    fileType: text("file_type").notNull(),
    /** What the sender's phone called it; the key itself is a UUID and says nothing. */
    fileName: text("file_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("session_message_attachments_message_idx").on(table.messageId)],
);

/**
 * A reaction on a class message.
 *
 * One per person per message, replaced rather than stacked — the same rule as a private
 * conversation, and worth more here: a class of thirty acknowledging a message with a thumb is
 * thirty rows and one chip, where thirty replies saying "ok sir" is a thread nobody can read.
 */
export const sessionMessageReactionsTable = pgTable(
  "session_message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => sessionMessagesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_message_reactions_one_each_idx").on(table.messageId, table.userId),
    index("session_message_reactions_message_idx").on(table.messageId),
  ],
);

export type SessionMessageAttachment = typeof sessionMessageAttachmentsTable.$inferSelect;
export type SessionMessageReaction = typeof sessionMessageReactionsTable.$inferSelect;
