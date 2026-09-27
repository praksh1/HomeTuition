import { identityRetentionAction, type IdentityStatus } from "./identityPolicy.ts";

export interface RetainedIdentity {
  id: number; status: IdentityStatus; reviewedAt: Date | null;
  fileKey: string | null; fileDeletedAt: Date | null; detailsDeletedAt: Date | null;
  holdStartedAt: Date | null; holdReviewedAt: Date | null;
  accountClosedAt?: Date | null; createdAt?: Date;
}
export interface IdentityRetentionStore {
  /** Lock this record across hold checks, deletion and outcome persistence. */
  withLockedRecord<T>(id: number, work: (row: RetainedIdentity) => Promise<T>): Promise<T>;
  /** Must reject on storage failure; the ordinary best-effort attachment delete is unsuitable. */
  deletePrivateFile(key: string): Promise<void>;
  /** Commit audit + nulling deleted fields atomically. Never include identity details in the log. */
  recordDeletion(id: number, result: { fileDeletedAt: Date; eraseDetails: boolean }): Promise<void>;
  /** Queue a review without automatically releasing an investigation hold. */
  flagHoldReview(id: number): Promise<void>;
}

/** No runtime scheduler is enabled until its persistence adapter and release checks are ready. */
export async function applyIdentityRetention(store: IdentityRetentionStore, id: number, now: Date): Promise<string> {
  return store.withLockedRecord(id, async row => {
    const action = identityRetentionAction({ ...row, now });
    if (action === "keep") return action;
    if (action === "review_hold") {
      await store.flagHoldReview(row.id);
      return action;
    }
    if (action === "delete_rejected_details" && row.detailsDeletedAt && row.fileDeletedAt) return "keep";
    // A missing file key without a deletion receipt is not proof of deletion.
    if (!row.fileKey && !row.fileDeletedAt) throw new Error("Identity retention needs a file deletion receipt.");
    if (row.fileKey && !row.fileDeletedAt) await store.deletePrivateFile(row.fileKey);
    await store.recordDeletion(row.id, {
      fileDeletedAt: row.fileDeletedAt ?? now,
      eraseDetails: action === "delete_rejected_details" || action === "delete_closed_details" || action === "delete_abandoned_details",
    });
    return action;
  });
}
