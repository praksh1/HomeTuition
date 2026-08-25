import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A customer-care operator's account, as the administrator issued it.
 *
 * Operators do not register. The owner's decision, and the reason the support desk moved to a
 * site of its own: an administrator creates the ID, hands over a password that works once, and
 * the operator replaces it before they can do anything. Nobody — the administrator included —
 * knows an operator's working password.
 *
 * ### Why a table and not columns on `users`
 *
 * Because a new column on `users` takes sign-in down until `db:push` runs. The API redeploys
 * itself on every push and `db:push` is a step somebody has to remember; in that window the
 * login query asks for a column the database does not have and every sign-in — teacher,
 * student, everyone — returns 500. A new *table* costs nothing to a query that never mentions
 * it. Measured, not guessed: see `.agents/memory/schema-change-deploy-window.md`.
 *
 * ### Why a login ID rather than an email
 *
 * An operator is issued an identity by their employer; they do not bring one. Email also
 * carries a recovery path this account deliberately does not have — there is no "forgot
 * password" for an operator, because the administrator can reissue and that is the whole
 * control. `users.email` still holds a placeholder so the row is well-formed, but nothing
 * signs in with it.
 */
export const operatorAccountsTable = pgTable(
  "operator_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * What the operator types to sign in. Lowercased on the way in, unique across operators.
     *
     * Kept apart from `users.email` so that an operator ID can be something an employer would
     * actually issue — `bina.karki`, `support02` — rather than an address nobody reads.
     */
    loginId: text("login_id").notNull(),
    /**
     * An administrator may create and disable other operators. An operator may not.
     *
     * Separate from `users.role`, which stays `admin` for both: the role answers "may this
     * person work the support desk", and this answers "may they hand that power to somebody
     * else". Rolling those two into one word is how a support tool ends up able to create its
     * own operators, which is the thing this design exists to prevent.
     */
    isAdministrator: boolean("is_administrator").notNull().default(false),
    /**
     * True from the moment the account is created until the operator sets their own password.
     *
     * Enforced by the server on every support-desk request, not by the screen: a forced change
     * that only the app insists on is a suggestion. While this is true the only thing the
     * account can do is change its password.
     */
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    /** Who issued it. Null once that administrator's own account is deleted. */
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    /**
     * Set when an administrator takes the account out of service.
     *
     * Disabled rather than deleted, so the tickets this operator touched keep a name against
     * them. A support decision with an anonymous author is not one anybody can appeal.
     */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledBy: integer("disabled_by").references(() => usersTable.id, { onDelete: "set null" }),
    /** Last successful sign-in, so an administrator can see which IDs are actually in use. */
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One operator account per person, and one person per login ID.
    uniqueIndex("operator_accounts_user_idx").on(table.userId),
    uniqueIndex("operator_accounts_login_idx").on(table.loginId),
    index("operator_accounts_created_idx").on(table.createdAt),
  ],
);

export type OperatorAccount = typeof operatorAccountsTable.$inferSelect;
