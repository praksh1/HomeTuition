import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, identityVerificationsTable as identities, identityAccessEventsTable as events } from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Called INSIDE the transaction completing an actual account closure, never on suspension.
 * The caller must persist closed-account state and revoke access in this SAME transaction.
 * Does not itself close an account, delete documents, resolve payments, or release holds.
 * Lock order matches submission: user first, then identity records in increasing ID order.
 */
export async function recordIdentityAccountClosure(tx: Transaction, userId: number, closedAt: Date) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isFinite(closedAt.getTime()) || closedAt.getTime() > Date.now()) {
    throw Error("Invalid account closure reference.");
  }
  const [user] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id,userId)).for("update");
  if (!user) throw Error("Account closure target does not exist.");
  const records = await tx.select({ id: identities.id, closedAt: identities.accountClosedAt })
    .from(identities).where(eq(identities.userId,userId)).orderBy(identities.id).for("update");
  // A retry cannot extend retention by moving the original closure date forward.
  if (records.some(row => row.closedAt && row.closedAt.getTime() !== closedAt.getTime())) {
    throw Error("Account closure date conflicts with the original closure.");
  }
  const pending = records.filter(row => !row.closedAt);
  if (!pending.length) return { stamped: 0 };
  await tx.update(identities).set({ accountClosedAt: closedAt })
    .where(and(eq(identities.userId,userId),isNull(identities.accountClosedAt)));
  await tx.insert(events).values(pending.map(row => ({
    verificationId: row.id, actorId: userId, action: "account_closed", purpose: "account_closure_retention",
  })));
  return { stamped: pending.length };
}
