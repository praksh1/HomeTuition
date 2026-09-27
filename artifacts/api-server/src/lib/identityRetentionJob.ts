/** Scheduler protocol kept independent from PostgreSQL and storage for failure-path tests. */
export interface RetentionBatch { counts: Record<string, number>; failedIds: number[]; nextCursor: number | null }
export interface RetentionJobStore {
  claim(owner: string): Promise<number | null>;
  finish(owner: string, result: { cursor: number; failed: boolean; cycleComplete: boolean }): Promise<boolean>;
}
export async function runIdentityRetentionJob(store: RetentionJobStore, owner: string, sweep: (cursor: number) => Promise<RetentionBatch>) {
  const cursor = await store.claim(owner);
  if (cursor === null) return { state: "busy" as const };
  try {
    const batch = await sweep(cursor);
    const failed = batch.failedIds.length > 0;
    // A failed deletion must not disappear behind the persisted cursor.
    const next = failed ? Math.max(cursor, Math.min(...batch.failedIds) - 1) : batch.nextCursor ?? 0;
    const saved = await store.finish(owner, { cursor: next, failed, cycleComplete: !failed && batch.nextCursor === null });
    return { state: saved ? failed ? "retry" as const : "complete" as const : "lease_lost" as const, counts: batch.counts };
  } catch {
    await store.finish(owner, { cursor, failed: true, cycleComplete: false });
    return { state: "retry" as const };
  }
}
