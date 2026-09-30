import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

import { messagesTable } from "./messages";
import { usersTable } from "./users";

/** A blocked sender's message remains as private evidence, invisible to its recipient. */
export const messageDeliverySuppressionsTable = pgTable("message_delivery_suppressions", {
  messageId: integer("message_id").primaryKey().references(() => messagesTable.id, { onDelete: "cascade" }),
  hiddenFromUserId: integer("hidden_from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
