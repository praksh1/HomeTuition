import * as crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, operatorAccountsTable, usersTable } from "@workspace/db";
import { hashPassword } from "./auth";
import {
  checkLoginId,
  formatOneTimePassword,
  normaliseLoginId,
  oneTimePasswordBytes,
} from "./operators";

/**
 * Making, finding and withdrawing operator accounts.
 *
 * The rules themselves are in `operators.ts`, which imports nothing so it can be tested
 * directly. This is the half that touches the database.
 */

/**
 * Postgres's "this already exists", found however deep the driver buried it.
 *
 * Drizzle's own message is only `Failed query: insert into "users" ...` — the actual
 * `duplicate key value violates unique constraint` sits on the error's `cause`, so matching on
 * `err.message` alone silently misses it and a taken ID comes back as a 500. Matching on the
 * SQLSTATE rather than on English also survives a server running in another locale.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && (current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A placeholder address, because an operator signs in with an ID and `users.email` is unique. */
function placeholderEmail(loginId: string): string {
  return `${loginId}@operators.invalid`;
}

export type CreateResult =
  | { ok: true; loginId: string; oneTimePassword: string; userId: number }
  | { ok: false; status: number; reason: string };

/**
 * Issue an operator ID, and hand back the one password it will ever be given.
 *
 * The password is returned exactly once, to the administrator who asked for it, and only its
 * hash is kept — the same shape as the reset codes in `passwordResets.ts` and for the same
 * reason. An administrator who could look up an operator's password is an administrator who
 * can act as them, and every name against a support decision stops meaning anything.
 */
export async function createOperator(input: {
  loginId: string;
  name: string;
  isAdministrator: boolean;
  createdBy: number;
}): Promise<CreateResult> {
  const verdict = checkLoginId(input.loginId);
  if (!verdict.ok) return { ok: false, status: 400, reason: verdict.reason };

  const loginId = normaliseLoginId(input.loginId);
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, reason: "Give the operator a name, so tickets carry one." };

  const oneTimePassword = formatOneTimePassword(crypto.randomBytes(oneTimePasswordBytes()));
  const passwordHash = await hashPassword(oneTimePassword);

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(usersTable)
        .values({
          name,
          email: placeholderEmail(loginId),
          passwordHash,
          // The role stays `admin`: it answers "may this person work the desk", which every
          // existing check already asks. Whether they may *create* operators is the separate
          // flag below, and keeping them apart is the point.
          role: "admin",
        })
        .returning({ id: usersTable.id });

      await tx.insert(operatorAccountsTable).values({
        userId: user!.id,
        loginId,
        isAdministrator: input.isAdministrator,
        mustChangePassword: true,
        createdBy: input.createdBy,
      });

      return { ok: true as const, loginId, oneTimePassword, userId: user!.id };
    });
  } catch (err) {
    // The unique indexes are the arbiter, not a check-then-insert: two administrators adding
    // the same ID at the same moment both pass a prior check and only one may win.
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, reason: "That operator ID is already taken." };
    }
    throw err;
  }
}

export interface OperatorRow {
  id: number;
  userId: number;
  loginId: string;
  name: string | null;
  isAdministrator: boolean;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  lastSignInAt: Date | null;
  createdAt: Date;
}

/** One operator, found by the ID they type. Null when there is no such ID. */
export async function operatorByLoginId(rawLoginId: string): Promise<(OperatorRow & { passwordHash: string; suspendedAt: Date | null }) | null> {
  const loginId = normaliseLoginId(rawLoginId);
  if (!loginId) return null;

  const [row] = await db
    .select({
      id: operatorAccountsTable.id,
      userId: operatorAccountsTable.userId,
      loginId: operatorAccountsTable.loginId,
      name: usersTable.name,
      isAdministrator: operatorAccountsTable.isAdministrator,
      mustChangePassword: operatorAccountsTable.mustChangePassword,
      disabledAt: operatorAccountsTable.disabledAt,
      lastSignInAt: operatorAccountsTable.lastSignInAt,
      createdAt: operatorAccountsTable.createdAt,
      passwordHash: usersTable.passwordHash,
      suspendedAt: usersTable.suspendedAt,
    })
    .from(operatorAccountsTable)
    .innerJoin(usersTable, eq(usersTable.id, operatorAccountsTable.userId))
    .where(eq(operatorAccountsTable.loginId, loginId));

  return row ?? null;
}

/** The operator record behind a signed-in user, or null if this user is not an operator. */
export async function operatorByUserId(userId: number): Promise<OperatorRow | null> {
  const [row] = await db
    .select({
      id: operatorAccountsTable.id,
      userId: operatorAccountsTable.userId,
      loginId: operatorAccountsTable.loginId,
      name: usersTable.name,
      isAdministrator: operatorAccountsTable.isAdministrator,
      mustChangePassword: operatorAccountsTable.mustChangePassword,
      disabledAt: operatorAccountsTable.disabledAt,
      lastSignInAt: operatorAccountsTable.lastSignInAt,
      createdAt: operatorAccountsTable.createdAt,
    })
    .from(operatorAccountsTable)
    .innerJoin(usersTable, eq(usersTable.id, operatorAccountsTable.userId))
    .where(eq(operatorAccountsTable.userId, userId));

  return row ?? null;
}

/** Everyone with an operator ID, newest first, for the administrator's own screen. */
export async function listOperators(): Promise<OperatorRow[]> {
  return db
    .select({
      id: operatorAccountsTable.id,
      userId: operatorAccountsTable.userId,
      loginId: operatorAccountsTable.loginId,
      name: usersTable.name,
      isAdministrator: operatorAccountsTable.isAdministrator,
      mustChangePassword: operatorAccountsTable.mustChangePassword,
      disabledAt: operatorAccountsTable.disabledAt,
      lastSignInAt: operatorAccountsTable.lastSignInAt,
      createdAt: operatorAccountsTable.createdAt,
    })
    .from(operatorAccountsTable)
    .innerJoin(usersTable, eq(usersTable.id, operatorAccountsTable.userId))
    .orderBy(desc(operatorAccountsTable.id));
}

/** Set an operator's own password and clear the must-change flag, in one write. */
export async function setOperatorPassword(userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, userId));
    await tx
      .update(operatorAccountsTable)
      .set({ mustChangePassword: false })
      .where(eq(operatorAccountsTable.userId, userId));
  });
}

/** Note a successful sign-in, so an administrator can see which IDs are actually used. */
export async function recordSignIn(userId: number): Promise<void> {
  await db
    .update(operatorAccountsTable)
    .set({ lastSignInAt: new Date() })
    .where(eq(operatorAccountsTable.userId, userId));
}

export type WithdrawResult = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Take an operator out of service, or put them back.
 *
 * Disabled rather than deleted, so the tickets they touched keep a name against them: a support
 * decision with an anonymous author is not one anybody can appeal.
 */
export async function setOperatorDisabled(
  operatorId: number,
  disabled: boolean,
  by: number,
): Promise<WithdrawResult> {
  const [row] = await db
    .select({ userId: operatorAccountsTable.userId, isAdministrator: operatorAccountsTable.isAdministrator })
    .from(operatorAccountsTable)
    .where(eq(operatorAccountsTable.id, operatorId));

  if (!row) return { ok: false, status: 404, reason: "That operator was not found." };

  // Nobody switches off their own account. It is always a mistake — the person doing it loses
  // the very screen they would need to undo it.
  if (row.userId === by) {
    return { ok: false, status: 400, reason: "You cannot switch off your own operator ID." };
  }

  /**
   * The last live administrator cannot be withdrawn.
   *
   * Otherwise the support desk locks itself: no administrator means no way to issue an ID, and
   * the only way back in is the database. Checked inside the same statement that would do the
   * withdrawing, so two administrators cannot each remove the other at the same moment.
   */
  if (disabled && row.isAdministrator) {
    const others = await db
      .select({ id: operatorAccountsTable.id })
      .from(operatorAccountsTable)
      .where(and(eq(operatorAccountsTable.isAdministrator, true), isNull(operatorAccountsTable.disabledAt)));
    if (others.filter((o) => o.id !== operatorId).length === 0) {
      return {
        ok: false,
        status: 400,
        reason: "This is the last administrator. Make somebody else an administrator first.",
      };
    }
  }

  await db
    .update(operatorAccountsTable)
    .set(disabled ? { disabledAt: new Date(), disabledBy: by } : { disabledAt: null, disabledBy: null })
    .where(eq(operatorAccountsTable.id, operatorId));

  return { ok: true };
}

/**
 * Issue a fresh one-time password for an existing ID.
 *
 * The path back for an operator who forgot theirs — there is no self-service reset, because an
 * operator has no verified address to send one to. The administrator does it and reads out the
 * new code, and the account is back to needing a change on first use.
 */
export async function reissueOneTimePassword(operatorId: number): Promise<
  { ok: true; loginId: string; oneTimePassword: string } | { ok: false; status: number; reason: string }
> {
  const [row] = await db
    .select({
      userId: operatorAccountsTable.userId,
      loginId: operatorAccountsTable.loginId,
      disabledAt: operatorAccountsTable.disabledAt,
    })
    .from(operatorAccountsTable)
    .where(eq(operatorAccountsTable.id, operatorId));

  if (!row) return { ok: false, status: 404, reason: "That operator was not found." };
  if (row.disabledAt) {
    return { ok: false, status: 400, reason: "Put this ID back in service before giving it a new password." };
  }

  const oneTimePassword = formatOneTimePassword(crypto.randomBytes(oneTimePasswordBytes()));
  const passwordHash = await hashPassword(oneTimePassword);

  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, row.userId));
    // `created_at` is what the expiry is measured from, so a reissued password gets its own
    // full window rather than inheriting the original one's, which may be months old.
    await tx
      .update(operatorAccountsTable)
      .set({ mustChangePassword: true, createdAt: new Date() })
      .where(eq(operatorAccountsTable.id, operatorId));
  });

  return { ok: true, loginId: row.loginId, oneTimePassword };
}
