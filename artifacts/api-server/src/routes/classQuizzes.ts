import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { classQuizzesTable as quizzes, classQuizAttemptsTable as attempts, batchTestBookingsTable, db, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { classGroupAccess } from "../lib/classGroupAccess";
import { ensureQuizSchema } from "../lib/classQuizSchema";
import { gradeQuiz, studentQuestions, validateQuiz } from "../lib/classQuizRules";
import { notifyMany } from "../lib/notify";
import { logger } from "../lib/logger";

const router = Router();
const base = "/class-groups/:id/quizzes";
type Quiz = typeof quizzes.$inferSelect;
const positive = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

async function access(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const id = positive(req.params.id);
  if (!id) { res.status(400).json({ error: "This class link is not valid." }); return null; }
  const [user] = await db.select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, req.user!.userId));
  const group = user && !user.suspendedAt && ["student", "teacher"].includes(user.role) ? await classGroupAccess(id, req.user!.userId) : null;
  if (!group) { res.status(403).json({ error: "You do not have access to this class." }); return null; }
  try { await ensureQuizSchema(); } catch { res.status(503).json({ error: "Quizzes are temporarily unavailable. Your class and homework are unaffected. Please try again." }); return null; }
  return group;
}
function summary(q: Quiz) {
  return { id: q.id, title: q.title, status: q.status, revision: q.revision, dueAt: q.dueAt, questionCount: q.questions.length, possible: q.questions.reduce((n, item) => n + item.points, 0) };
}
function bad(res: Response, error: unknown) { res.status(400).json({ error: error instanceof Error ? error.message : "Check the quiz details." }); }

router.get(base, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  const before = positive(req.query.before);
  const rows = await db.select().from(quizzes).where(and(eq(quizzes.batchId, group.batchId), group.isTeacher ? undefined : ne(quizzes.status, "draft"), before ? lt(quizzes.id, before) : undefined)).orderBy(desc(quizzes.id)).limit(21);
  res.json({ title: group.title, isTeacher: group.isTeacher, items: rows.slice(0, 20).map(summary), nextCursor: rows.length > 20 ? rows[19].id : null });
});

router.post(base, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (!group.isTeacher) { res.status(403).json({ error: "Only this class's teacher can prepare a quiz." }); return; }
  const requestKey = req.body?.requestKey;
  if (typeof requestKey !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey)) { bad(res, new Error("Reload the quiz editor before saving.")); return; }
  let draft; try { draft = validateQuiz(req.body); } catch (e) { bad(res, e); return; }
  const saved = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(82201, ${group.batchId})`);
    const [previous] = await tx.select().from(quizzes).where(and(eq(quizzes.batchId, group.batchId), eq(quizzes.requestKey, requestKey)));
    if (previous) return previous;
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(quizzes).where(and(eq(quizzes.batchId, group.batchId), eq(quizzes.status, "draft")));
    if (count.n >= 30) return null;
    const [row] = await tx.insert(quizzes).values({ ...draft, requestKey, batchId: group.batchId, teacherId: req.user!.userId }).returning();
    return row;
  });
  if (!saved) { res.status(409).json({ error: "This class already has 30 drafts. Finish or remove an existing draft first." }); return; }
  res.status(201).json({ quiz: saved });
});

router.get(`${base}/:quizId`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  const id = positive(req.params.quizId);
  const [quiz] = id ? await db.select().from(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId))) : [];
  if (!quiz || (!group.isTeacher && quiz.status === "draft")) { res.status(404).json({ error: "This quiz is not available." }); return; }
  const [attempt] = group.isTeacher ? [] : await db.select().from(attempts).where(and(eq(attempts.quizId, quiz.id), eq(attempts.studentId, req.user!.userId)));
  const closed = quiz.status === "closed" || Boolean(quiz.dueAt && quiz.dueAt.getTime() <= Date.now());
  res.json({ isTeacher: group.isTeacher, classTitle: group.title, quiz: { ...summary(quiz), questions: group.isTeacher ? quiz.questions : studentQuestions(quiz.questions, closed), closed }, attempt: attempt ?? null });
});

router.put(`${base}/:quizId`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (!group.isTeacher) { res.status(403).json({ error: "Only this class's teacher can edit a quiz." }); return; }
  const id = positive(req.params.quizId), revision = req.body?.revision;
  if (!id || !Number.isSafeInteger(revision) || revision < 1) { bad(res, new Error("Reload the draft before saving.")); return; }
  let draft; try { draft = validateQuiz(req.body); } catch (e) { bad(res, e); return; }
  const [saved] = await db.update(quizzes).set({ ...draft, revision: revision + 1 }).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId), eq(quizzes.status, "draft"), eq(quizzes.revision, revision))).returning();
  if (!saved) { res.status(409).json({ error: "This draft changed or was already published. Reload it before continuing." }); return; }
  res.json({ quiz: saved });
});

router.post(`${base}/:quizId/publish`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (!group.isTeacher) { res.status(403).json({ error: "Only this class's teacher can publish a quiz." }); return; }
  const id = positive(req.params.quizId);
  if (!id || !Number.isSafeInteger(req.body?.revision)) { bad(res, new Error("Reload this quiz before publishing.")); return; }
  const result = await db.transaction(async tx => {
    const [quiz] = await tx.select().from(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId))).for("update");
    if (!quiz || quiz.status !== "draft" || quiz.revision !== req.body.revision) return { status: 409, error: "This draft changed or was already published. Reload it before continuing." };
    if (quiz.questions.some(q => !q.confirmed || !q.answer.trim())) return { status: 400, error: "Review and confirm every question, correct answer and point value before publishing." };
    if (quiz.dueAt && quiz.dueAt.getTime() <= Date.now()) return { status: 400, error: "Choose a future deadline before publishing." };
    const [saved] = await tx.update(quizzes).set({ status: "published", publishedAt: new Date() }).where(eq(quizzes.id, id)).returning();
    return { quiz: saved };
  });
  if ("error" in result) { res.status(result.status!).json({ error: result.error }); return; }
  // A failed notification lookup must never turn a committed publication into a failed action.
  try {
    const students = await db.select({ id: batchTestBookingsTable.studentId }).from(batchTestBookingsTable).where(eq(batchTestBookingsTable.batchId, group.batchId));
    notifyMany(students.map(s => s.id), { kind: "class_quiz_published", at: new Date().toISOString(), batchId: group.batchId, quizId: id, topic: group.title, homeworkTitle: result.quiz!.title });
  } catch (error) { logger.warn({ err: error }, "Quiz published; notification lookup failed"); }
  res.json(result);
});

router.post(`${base}/:quizId/close`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (!group.isTeacher) { res.status(403).json({ error: "Only this class's teacher can close a quiz." }); return; }
  const id = positive(req.params.quizId);
  const [closed] = id ? await db.update(quizzes).set({ status: "closed" }).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId), eq(quizzes.status, "published"))).returning() : [];
  if (!closed) { res.status(409).json({ error: "This quiz is not open. Reload for its current status." }); return; }
  res.json({ quiz: summary(closed) });
});

router.delete(`${base}/:quizId`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (!group.isTeacher) { res.status(403).json({ error: "Only this class's teacher can remove a draft." }); return; }
  const id = positive(req.params.quizId);
  const [removed] = id ? await db.delete(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId), eq(quizzes.status, "draft"))).returning({ id: quizzes.id }) : [];
  if (!removed) { res.status(409).json({ error: "Only an unpublished draft can be removed. Published work stays in the class record." }); return; }
  res.json({ id: removed.id });
});

router.post(`${base}/:quizId/submit`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (group.isTeacher) { res.status(403).json({ error: "Only enrolled students can submit this quiz." }); return; }
  const id = positive(req.params.quizId);
  if (!id) { bad(res, new Error("This quiz link is not valid.")); return; }
  const result = await db.transaction(async tx => {
    // Serializes submit vs close and simultaneous retries. Never trust a client score or clock.
    const [quiz] = await tx.select().from(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId))).for("update");
    if (!quiz || quiz.status === "draft") return { status: 404, error: "This quiz is not available." };
    const [previous] = await tx.select().from(attempts).where(and(eq(attempts.quizId, id), eq(attempts.studentId, req.user!.userId)));
    if (previous) return { attempt: previous };
    if (quiz.status !== "published" || (quiz.dueAt && quiz.dueAt.getTime() <= Date.now())) return { status: 409, error: "This quiz has closed. Your teacher can help you with another practice quiz." };
    let graded; try { graded = gradeQuiz(quiz.questions, req.body?.answers); } catch (e) { return { status: 400, error: e instanceof Error ? e.message : "Check your answers." }; }
    const [attempt] = await tx.insert(attempts).values({ ...graded, quizId: id, studentId: req.user!.userId, revision: quiz.revision }).returning();
    return { attempt };
  });
  if ("error" in result) { res.status(result.status!).json({ error: result.error }); return; }
  res.json(result);
});

router.get(`${base}/:quizId/results`, requireAuth, async (req, res) => {
  const group = await access(req, res); if (!group) return;
  if (!group.isTeacher) { res.status(403).json({ error: "Only this class's teacher can view other students' results." }); return; }
  const id = positive(req.params.quizId);
  const [quiz] = id ? await db.select({ id: quizzes.id }).from(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.batchId, group.batchId))) : [];
  if (!quiz) { res.status(404).json({ error: "This quiz is not available." }); return; }
  const before = positive(req.query.before);
  const rows = await db.select({ id: attempts.id, studentName: usersTable.name, score: attempts.score, possible: attempts.possible, answers: attempts.answers, submittedAt: attempts.submittedAt }).from(attempts).innerJoin(usersTable, eq(usersTable.id, attempts.studentId)).where(and(eq(attempts.quizId, quiz.id), before ? lt(attempts.id, before) : undefined)).orderBy(desc(attempts.id)).limit(21);
  res.json({ items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null });
});
export default router;
