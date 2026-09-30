/** Old citizenship uploads are quarantined, not deleted or migrated without a retention review. */
export async function isLegacyIdentityFile(key: string): Promise<boolean> {
  const [{ db, teacherCredentialsTable }, { and, eq }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
  const [record] = await db.select({ id: teacherCredentialsTable.id }).from(teacherCredentialsTable)
    .where(and(eq(teacherCredentialsTable.fileKey, key), eq(teacherCredentialsTable.documentType, "citizenship"))).limit(1);
  return !!record; // Including withdrawn/rejected records: a historical ID must not become shareable.
}

/** Review remains possible without making an ID an ordinary, shareable attachment. */
export async function mayReviewLegacyIdentityFile(key: string, operatorId: number): Promise<boolean> {
  if (!Number.isSafeInteger(operatorId) || operatorId <= 0) return false;
  const [{ db, usersTable, operatorAccountsTable }, { eq }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
  const [operator] = await db.select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt })
    .from(usersTable).where(eq(usersTable.id, operatorId)).limit(1);
  // A previously issued admin token is not evidence of current review authority.
  if (!operator || operator.role !== "admin" || operator.suspendedAt !== null) return false;
  const [account] = await db.select({ disabledAt: operatorAccountsTable.disabledAt, mustChangePassword: operatorAccountsTable.mustChangePassword })
    .from(operatorAccountsTable).where(eq(operatorAccountsTable.userId, operatorId)).limit(1);
  // Match the support desk's live operator restrictions, even while its user row remains admin.
  if (account && (account.disabledAt !== null || account.mustChangePassword !== false)) return false;
  // Pre-operator legacy admins remain compatible until explicit strict enforcement is enabled.
  if (!account && process.env.OPERATOR_SITE_ENFORCEMENT_ENABLED === "true") return false;
  return isLegacyIdentityFile(key); // Exact stored key, including withdrawn/rejected historical IDs.
}
