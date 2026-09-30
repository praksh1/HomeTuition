import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

import { disputesTable } from "./disputes";
import { usersTable } from "./users";

/** An operator-only link from a Help Desk ticket to the person it reports. */
export const userReportsTable = pgTable("user_reports", {
  ticketId: integer("ticket_id").primaryKey().references(() => disputesTable.id, { onDelete: "cascade" }),
  reportedUserId: integer("reported_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
