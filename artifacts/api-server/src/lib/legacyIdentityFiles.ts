/** Old citizenship uploads are quarantined, not deleted or migrated without a retention review. */
export async function isLegacyIdentityFile(key: string): Promise<boolean> {
  const [{ db, teacherCredentialsTable }, { and, eq }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
  const [record] = await db.select({ id: teacherCredentialsTable.id }).from(teacherCredentialsTable)
    .where(and(eq(teacherCredentialsTable.fileKey, key), eq(teacherCredentialsTable.documentType, "citizenship"))).limit(1);
  return !!record; // Including withdrawn/rejected records: a historical ID must not become shareable.
}
