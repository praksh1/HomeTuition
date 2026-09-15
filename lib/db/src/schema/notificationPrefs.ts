import { index, integer, jsonb, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A user's notification switches.
 *
 * Deliberately a table of its own rather than a column on `users`, and that is not a style
 * choice — it was measured. Drizzle names every schema column in its INSERT and in a bare
 * `select()`, so adding a column to `users` breaks registration and sign-in from the moment
 * the code deploys until someone runs `db:push`. Those two are never in step here: the API
 * redeploys itself on every push, while `db:push` is a separate command the owner runs by
 * hand. With the switches on `users`, that gap took the whole app down; with them here, the
 * worst case is that the notifications screen does not work yet.
 *
 * A row appears only when someone changes a setting. No row means "has never touched this",
 * which `readPrefs()` in the API already answers with the defaults — so the sparse table needs
 * no backfill and no default here.
 */
export const userNotificationPrefsTable = pgTable("user_notification_prefs", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** Shape lives in artifacts/api-server/src/lib/notificationPrefs.ts — the one definition. */
  prefs: jsonb("prefs").$type<Record<"push" | "email", Record<string, boolean>>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserNotificationPrefs = typeof userNotificationPrefsTable.$inferSelect;

/**
 * A small durable inbox for events that otherwise exist only while the user's socket is open.
 * Presentation and read state remain on each device; this row is the delivery guarantee that
 * lets the app catch up after sign-in or a dropped connection.
 */
export const userNotificationEventsTable = pgTable("user_notification_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  event: jsonb("event").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("user_notification_events_user_idx").on(table.userId, table.id)]);

export type UserNotificationEvent = typeof userNotificationEventsTable.$inferSelect;

/**
 * Account-level read state for a durable notification.
 *
 * Kept in its own additive table so a deployment never has to alter the durable inbox while
 * people are signing in. A read belongs to the account, not to one browser's local storage.
 */
export const userNotificationEventReadsTable = pgTable("user_notification_event_reads", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => userNotificationEventsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("user_notification_event_reads_user_idx").on(table.userId, table.eventId)]);

export type UserNotificationEventRead = typeof userNotificationEventReadsTable.$inferSelect;
