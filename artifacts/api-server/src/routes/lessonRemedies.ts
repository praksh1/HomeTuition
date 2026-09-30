import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { LessonRemedyError } from "../lib/lessonRemedies";
import { ScheduleConflictError } from "../lib/scheduleIntervals";
import { db, lessonRemedyCasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { notifyInApp } from "../lib/notify";
import { listLessonRemedies, requestLessonMakeup, offerLessonMakeup, acceptLessonMakeup,
  actOnLessonMakeup, resolveLessonMakeup, RemedyRefusal, validRemedyRequestKey, remedyNote } from "../lib/lessonRemedyStore";

const router = Router();
function id(value: unknown) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function actor(req: Request) { return { userId: req.user!.userId, role: req.user!.role }; }
/** Auxiliary notices run after commit; a failed notice never becomes a failed accepted seat. */
async function sendResult(req: Request, res: Response, result: { caseId: number; batchId: number | null; originalSessionId: number; replacementSessionId: number | null; changed: boolean }) {
  if (result.changed) {
    try {
      const [c] = await db.select().from(lessonRemedyCasesTable).where(eq(lessonRemedyCasesTable.id, result.caseId));
      if (c) for (const userId of [c.studentId, c.teacherId]) notifyInApp(userId, {
        kind: "makeup_update", caseId: c.id, batchId: result.batchId ?? undefined,
        sessionId: result.originalSessionId, replacementSessionId: result.replacementSessionId ?? undefined,
        status: c.status, topic: "Make-up lesson update", at: new Date().toISOString(),
      });
    } catch (error) { req.log.warn({ error, caseId: result.caseId }, "make-up committed; notification preparation failed"); }
  }
  res.setHeader("Cache-Control", "no-store").json(result);
}
function errorResponse(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof RemedyRefusal) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
  if (error instanceof LessonRemedyError) { res.status(409).json({ code: error.code, error: error.message }); return; }
  if (error instanceof ScheduleConflictError) {
    res.status(409).json({ code: "schedule_conflict", error: "This make-up time overlaps an existing class. Choose another time.", issues: error.issues }); return;
  }
  next(error);
}
// Operator accounts must pass the same live desk authorization on every read path.
// An admin token must not bypass a disabled operator or required password rotation.
function authorizeRemedyRead(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "admin") void requireAdmin(req, res, next);
  else next();
}
router.get(["/lesson-remedies", "/class-groups/:batchId/remedies"], requireAuth, authorizeRemedyRead, async (req, res, next) => {
  const batchId = req.params.batchId === undefined ? undefined : id(req.params.batchId);
  if (batchId === null) { res.status(400).json({ error: "Choose a valid class." }); return; }
  try { res.setHeader("Cache-Control", "private, no-store").json(await listLessonRemedies(actor(req), batchId)); }
  catch (error) { errorResponse(error, res, next); }
});
router.get("/admin/lesson-remedies", requireAuth, requireAdmin, async (req, res, next) => {
  try { res.setHeader("Cache-Control", "private, no-store").json(await listLessonRemedies(actor(req))); }
  catch (error) { errorResponse(error, res, next); }
});
router.post("/sessions/:sessionId/makeup-request", requireAuth, async (req, res, next) => {
  const sessionId = id(req.params.sessionId);
  if (!sessionId || !validRemedyRequestKey(req.body?.requestKey) || !["student_missed", "teacher_missed"].includes(req.body?.reason)) {
    res.status(400).json({ error: "Choose a lesson, a reason and a fresh request before continuing." }); return;
  }
  try {
    const note = remedyNote(req.body?.note);
    const result = await requestLessonMakeup(actor(req), sessionId, { reason: req.body.reason, note, requestKey: req.body.requestKey });
    await sendResult(req, res, result);
  } catch (error) { errorResponse(error, res, next); }
});
router.post("/lesson-remedies/:caseId/offer", requireAuth, async (req, res, next) => {
  const caseId = id(req.params.caseId);
  if (!caseId || !validRemedyRequestKey(req.body?.requestKey) || typeof req.body?.startsAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(req.body.startsAt) ||
      req.body.confirmTeacherNonDelivery !== undefined && typeof req.body.confirmTeacherNonDelivery !== "boolean") {
    res.status(400).json({ error: "Choose a complete date and time with its time zone before sending this offer." }); return;
  }
  try { await sendResult(req, res, await offerLessonMakeup(actor(req), caseId, req.body)); }
  catch (error) { errorResponse(error, res, next); }
});
router.post("/lesson-remedies/:caseId/accept", requireAuth, async (req, res, next) => {
  const caseId = id(req.params.caseId); const offerId = id(req.body?.offerId);
  if (!caseId || !offerId || !validRemedyRequestKey(req.body?.requestKey)) { res.status(400).json({ error: "Refresh this offer before accepting." }); return; }
  try { await sendResult(req, res, await acceptLessonMakeup(actor(req), caseId, { offerId, requestKey: req.body.requestKey })); }
  catch (error) { errorResponse(error, res, next); }
});
router.post(["/lesson-remedies/:caseId/withdraw", "/lesson-remedies/:caseId/decline", "/lesson-remedies/:caseId/decision"], requireAuth, async (req, res, next) => {
  const caseId = id(req.params.caseId);
  const action = req.path.endsWith("/decision") ? "reject" : req.path.endsWith("/decline") ? "decline" : "withdraw";
  if (!caseId || !validRemedyRequestKey(req.body?.requestKey) || action === "reject" && req.body?.decision !== "reject") {
    res.status(400).json({ error: "Choose a valid action for this make-up request." }); return;
  }
  try { await sendResult(req, res, await actOnLessonMakeup(actor(req), caseId, { action, note: req.body?.note ?? req.body?.reason, requestKey: req.body.requestKey })); }
  catch (error) { errorResponse(error, res, next); }
});
router.post("/admin/lesson-remedies/:caseId/resolve", requireAuth, requireAdmin, async (req, res, next) => {
  const caseId = id(req.params.caseId);
  if (!caseId || !validRemedyRequestKey(req.body?.requestKey) || !["replacement_delivered", "student_missed_replacement", "teacher_missed_replacement", "refund_review", "refund_approved", "refund_denied", "no_adjustment"].includes(req.body?.outcome)) {
    res.status(400).json({ error: "Choose a valid evidence-review outcome." }); return;
  }
  try { await sendResult(req, res, await resolveLessonMakeup(actor(req), caseId, { ...req.body, confirmed: req.body.confirmed === true })); }
  catch (error) { errorResponse(error, res, next); }
});
export default router;
