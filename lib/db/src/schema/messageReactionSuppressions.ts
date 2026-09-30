import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

import { messageReactionsTable } from "./messageExtras";
import { usersTable } from "./users";

/** A blocked sender's new reaction is retained but hidden from the blocker. */
export const messageReactionSuppressionsTable = pgTable("message_reaction_suppressions", {
  reactionId: integer("reaction_id").primaryKey().references(() => messageReactionsTable.id, { onDelete: "cascade" }),
  hiddenFromUserId: integer("hidden_from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
