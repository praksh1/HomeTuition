import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
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
