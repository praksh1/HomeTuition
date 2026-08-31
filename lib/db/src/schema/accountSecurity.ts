import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/** Security state kept out of `users`, so an additive rollout cannot break sign-in. */
export const accountSecurityTable = pgTable("account_security", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  passwordAuthEnabled: boolean("password_auth_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** One-time, hashed links for email verification and user-requested password recovery. */
export const accountTokensTable = pgTable(
  "account_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(), // verify_email | reset_password
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_tokens_hash_idx").on(table.tokenHash),
    index("account_tokens_user_idx").on(table.userId, table.purpose, table.id),
  ],
);

/** Stable provider identities. Email is metadata; provider + subject is the identity. */
export const externalIdentitiesTable = pgTable(
  "external_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // google | facebook | apple
    providerSubject: text("provider_subject").notNull(),
    providerEmail: text("provider_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("external_identities_provider_subject_idx").on(table.provider, table.providerSubject),
    index("external_identities_user_idx").on(table.userId, table.id),
  ],
);

export type AccountSecurity = typeof accountSecurityTable.$inferSelect;
export type AccountToken = typeof accountTokensTable.$inferSelect;
export type ExternalIdentity = typeof externalIdentitiesTable.$inferSelect;
