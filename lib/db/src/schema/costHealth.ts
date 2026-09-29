import {
  bigserial,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/** Private infrastructure readings only; credentials remain deployment secrets. */
export const ownerCostHealthTable = pgTable(
  "owner_cost_health",
  {
    id: integer("id").primaryKey(),
    settings: jsonb("settings").notNull(),
    snapshot: jsonb("snapshot"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    leaseId: text("lease_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastEmailAt: timestamp("last_email_at", { withTimezone: true }),
    lastEmailStatus: text("last_email_status"),
    updatedBy: integer("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [check("owner_cost_health_id_check", sql`${table.id}=1`)],
);
export const ownerCostHealthHistoryTable = pgTable(
  "owner_cost_health_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    knownSpendUsd: numeric("known_spend_usd"),
  },
  (table) => [index("owner_cost_health_history_time").on(table.checkedAt)],
);
export const ownerCostHealthAlertsTable = pgTable("owner_cost_health_alerts", {
  key: text("key").primaryKey(),
  state: text("state").notNull(),
  attempts: integer("attempts").notNull().default(1),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});
