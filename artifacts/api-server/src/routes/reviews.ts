import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, reviewsTable, sessionEnrollmentsTable, sessionsTable, teacherProfilesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const RATING_WINDOW_DAYS = 7;

/**
 * How long a written review may be.
 *
 * Long enough for somebody to say what actually happened in a lesson, short enough that the
 * teacher's page stays readable and a single review cannot fill a phone screen.
 */
const MAX_COMMENT_CHARS = 1000;

/**
 * Finds a session that entitles this student to review this teacher: one they enrolled in,
 * that has finished, that finished within the last RATING_WINDOW_DAYS, and that they have
 * not already reviewed.
 *
 * The unreviewed condition is what makes each review cost a session attended. Without it a
 * student could post unlimited reviews for the same teacher, each one recomputing the
 * teacher's average — a rating-manipulation vector, since ratings drive discovery.
 *
 * The window is measured from when the session ENDED (start + duration), not when it was
 * scheduled to start, so a long class does not eat into the reviewing period.
 */
async function findRatableSession(studentId: number, teacherId: number) {
  const cutoff = new Date(Date.now() - RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [eligible] = await db
    .select({ sessionId: sessionsTable.id, date: sessionsTable.date })
    .from(sessionEnrollmentsTable)
    .innerJoin(sessionsTable, eq(sessionEnrollmentsTable.sessionId, sessionsTable.id))
    .leftJoin(
      reviewsTable,
      and(
        eq(reviewsTable.sessionId, sessionsTable.id),
        eq(reviewsTable.studentId, studentId),
      ),
    )
    .where(and(
      eq(sessionEnrollmentsTable.studentId, studentId),
      eq(sessionsTable.teacherId, teacherId),
      eq(sessionsTable.status, "completed"),
      isNull(reviewsTable.id),
      gte(
        sql`${sessionsTable.date} + (${sessionsTable.duration} * interval '1 minute')`,
        cutoff,
      ),
    ))
    .orderBy(desc(sessionsTable.date))
    .limit(1);

  return eligible ?? null;
}

// A student may only rate a teacher they actually attended a completed session with,
// and only within 15 days of that session — this must be checked server-side since
// the search/profile pages are otherwise open to any logged-in student.
router.get("/reviews/can-rate", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const teacherId = parseInt(String(req.query.teacherId ?? ""), 10);
  if (isNaN(teacherId)) { res.status(400).json({ error: "teacherId is required" }); return; }

  const session = await findRatableSession(user.userId, teacherId);
  res.json({ canRate: !!session, sessionId: session?.sessionId ?? null });
});

router.post("/reviews", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { teacherId, rating, comment } = req.body as {
    teacherId?: number; rating?: number; comment?: string;
  };

  if (!teacherId || rating === undefined) {
    res.status(400).json({ error: "teacherId and rating are required" });
    return;
  }
  if (rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be between 1 and 5" });
    return;
  }

  /**
   * The student's own words, or nothing at all.
   *
   * A comment used to be mandatory, and the app met that by inventing one — every review in
   * the database says "Great teacher! Rated 4 stars." in the student's name, whatever they
   * actually thought. That is worse than having no comments: it is a fabricated opinion
   * attributed to a real person, and it made the review list useless to read.
   *
   * So it is optional, and whatever arrives is the student's. Capped because this is displayed
   * on a public page and there is no reason for an essay.
   */
  const text = typeof comment === "string" ? comment.trim() : "";
  if (text.length > MAX_COMMENT_CHARS) {
    res.status(400).json({ error: `Please keep your review under ${MAX_COMMENT_CHARS} characters.` });
    return;
  }

  const ratableSession = await findRatableSession(user.userId, teacherId);
  if (!ratableSession) {
    res.status(403).json({
      error: `You can only review a teacher after attending a session with them, within ${RATING_WINDOW_DAYS} days of that session ending, and only once per session.`,
    });
    return;
  }

  const [studentUser] = await db.select({ name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, user.userId));

  let review;
  try {
    [review] = await db.insert(reviewsTable).values({
      teacherId,
      studentId: user.userId,
      sessionId: ratableSession.sessionId,
      studentName: studentUser?.name ?? "Anonymous",
      rating,
      comment: text,
    }).returning();
  } catch (err) {
    // Unique violation: a concurrent request already reviewed this session. The check above
    // cannot prevent that on its own, so the constraint is what actually holds the line.
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "You have already reviewed this session." });
      return;
    }
    throw err;
  }

  const [{ avgRating, count }] = await db
    .select({
      avgRating: sql<number>`avg(rating)::numeric(3,2)`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviewsTable)
    .where(eq(reviewsTable.teacherId, teacherId));

  await db.update(teacherProfilesTable)
    .set({
      rating: Number(avgRating) || 0,
      reviewCount: count,
    })
    .where(eq(teacherProfilesTable.userId, teacherId));

  res.status(201).json(review);
});

export default router;
