import { and, eq, gt, sql } from "drizzle-orm";
import { db, identityVerificationsTable as identities, identityAccessEventsTable as events } from "@workspace/db";
import { ensureIdentitySchema } from "./identitySchema";
import { deleteIdentityFile } from "./identityFiles";
import { applyIdentityRetention, type IdentityRetentionStore } from "./identityRetention";
import type { IdentityStatus } from "./identityPolicy";

/** One row lock covers the hold check, strict storage deletion, metadata purge and audit receipt. */
export async function retainIdentityRecord(id: number, now = new Date()): Promise<string> {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '45s'`);
    const store: IdentityRetentionStore = {
      async withLockedRecord(recordId, work) {
        const [row] = await tx.select().from(identities).where(eq(identities.id,recordId)).for("update");
        if (!row) throw Error("Identity retention record is missing.");
        return work({ ...row, status: row.status as IdentityStatus });
      },
      deletePrivateFile: deleteIdentityFile,
      async recordDeletion(recordId, result) {
        await tx.update(identities).set({ fileKey: null, fileDeletedAt: result.fileDeletedAt,
          ...(result.eraseDetails ? { detailsCiphertext: null, detailsDeletedAt: now } : {}) }).where(eq(identities.id,recordId));
        await tx.insert(events).values({ verificationId: recordId, actorId: null,
          action: result.eraseDetails ? "private_details_deleted" : "document_deleted", purpose: "retention" });
      },
      async flagHoldReview(recordId) {
        const [row] = await tx.select().from(identities).where(eq(identities.id,recordId));
        // One queue item per unreviewed hold cycle, not one new audit entry every sweep.
        if (row?.holdReviewRequestedAt && row.holdReviewRequestedAt >= (row.holdReviewedAt ?? row.holdStartedAt!)) return;
        await tx.update(identities).set({ holdReviewRequestedAt: now }).where(eq(identities.id,recordId));
        await tx.insert(events).values({ verificationId: recordId, actorId: null, action: "hold_review_requested", purpose: "retention" });
      },
    };
    return applyIdentityRetention(store,id,now);
  });
}

/** Small bounded batch. The scheduler persists the cursor and retries failed objects. */
export async function sweepIdentityRetention(afterId = 0, now = new Date()) {
  if (!Number.isSafeInteger(afterId) || afterId < 0) throw Error("Invalid retention cursor.");
  await ensureIdentitySchema();
  const rows = await db.select({ id: identities.id }).from(identities)
    .where(and(gt(identities.id,afterId),sql`(${identities.fileDeletedAt} IS NULL OR ${identities.detailsDeletedAt} IS NULL)`))
    .orderBy(identities.id).limit(11);
  const counts: Record<string, number> = {};
  const failedIds: number[] = [];
  const started = Date.now(); let lastId = afterId; let processed = 0;
  for (const { id } of rows.slice(0,10)) {
    try { const action = await retainIdentityRecord(id,now); counts[action] = (counts[action] ?? 0) + 1; }
    catch { failedIds.push(id); } // No DB error objects or legal data in operational results.
    lastId = id; processed += 1;
    if (Date.now() - started > 90_000) break;
  }
  return { counts, failedIds, nextCursor: rows.length > processed ? lastId : null };
}
