/** Human-only preservation controls. No document contents or free-form allegations are accepted. */
export type IdentityHoldAction = "place" | "review" | "release";
export type IdentityHoldRecord = {
  userId: number; holdVersion: number; holdStartedAt: Date | null;
  holdReviewedAt: Date | null; holdCaseId: number | null;
  fileDeletedAt: Date | null; detailsDeletedAt: Date | null;
};
export function parseIdentityHoldRequest(input: unknown) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!["place", "review", "release"].includes(String(body.action)) || body.confirmed !== true
    || !Number.isSafeInteger(body.caseId) || Number(body.caseId) <= 0
    || !Number.isSafeInteger(body.version) || Number(body.version) < 0) return null;
  return { action: body.action as IdentityHoldAction, caseId: body.caseId as number, version: body.version as number };
}
export function identityHoldChange(row: IdentityHoldRecord, input: NonNullable<ReturnType<typeof parseIdentityHoldRequest>>,
  actorId: number, caseInfo: { related: boolean; status: string }, now = new Date()) {
  if (row.userId === actorId) return { ok: false as const, error: "You cannot manage a hold on your own identity record." };
  if (row.holdVersion !== input.version) return { ok: false as const, error: "This hold changed. Reload the record before deciding." };
  if (!caseInfo.related) return { ok: false as const, error: "Choose a case linked to this account or one of its enrolled classes." };
  if (input.action !== "release" && ["resolved", "denied", "cancelled"].includes(caseInfo.status)) return { ok: false as const, error: "An active investigation case is required to preserve this record." };
  if (input.action === "place" && row.holdStartedAt) return { ok: false as const, error: "A hold already exists. Review or release the existing hold." };
  if (input.action !== "place" && (!row.holdStartedAt || row.holdCaseId !== input.caseId)) return { ok: false as const, error: "Reload the active hold and its case before deciding." };
  if (input.action === "place" && row.fileDeletedAt && row.detailsDeletedAt) return { ok: false as const, error: "The private data has already been deleted. A hold cannot restore it." };
  return { ok: true as const, patch: {
    holdVersion: row.holdVersion + 1,
    holdStartedAt: input.action === "release" ? null : row.holdStartedAt ?? now,
    holdReviewedAt: input.action === "release" ? null : now,
    holdReviewRequestedAt: null,
    holdCaseId: input.action === "release" ? null : input.caseId,
  }, action: `hold_${input.action === "place" ? "placed" : input.action === "review" ? "reviewed" : "released"}` };
}
/** Restricted operator DTO, separate from the account's own status and ordinary support data. */
export function identityHoldSummary(row: IdentityHoldRecord & { id: number }, now = new Date()) {
  const due = row.holdStartedAt ? new Date((row.holdReviewedAt ?? row.holdStartedAt).getTime() + 90 * 86_400_000) : null;
  return { id: row.id, userId: row.userId, version: row.holdVersion, active: !!row.holdStartedAt,
    caseId: row.holdCaseId, reviewDueAt: due?.toISOString() ?? null, overdue: !!due && due <= now,
    documentDeleted: !!row.fileDeletedAt, detailsDeleted: !!row.detailsDeletedAt };
}
