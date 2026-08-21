import { and, asc, desc, eq, gte, lte, or, sql, type AnyColumn } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, studentTeacherSubscriptionsTable, teacherProfilesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { notify } from "../lib/notify";

const router: IRouter = Router();

export const SUBSCRIPTION_TIERS = {
  base: { sessions: 10, price: 2000 },
  tier1: { sessions: 15, price: 2800 },
  tier2: { sessions: 20, price: 3500 },
  tier3: { sessions: 25, price: 4220 },
  tier4: { sessions: 30, price: 4700 },
} as const;

export type SubscriptionTierKey = keyof typeof SUBSCRIPTION_TIERS;

router.get("/teachers", async (req, res): Promise<void> => {
  const { search, subject, district, minRating, maxPrice, onlineOnly, sort, page = "1", limit = "20" } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(teacherProfilesTable.approvalStatus, "approved")];

  if (subject && subject !== "All") {
    conditions.push(eq(teacherProfilesTable.subject, subject));
  }
  if (district && district !== "All Districts") {
    conditions.push(eq(teacherProfilesTable.district, district));
  }
  if (minRating) {
    conditions.push(gte(teacherProfilesTable.rating, parseFloat(minRating)));
  }
  if (maxPrice) {
    conditions.push(lte(teacherProfilesTable.pricePerSession, parseInt(maxPrice, 10)));
  }
  if (onlineOnly === "true") {
    conditions.push(eq(teacherProfilesTable.isOnline, true));
  }
  if (search && search.trim()) {
    /**
     * Spacing carries no meaning in a search box.
     *
     * Reported with examples: looking for "Ram Prasad" as `RamPrasad`, `ram p rasa d` or
     * `r ampr asad` found nobody, because this was a plain `%...%` match. Both sides are
     * stripped to letters and digits before comparing, which makes all of those work. The
     * app applies the same rule in utils/search.ts — they have to agree, or a search that
     * finds someone on one screen misses them on the next.
     */
    const squashed = search.trim().toLowerCase().replace(/[^a-z0-9]/gi, "");
    if (squashed.length > 0) {
      const pattern = `%${squashed}%`;
      const bare = (column: AnyColumn) =>
        sql`regexp_replace(lower(${column}), '[^a-z0-9]', '', 'g') LIKE ${pattern}`;
      conditions.push(
        or(
          bare(usersTable.name),
          bare(teacherProfilesTable.subject),
          bare(teacherProfilesTable.bio),
          bare(teacherProfilesTable.location),
          bare(teacherProfilesTable.district),
        )!,
      );
    }
  }

  const orderByCol = (() => {
    switch (sort) {
      case "students": return desc(teacherProfilesTable.totalStudents);
      case "price_asc": return asc(teacherProfilesTable.pricePerSession);
      case "price_desc": return desc(teacherProfilesTable.pricePerSession);
      case "experience": return desc(teacherProfilesTable.experienceYears);
      default: return desc(teacherProfilesTable.rating);
    }
  })();

  const where = and(...conditions);

  const [teachers, [{ total }]] = await Promise.all([
    db
      .select({
        id: teacherProfilesTable.id,
        userId: teacherProfilesTable.userId,
        name: usersTable.name,
        email: usersTable.email,
        subject: teacherProfilesTable.subject,
        subjects: teacherProfilesTable.subjects,
        bio: teacherProfilesTable.bio,
        approvalStatus: teacherProfilesTable.approvalStatus,
        location: teacherProfilesTable.location,
        district: teacherProfilesTable.district,
        experienceYears: teacherProfilesTable.experienceYears,
        pricePerSession: teacherProfilesTable.pricePerSession,
        languages: teacherProfilesTable.languages,
        isOnline: teacherProfilesTable.isOnline,
        subscriptionActive: teacherProfilesTable.subscriptionActive,
        subscriptionTier: teacherProfilesTable.subscriptionTier,
        maxSessionsPerMonth: teacherProfilesTable.maxSessionsPerMonth,
        sessionsThisMonth: teacherProfilesTable.sessionsThisMonth,
        totalStudents: teacherProfilesTable.totalStudents,
        monthlyEarnings: teacherProfilesTable.monthlyEarnings,
        rating: teacherProfilesTable.rating,
        reviewCount: teacherProfilesTable.reviewCount,
        avatarUrl: teacherProfilesTable.avatarUrl,
      })
      .from(teacherProfilesTable)
      .innerJoin(usersTable, eq(teacherProfilesTable.userId, usersTable.id))
      .where(where)
      .orderBy(orderByCol)
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(teacherProfilesTable)
      .innerJoin(usersTable, eq(teacherProfilesTable.userId, usersTable.id))
      .where(where),
  ]);

  res.json({ teachers, total, page: pageNum, limit: limitNum });
});

router.get("/teachers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const [row] = await db
    .select({
      id: teacherProfilesTable.id,
      userId: teacherProfilesTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      subject: teacherProfilesTable.subject,
      subjects: teacherProfilesTable.subjects,
      bio: teacherProfilesTable.bio,
      approvalStatus: teacherProfilesTable.approvalStatus,
      location: teacherProfilesTable.location,
      district: teacherProfilesTable.district,
      experienceYears: teacherProfilesTable.experienceYears,
      pricePerSession: teacherProfilesTable.pricePerSession,
      languages: teacherProfilesTable.languages,
      isOnline: teacherProfilesTable.isOnline,
      subscriptionActive: teacherProfilesTable.subscriptionActive,
      subscriptionTier: teacherProfilesTable.subscriptionTier,
      maxSessionsPerMonth: teacherProfilesTable.maxSessionsPerMonth,
      sessionsThisMonth: teacherProfilesTable.sessionsThisMonth,
      totalStudents: teacherProfilesTable.totalStudents,
      monthlyEarnings: teacherProfilesTable.monthlyEarnings,
      rating: teacherProfilesTable.rating,
      reviewCount: teacherProfilesTable.reviewCount,
      avatarUrl: teacherProfilesTable.avatarUrl,
    })
    .from(teacherProfilesTable)
    .innerJoin(usersTable, eq(teacherProfilesTable.userId, usersTable.id))
    .where(eq(teacherProfilesTable.id, id));

  if (!row) { res.status(404).json({ error: "Teacher not found" }); return; }

  let isFollowing = false;
  const studentIdRaw = req.query.studentId as string | undefined;
  if (studentIdRaw) {
    const studentId = parseInt(studentIdRaw, 10);
    if (!isNaN(studentId)) {
      const [follow] = await db.select({ id: studentTeacherSubscriptionsTable.id })
        .from(studentTeacherSubscriptionsTable)
        .where(and(
          eq(studentTeacherSubscriptionsTable.studentId, studentId),
          eq(studentTeacherSubscriptionsTable.teacherId, row.userId),
        ));
      isFollowing = !!follow;
    }
  }

  res.json({ ...row, isFollowing });
});

router.patch("/teachers/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  /**
   * A profile may only be edited by the teacher it belongs to.
   *
   * This route required a login and nothing else, so any account could rewrite any teacher's
   * bio, subjects, price per session and online flag by sending their profile id — undercut a
   * rival's price, or mark them offline in the middle of their working day.
   */
  const [owner] = await db
    .select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.id, id));
  if (!owner) { res.status(404).json({ error: "Teacher not found" }); return; }
  if (owner.userId !== req.user!.userId) {
    res.status(403).json({ error: "You can only edit your own profile" });
    return;
  }

  const allowedFields = ["bio", "subject", "subjects", "location", "district", "experienceYears", "pricePerSession", "languages", "isOnline"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [profile] = await db
    .update(teacherProfilesTable)
    .set(updates)
    .where(eq(teacherProfilesTable.id, id))
    .returning();

  if (!profile) { res.status(404).json({ error: "Teacher not found" }); return; }

  const [user] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, profile.userId));

  res.json({ ...profile, name: user?.name ?? "", email: user?.email ?? "" });
});

// Phase 3 sandbox bypass: local mock eSewa/Khalti payment flow has no real gateway to
// confirm against, so this endpoint marks the subscription active as soon as the client
// simulates a successful charge. No external payment API is called.
router.post("/teachers/:id/subscribe", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const { tier } = req.body as { tier?: string };
  const tierKey: SubscriptionTierKey = tier && tier in SUBSCRIPTION_TIERS ? (tier as SubscriptionTierKey) : "base";
  const tierInfo = SUBSCRIPTION_TIERS[tierKey];

  const [existing] = await db.select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable).where(eq(teacherProfilesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Teacher not found" }); return; }
  if (!req.user || req.user.userId !== existing.userId) {
    res.status(403).json({ error: "Not authorized to update this teacher's subscription" });
    return;
  }

  const [profile] = await db
    .update(teacherProfilesTable)
    .set({
      subscriptionActive: true,
      approvalStatus: "approved",
      subscriptionTier: tierKey,
      maxSessionsPerMonth: tierInfo.sessions,
    })
    .where(eq(teacherProfilesTable.id, id))
    .returning();

  const [user] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, profile.userId));

  res.json({ ...profile, name: user?.name ?? "", email: user?.email ?? "" });
});

router.get("/subscription-tiers", (_req, res): void => {
  res.json({ tiers: SUBSCRIPTION_TIERS });
});

// Free "Subscribe" (follow): adds a teacher to a student's dashboard with no charge.
// Payment only happens at session enrollment. Distinct from the teacher's own paid
// Sikshya Pro subscription above.
router.post("/teachers/:id/follow", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const user = req.user!;
  if (user.role !== "student") {
    res.status(403).json({ error: "Only students can follow teachers" });
    return;
  }

  const [teacher] = await db.select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable).where(eq(teacherProfilesTable.id, id));
  if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }

  await db.insert(studentTeacherSubscriptionsTable)
    .values({ studentId: user.userId, teacherId: teacher.userId })
    .onConflictDoNothing();

  /**
   * Tell the teacher they have a new follower.
   *
   * This is the case the owner reported: a student followed a teacher and the teacher was
   * never told, because following only ever wrote a row. Nothing read it on their behalf.
   */
  const [follower] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, user.userId));

  notify(teacher.userId, {
    kind: "follower",
    fromUserId: user.userId,
    fromName: follower?.name ?? "A student",
    at: new Date().toISOString(),
  });

  res.status(201).json({ following: true });
});

router.delete("/teachers/:id/follow", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const user = req.user!;
  const [teacher] = await db.select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable).where(eq(teacherProfilesTable.id, id));
  if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }

  await db.delete(studentTeacherSubscriptionsTable)
    .where(and(
      eq(studentTeacherSubscriptionsTable.studentId, user.userId),
      eq(studentTeacherSubscriptionsTable.teacherId, teacher.userId),
    ));

  res.json({ following: false });
});

/**
 * The students who follow this teacher.
 *
 * Following is free and one-directional — a student bookmarking a teacher — so the teacher had
 * no way of knowing it had happened. Restricted to the teacher themselves: it is a list of
 * real people's names, and nobody else has any business reading it.
 */
router.get("/teachers/:id/followers", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const profileId = parseInt(raw, 10);
  if (isNaN(profileId)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const [profile] = await db
    .select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.id, profileId));
  if (!profile) { res.status(404).json({ error: "Teacher not found" }); return; }
  if (profile.userId !== req.user!.userId) {
    res.status(403).json({ error: "You can only see your own followers" });
    return;
  }

  const followers = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      since: studentTeacherSubscriptionsTable.createdAt,
    })
    .from(studentTeacherSubscriptionsTable)
    .innerJoin(usersTable, eq(studentTeacherSubscriptionsTable.studentId, usersTable.id))
    .where(eq(studentTeacherSubscriptionsTable.teacherId, profile.userId))
    .orderBy(desc(studentTeacherSubscriptionsTable.createdAt));

  res.json({ followers });
});

router.get("/students/:id/followed-teachers", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const studentId = parseInt(raw, 10);
  if (isNaN(studentId)) { res.status(400).json({ error: "Invalid student ID" }); return; }
  if (studentId !== req.user!.userId) {
    res.status(403).json({ error: "You can only see your own followed teachers" });
    return;
  }

  const teachers = await db
    .select({
      id: teacherProfilesTable.id,
      userId: teacherProfilesTable.userId,
      name: usersTable.name,
      subject: teacherProfilesTable.subject,
      subjects: teacherProfilesTable.subjects,
      pricePerSession: teacherProfilesTable.pricePerSession,
      rating: teacherProfilesTable.rating,
      reviewCount: teacherProfilesTable.reviewCount,
      avatarUrl: teacherProfilesTable.avatarUrl,
      isOnline: teacherProfilesTable.isOnline,
    })
    .from(studentTeacherSubscriptionsTable)
    .innerJoin(teacherProfilesTable, eq(studentTeacherSubscriptionsTable.teacherId, teacherProfilesTable.userId))
    .innerJoin(usersTable, eq(teacherProfilesTable.userId, usersTable.id))
    .where(eq(studentTeacherSubscriptionsTable.studentId, studentId));

  res.json({ teachers });
});

router.get("/teachers/:id/reviews", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const pageNum = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limitNum = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10)));
  const offset = (pageNum - 1) * limitNum;

  const [profile] = await db
    .select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.id, id));

  if (!profile) { res.status(404).json({ error: "Teacher not found" }); return; }

  const { reviewsTable } = await import("@workspace/db");
  const [reviews, [{ total }]] = await Promise.all([
    db.select().from(reviewsTable)
      .where(eq(reviewsTable.teacherId, profile.userId))
      .orderBy(desc(reviewsTable.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` })
      .from(reviewsTable)
      .where(eq(reviewsTable.teacherId, profile.userId)),
  ]);

  res.json({ reviews, total, page: pageNum, limit: limitNum });
});

export default router;
