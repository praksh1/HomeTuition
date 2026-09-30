import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

/** Read-only compatibility adapter, not account-closure or identity collection activation.
 * Older deployments may not have the additive closure table. An installed table or query
 * failure must never silently turn a closed account into an available account.
 * Callers arranging commitments hold the same user row before consulting this read.
 */
export async function accountClosureCompleted(userId: number, source?: Pick<typeof db, "execute">): Promise<boolean> {
  const reader = source ?? (await import("@workspace/db")).db;
  const exists = await reader.execute(sql`SELECT to_regclass('account_closure_requests') AS table_name`);
  if (!exists.rows[0]?.table_name) return false;
  const result = await reader.execute(sql`SELECT 1 FROM account_closure_requests WHERE user_id=${userId} AND status='closed'`);
  return result.rows.length > 0;
}
