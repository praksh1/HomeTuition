import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A one-time code that lets somebody set a new password.
 *
 * Issued by a support agent, because email is not configured on this project and a reset link
 * has nowhere to go. The agent reads the code out to whoever they are helping; the person
 * redeems it and chooses their own password.
 *
 * **The agent never learns the password.** That is the whole shape of this: the obvious
 * shortcut — an agent typing a temporary password and reading it out — means every reset
 * leaves a person's account known to somebody else, and a support tool that hands out
 * credentials is a support tool that will eventually be socially engineered.
 *
 * Only the code's hash is stored, for the same reason passwords are hashed: a leaked database
 * should not be a pile of working account-reset codes.
 */
export const passwordResetsTable = pgTable(
  "password_resets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** SHA-256 of the code. The code itself is shown to the agent once and never stored. */
    codeHash: text("code_hash").notNull(),
    /** Short-lived on purpose: a reset code is read out during a conversation, not saved. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when redeemed. A used code is kept rather than deleted, so the log stays complete. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** The agent who issued it. */
    issuedBy: integer("issued_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("password_resets_user_idx").on(table.userId, table.id)],
);

export type PasswordReset = typeof passwordResetsTable.$inferSelect;
