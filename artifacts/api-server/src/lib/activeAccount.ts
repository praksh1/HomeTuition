import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import type { JwtPayload } from "./auth";

/** A signed token is identity evidence, not permission to ignore a later suspension or role change. */
export async function activeAccount(payload: JwtPayload): Promise<JwtPayload | null> {
  if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0) return null;
  const [user] = await db.select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt })
    .from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user || user.suspendedAt || !["teacher", "student", "admin"].includes(user.role)) return null;
  return { ...payload, role: user.role };
}
