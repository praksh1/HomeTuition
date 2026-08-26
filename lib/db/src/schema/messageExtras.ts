import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { messagesTable } from "./messages";
import { usersTable } from "./users";

/**
 * A file sent in a conversation.
 *
 * ### Why not columns on `messages`
 *
 * Because `messages` is read with a bare `select()` in two routes, so the moment a column is
 * declared in the schema and not yet in the database, listing conversations and opening a
 * thread both return 500 — and the API redeploys itself on every push while `db:push` is a
 * step somebody has to remember. A new table costs nothing to a query that never mentions it.
 * Measured, not guessed: `.agents/memory/schema-change-deploy-window.md`.
 *
 * A row per attachment rather than a column pair also leaves room for more than one later
 * without repeating this decision.
 */
export const messageAttachmentsTable = pgTable(
  "message_attachments",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    /** The object-store key. The bytes never pass through this server — see lib/fileStore.ts. */
    fileKey: text("file_key").notNull(),
    fileType: text("file_type").notNull(),
    /**
     * What the sender's phone called it.
     *
     * Kept because the key is a UUID: without this, a received file is "a PDF" and the person
     * who sent it cannot be asked "which one?".
     */
    fileName: text("file_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("message_attachments_message_idx").on(table.messageId)],
);

/**
 * A reaction on a message.
 *
 * One per person per message, replaced rather than stacked: tapping a second emoji changes your
 * reaction, it does not add one. That is what every messaging app does, and the alternative —
 * one person leaving six reactions on the same message — is noise rather than a feature.
 *
 * The emoji is stored as text rather than as a code from a fixed list, because the list is a
 * screen decision and will change; a database that only accepts six of them would need
 * migrating the first time somebody wants a seventh.
 */
export const messageReactionsTable = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One reaction per person per message — enforced here rather than by read-then-write,
    // which two taps in quick succession both pass.
    uniqueIndex("message_reactions_one_each_idx").on(table.messageId, table.userId),
    index("message_reactions_message_idx").on(table.messageId),
  ],
);

export type MessageAttachment = typeof messageAttachmentsTable.$inferSelect;
export type MessageReaction = typeof messageReactionsTable.$inferSelect;
