import { randomUUID } from "node:crypto";
import express, { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, usersTable, disputesTable, sessionsTable, sessionEnrollmentsTable, userNotificationEventsTable, identityVerificationsTable as identities, identityAccessEventsTable as events } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { operatorByUserId } from "../lib/operatorStore";
import { emailVerifiedFor } from "../lib/accountSecurity";
import { ensureIdentitySchema } from "../lib/identitySchema";
import { identityCollectionEnabled, identityStorageReady, identityEncryptionKey, putIdentityFile, readIdentityFile, identityDocumentType } from "../lib/identityFiles";
import { IDENTITY_MAX_BYTES, IDENTITY_POLICY_VERSION, identityStatusSummary, validateIdentityDetails, type IdentityStatus, type IdentityHolder } from "../lib/identityPolicy";
import { sealIdentity, openIdentity } from "../lib/identityCrypto";
import { mayDecideIdentity } from "../lib/identityReviewPolicy";
import { identityRetentionHealth } from "../lib/identityRetentionScheduler";
import { notifyUser } from "../ws/userHub";
import { identityHoldChange, identityHoldSummary, parseIdentityHoldRequest } from "../lib/identityHoldPolicy";

const router: IRouter = Router();
const summary = (row: typeof identities.$inferSelect) => ({ ...identityStatusSummary({ ...row, status: row.status as IdentityStatus, holder: row.holder as IdentityHolder }), rejectionCode: row.rejectionCode });
const context = (userId: number, id: number) => `user:${userId}:record:${id}`;
const rejectionCodes = ["unreadable", "missing_side", "details_mismatch", "wrong_document", "consent_required"];
const unavailable = (res: Response) => res.status(503).json({ error: "Private identity verification is unavailable right now. Please try again later.", code: "IDENTITY_UNAVAILABLE" });

async function enabled(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  if (!identityCollectionEnabled() || !identityStorageReady()) { unavailable(res); return; }
  try { await ensureIdentitySchema(); next(); } catch { unavailable(res); }
}
// Pausing new collection must not stop an operator reviewing or releasing existing fraud holds.
async function reviewEnabled(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  if (!identityStorageReady()) { unavailable(res); return; }
  try { await ensureIdentitySchema(); next(); } catch { unavailable(res); }
}
async function collectionReady(_req: Request, res: Response, next: NextFunction) {
  try {
    if (!(await identityRetentionHealth()).healthy) { unavailable(res); return; }
    next();
  } catch { unavailable(res); }
}
async function account(req: Request) {
  const [user] = await db.select({ id: usersTable.id, role: usersTable.role, suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, req.user!.userId));
  return user && !user.suspendedAt && (user.role === "teacher" || user.role === "student") ? user : null;
}

router.get("/identity-verification/me", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");
  // Student citizenship is not required at launch. Keep the private workflow in source for
  // a future policy change, but do not invite students to send documents we do not need.
  if (req.user?.role === "student") { res.json({ enabled: false, verification: null }); return; }
  if (!identityCollectionEnabled()) { res.json({ enabled: false, verification: null }); return; }
  try {
    await ensureIdentitySchema();
    const user = await account(req);
    if (!user) { res.status(403).json({ error: "This account cannot submit identity documents." }); return; }
    const [row] = await db.select().from(identities).where(eq(identities.userId, user.id)).orderBy(desc(identities.id)).limit(1);
    const available = identityStorageReady() && (await identityRetentionHealth()).healthy;
    res.json({ enabled: true, available, verification: row ? summary(row) : null });
  } catch { unavailable(res); }
});

/** Preparation is resumable. Legal fields are encrypted; no original filenames are saved. */
router.post("/identity-verification/prepare", requireAuth, enabled, collectionReady, async (req, res) => {
  try {
    const user = await account(req);
    if (!user) { res.status(403).json({ error: "This account cannot submit identity documents." }); return; }
    if (user.role === "student") { res.status(403).json({ error: "Students do not need to upload a citizenship document to use Fadko." }); return; }
    const parsed = validateIdentityDetails(req.body, user.role);
    if (!parsed.ok) { res.status(400).json({ error: "Check the highlighted fields.", fields: parsed.errors }); return; }
    if (!await emailVerifiedFor(user.id)) { res.status(403).json({ error: "Verify your email before submitting a private identity document.", code: "EMAIL_VERIFICATION_REQUIRED" }); return; }
    const result = await db.transaction(async tx => {
      // Serialize duplicate tabs/retries for the same account; never trust a browser-only busy flag.
      await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).for("update");
      const attempts = await tx.select({ id: events.id }).from(events).where(and(eq(events.actorId,user.id),eq(events.action,"prepared"),gte(events.createdAt,new Date(Date.now()-3_600_000)))).limit(10);
      if (attempts.length >= 10) return { status: 429, body: { error: "Please wait before trying again. Your existing submission has been kept." } };
      const [current] = await tx.select().from(identities).where(eq(identities.userId, user.id)).orderBy(desc(identities.id)).limit(1);
      if (current && ["submitted", "approved"].includes(current.status)) return { status: 409, body: { error: "Your document is already submitted. Check its review status before uploading again." } };
      const recent = await tx.select({ id: identities.id }).from(identities).where(and(eq(identities.userId, user.id), gte(identities.createdAt, new Date(Date.now()-86_400_000))));
      if (recent.length >= 3 && current?.status !== "pending_upload") return { status: 429, body: { error: "Please wait before submitting another identity document." } };
      const reusable = current?.status === "pending_upload" && !current.detailsDeletedAt && current.createdAt.getTime() > Date.now()-30*86_400_000;
      const row = reusable ? current! : (await tx.insert(identities).values({ userId: user.id, holder: parsed.value.holder, status: "pending_upload", policyVersion: IDENTITY_POLICY_VERSION,
        encryptionKeyVersion: "v1", consentAt: new Date(), fileKey: `identity/${user.id}/${randomUUID()}.sealed` }).returning())[0]!;
      await tx.update(identities).set({ holder: parsed.value.holder, consentAt: new Date(), detailsCiphertext: sealIdentity(JSON.stringify(parsed.value), identityEncryptionKey(), context(user.id,row.id)) }).where(eq(identities.id,row.id));
      await tx.insert(events).values({ verificationId: row.id, actorId: user.id, action: "prepared", purpose: "identity_submission" });
      return { status: 200, body: { id: row.id, status: "pending_upload" } };
    });
    res.status(result.status).json(result.body);
  } catch { unavailable(res); }
});

router.put("/identity-verification/:id/document", requireAuth, enabled, collectionReady, express.raw({ type: "application/octet-stream", limit: IDENTITY_MAX_BYTES }), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !Buffer.isBuffer(req.body) || !identityDocumentType(req.body)) {
    res.status(400).json({ error: "Choose a JPEG, PNG or PDF no larger than 8 MB.", fields: { document: "Choose a readable photo or PDF of the citizenship card." } }); return;
  }
  try {
    const user = await account(req);
    if (!user) { res.status(403).json({ error: "This account cannot submit identity documents." }); return; }
    if (user.role === "student") { res.status(403).json({ error: "Students do not need to upload a citizenship document to use Fadko." }); return; }
    const result = await db.transaction(async tx => {
      await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id,user.id)).for("update");
      const [row] = await tx.select().from(identities).where(and(eq(identities.id,id),eq(identities.userId,user.id))).for("update");
      if (!row) return { status: 404, body: { error: "Document request not found." } };
      if (row.status === "submitted" || row.status === "approved") return { status: 200, body: { verification: summary(row) } };
      if (row.status !== "pending_upload" || !row.fileKey || !row.detailsCiphertext || row.createdAt.getTime() < Date.now()-30*86_400_000) return { status: 409, body: { error: "Start a new identity submission before uploading." } };
      // The shared pool's idle transaction timeout is 15s; this bounded storage call allows 30s.
      // Keep the row lock (and retry idempotency) without a slow upload losing its transaction.
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '45s'`);
      await putIdentityFile(row.fileKey, req.body);
      const [updated] = await tx.update(identities).set({ status: "submitted" }).where(eq(identities.id,id)).returning();
      await tx.insert(events).values({ verificationId: id, actorId: user.id, action: "submitted", purpose: "identity_submission" });
      return { status: 200, body: { verification: summary(updated!) } };
    });
    res.status(result.status).json(result.body);
  } catch { unavailable(res); }
});

/** ID access is narrower than generic customer support. Explicit reviewer list, fresh role, own password. */
async function reviewer(req: Request, res: Response, next: NextFunction) {
  const allowed = (process.env.IDENTITY_REVIEWER_USER_IDS ?? "").split(",").map(x=>x.trim());
  if (!allowed.includes(String(req.user!.userId))) { res.status(403).json({ error: "You do not have identity-review access." }); return; }
  try {
    const operator = await operatorByUserId(req.user!.userId);
    if (operator && (operator.disabledAt || operator.mustChangePassword)) { res.status(403).json({ error: "Complete your operator sign-in before reviewing identity documents." }); return; }
    next();
  } catch { unavailable(res); }
}
router.get("/identity-review/access", requireAuth, requireAdmin, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const listed = (process.env.IDENTITY_REVIEWER_USER_IDS ?? "").split(",").map(value => value.trim()).includes(String(req.user!.userId));
  if (!listed) { res.json({ allowed: false }); return; }
  try {
    const operator = await operatorByUserId(req.user!.userId);
    res.json({ allowed: identityStorageReady() && !(operator?.disabledAt || operator?.mustChangePassword) });
  } catch { unavailable(res); }
});
router.get("/identity-review/retention-health", requireAuth, requireAdmin, reviewer, async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json(await identityRetentionHealth()); } catch { unavailable(res); }
});
router.use("/identity-review", requireAuth, requireAdmin, reviewer, reviewEnabled);
router.get("/identity-review/holds", async (req, res) => {
  const before = Number(req.query.before);
  try {
    const rows = await db.select({ id: identities.id, userId: identities.userId, holdVersion: identities.holdVersion,
      holdStartedAt: identities.holdStartedAt, holdReviewedAt: identities.holdReviewedAt, holdCaseId: identities.holdCaseId,
      fileDeletedAt: identities.fileDeletedAt, detailsDeletedAt: identities.detailsDeletedAt }).from(identities)
      .where(and(sql`${identities.holdStartedAt} IS NOT NULL`, Number.isSafeInteger(before) && before > 0 ? sql`${identities.id} < ${before}` : undefined))
      .orderBy(desc(identities.id)).limit(31);
    res.json({ items: rows.slice(0, 30).map(row => identityHoldSummary(row)), nextCursor: rows.length > 30 ? rows[29]!.id : null });
  } catch { unavailable(res); }
});
router.get("/identity-review/:id/hold", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Enter a submission number." }); return; }
  try {
    const [row] = await db.select({ id: identities.id, userId: identities.userId, holdVersion: identities.holdVersion,
      holdStartedAt: identities.holdStartedAt, holdReviewedAt: identities.holdReviewedAt, holdCaseId: identities.holdCaseId,
      fileDeletedAt: identities.fileDeletedAt, detailsDeletedAt: identities.detailsDeletedAt }).from(identities).where(eq(identities.id, id));
    if (!row) { res.status(404).json({ error: "Submission not found." }); return; }
    await db.insert(events).values({ verificationId: id, actorId: req.user!.userId, action: "hold_status_opened", purpose: "fraud_investigation" });
    res.json({ hold: identityHoldSummary(row) });
  } catch { unavailable(res); }
});
router.post("/identity-review/:id/hold", async (req, res) => {
  const id = Number(req.params.id); const input = parseIdentityHoldRequest(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !input) { res.status(400).json({ error: "Choose a case, review the current hold and confirm the action." }); return; }
  try {
    const result = await db.transaction(async tx => {
      // Same row lock as cleanup: either preservation wins first, or deleted data stays deleted.
      const [row] = await tx.select().from(identities).where(eq(identities.id, id)).for("update");
      if (!row) return { status: 404, body: { error: "Submission not found." } };
      const [ticket] = await tx.select({ userId: disputesTable.userId, sessionId: disputesTable.sessionId, status: disputesTable.status })
        .from(disputesTable).where(eq(disputesTable.id, input.caseId)).for("share");
      let related = ticket?.userId === row.userId;
      if (!related && ticket?.sessionId) {
        const [session] = await tx.select({ teacherId: sessionsTable.teacherId }).from(sessionsTable).where(eq(sessionsTable.id, ticket.sessionId));
        const [enrollment] = await tx.select({ id: sessionEnrollmentsTable.id }).from(sessionEnrollmentsTable)
          .where(and(eq(sessionEnrollmentsTable.sessionId, ticket.sessionId), eq(sessionEnrollmentsTable.studentId, row.userId))).limit(1);
        related = session?.teacherId === row.userId || !!enrollment;
      }
      const change = identityHoldChange(row, input, req.user!.userId, { related, status: ticket?.status ?? "missing" });
      if (!change.ok) return { status: 409, body: { error: change.error } };
      const [updated] = await tx.update(identities).set(change.patch).where(eq(identities.id, id)).returning();
      // Numeric case reference survives release in the PRIVATE audit, never the ordinary ticket/AI trail.
      await tx.insert(events).values({ verificationId: id, actorId: req.user!.userId, action: change.action, purpose: `fraud_case:${input.caseId}` });
      return { status: 200, body: { hold: identityHoldSummary(updated!) } };
    });
    res.status(result.status).json(result.body);
  } catch { unavailable(res); }
});
router.get("/identity-review", async (req,res) => {
  try {
    const before = Number(req.query.before);
    const rows = await db.select({ id: identities.id, userId: identities.userId, holder: identities.holder, status: identities.status, createdAt: identities.createdAt })
      .from(identities).where(and(eq(identities.status,"submitted"), Number.isSafeInteger(before) && before > 0 ? sql`${identities.id} < ${before}` : undefined)).orderBy(desc(identities.id)).limit(31);
    res.json({ items: rows.slice(0,30), nextCursor: rows.length > 30 ? rows[29]!.id : null });
  } catch { unavailable(res); }
});
router.post("/identity-review/:id/open", async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid review." }); return; }
  try {
    const [exists] = await db.select({ id: identities.id }).from(identities).where(eq(identities.id,id));
    if (!exists) { res.status(404).json({ error: "Identity record is not available for review." }); return; }
    await db.insert(events).values({ verificationId: id, actorId: req.user!.userId, action: "metadata_access_requested", purpose: "identity_review" });
    const result = await db.transaction(async tx => {
      const [row] = await tx.select().from(identities).where(eq(identities.id,id)).for("share");
      if (!row?.detailsCiphertext || row.detailsDeletedAt || row.status === "pending_upload") return null;
      if (row.encryptionKeyVersion !== "v1") throw Error("Unsupported identity key version.");
      const details = JSON.parse(openIdentity(row.detailsCiphertext, identityEncryptionKey(), context(row.userId,row.id)));
      await tx.insert(events).values({ verificationId: id, actorId: req.user!.userId, action: "metadata_opened", purpose: "identity_review" });
      return { verification: summary(row), details };
    });
    if (!result) { res.status(404).json({ error: "Identity record is not available for review." }); return; }
    res.json(result);
  } catch { unavailable(res); }
});
router.post("/identity-review/:id/document", async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid review." }); return; }
  try {
    const [exists] = await db.select({ id: identities.id }).from(identities).where(eq(identities.id,id));
    if (!exists) { res.status(404).json({ error: "This document is no longer available." }); return; }
    await db.insert(events).values({ verificationId: id, actorId: req.user!.userId, action: "document_access_requested", purpose: "identity_review" });
    const file = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '45s'`);
      // Cleanup and hold changes take UPDATE locks; a document read cannot race their decision.
      const [row] = await tx.select().from(identities).where(eq(identities.id,id)).for("share");
      if (!row?.fileKey || row.fileDeletedAt || row.status === "pending_upload") return null;
      const result = await readIdentityFile(row.fileKey);
      await tx.insert(events).values({ verificationId: id, actorId: req.user!.userId, action: "document_opened", purpose: "identity_review" });
      return result;
    });
    if (!file) { res.status(404).json({ error: "This document is no longer available." }); return; }
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Content-Disposition": 'attachment; filename="identity-document"', "Content-Type": file.contentType });
    res.send(file.bytes);
  } catch { unavailable(res); }
});
router.post("/identity-review/:id/decision", async (req,res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  const rejectionCode = decision === "rejected" && rejectionCodes.includes(req.body?.rejectionCode) ? req.body.rejectionCode as string : null;
  if (!Number.isSafeInteger(id) || id <= 0 || !["approved","rejected"].includes(decision) || (decision === "rejected" && !rejectionCode)) { res.status(400).json({ error: "Choose an approval or a specific rejection reason." }); return; }
  try {
    const result = await db.transaction(async tx => {
      const [row] = await tx.select().from(identities).where(eq(identities.id,id)).for("update");
      if (!row || row.status !== "submitted" || row.userId === req.user!.userId) return null;
      const seen = await tx.select({ action: events.action }).from(events).where(and(eq(events.verificationId,id),eq(events.actorId,req.user!.userId),sql`${events.action} IN ('document_opened','metadata_opened')`));
      if (!mayDecideIdentity({ ownerId: row.userId, reviewerId: req.user!.userId, status: row.status, actions: seen.map(event => event.action) })) return null;
      const [updated] = await tx.update(identities).set({ status: decision, rejectionCode, reviewedAt: new Date(), reviewedBy: req.user!.userId }).where(eq(identities.id,id)).returning();
      await tx.insert(events).values({ verificationId:id, actorId:req.user!.userId, action:decision, purpose:"identity_review" });
      // Only a generic update goes to the normal inbox; no legal fields, rejection details or file keys.
      const notice = { kind: "identity_status", at: new Date().toISOString() };
      const [inbox] = await tx.insert(userNotificationEventsTable).values({ userId: row.userId, event: notice }).returning({ id: userNotificationEventsTable.id });
      return { updated: updated!, notice, inboxId: inbox!.id };
    });
    if (!result) { res.status(409).json({ error: "Open this submitted document before deciding. Another reviewer may already have completed it." }); return; }
    // Identity approval is distinct from teacher-account approval. Never silently grant teaching access.
    notifyUser(result.updated.userId, { ...result.notice, inboxId: result.inboxId });
    res.json({ verification: summary(result.updated) });
  } catch { unavailable(res); }
});
export default router;
