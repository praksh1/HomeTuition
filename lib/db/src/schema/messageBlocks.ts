import { integer, pgTable, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** A block hides later messages from its creator; it never deletes evidence. */
export const messageBlocksTable = pgTable("message_blocks", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  blockedUserId: integer("blocked_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.blockedUserId] })]);
