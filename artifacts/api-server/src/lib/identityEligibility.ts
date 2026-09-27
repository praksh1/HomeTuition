import { desc, eq } from "drizzle-orm";
import { db, identityVerificationsTable } from "@workspace/db";
import { identityAccess, type IdentityStatus } from "./identityPolicy";
import { ensureIdentitySchema } from "./identitySchema";

/** Independent of collection: pausing uploads must not lift verification requirements. */
export function identityEnforcementEnabled() { return process.env.IDENTITY_ENFORCEMENT_ENABLED === "true"; }
export async function identityEligible(userId: number, role: "teacher" | "student", source: Pick<typeof db, "select"> = db) {
  if (!identityEnforcementEnabled()) return true;
  // requireAuth/activeAccount independently rejects closed and suspended users. Student
  // citizenship is not a booking requirement, and an unavailable identity store must not
  // strand a student who was never asked to upload a document.
  if (role === "student") return true;
  await ensureIdentitySchema();
  const [record] = await source.select({ status: identityVerificationsTable.status, closedAt: identityVerificationsTable.accountClosedAt })
    .from(identityVerificationsTable).where(eq(identityVerificationsTable.userId, userId)).orderBy(desc(identityVerificationsTable.id)).limit(1).for("share");
  if (record?.closedAt) return false;
  const access = identityAccess(role, (record?.status as IdentityStatus | undefined) ?? null);
  return role === "teacher" ? access.mayAcceptBookings : access.mayBook;
}
