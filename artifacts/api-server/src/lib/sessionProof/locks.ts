import { sql, type SQL } from "drizzle-orm";

/**
 * One lock namespace for every writer and the retention reader of session-proof rows.
 *
 * PostgreSQL's two-integer advisory locks share a database-wide namespace, so the first integer
 * is a deliberately fixed application key and the second is the Fadko session id. Writers take
 * a shared transaction lock: several participants can report at once. Retention takes the
 * exclusive form before reading any row for the class, so it sees either the writer's committed
 * row or completes before that writer may insert. Transaction locks release on commit/rollback.
 *
 * These helpers must only be called with a transaction executor. Calling an xact lock through the
 * pool outside a transaction would release it at the end of that one statement and protect
 * nothing.
 */
export const SESSION_PROOF_LOCK_NAMESPACE = 1_397_764_943;

export interface SessionProofLockExecutor {
  execute(query: SQL): Promise<unknown>;
}

function validSessionId(sessionId: number): void {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || sessionId > 2_147_483_647) {
    throw new Error("A session-proof advisory lock requires a positive 32-bit session id.");
  }
}

/** Shared: provider and authenticated client evidence writers. */
export async function lockSessionProofWriter(
  tx: SessionProofLockExecutor,
  sessionId: number,
): Promise<void> {
  validSessionId(sessionId);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock_shared(${SESSION_PROOF_LOCK_NAMESPACE}, ${sessionId})`,
  );
}

/** Exclusive: aggregate-before-delete retention for one complete class. */
export async function lockSessionProofRetention(
  tx: SessionProofLockExecutor,
  sessionId: number,
): Promise<void> {
  validSessionId(sessionId);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${SESSION_PROOF_LOCK_NAMESPACE}, ${sessionId})`,
  );
}
