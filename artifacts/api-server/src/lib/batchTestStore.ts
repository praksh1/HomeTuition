import { eq, sql } from "drizzle-orm";
import { batchTestSessionsTable, db, sessionsTable } from "@workspace/db";

type Reader = Pick<typeof db, "select">;

/** Materialised class lessons are not separately sold single lessons. */
export const notABatchTestLesson = sql`NOT EXISTS (SELECT 1 FROM batch_test_sessions bt WHERE bt.session_id = ${sessionsTable.id})`;

export async function batchTestForSession(sessionId: number, reader: Reader = db) {
  const [row] = await reader.select({ batchId: batchTestSessionsTable.batchId }).from(batchTestSessionsTable)
    .where(eq(batchTestSessionsTable.sessionId, sessionId));
  return row?.batchId ?? null;
}
