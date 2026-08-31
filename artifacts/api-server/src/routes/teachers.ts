import { and, asc, desc, eq, gte, lte, or, sql, type AnyColumn } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, studentTeacherSubscriptionsTable, teacherCredentialsTable, teacherProfilesTable, usersTable } from "@workspace/db";
import { attachUserIfPresent, requireAuth } from "../middlewares/requireAuth";
import { notify } from "../lib/notify";
import { chargeForMonthly } from "../lib/payments";
import { mayBuyTeacherPlan } from "../lib/teachingAccess";
import { allowanceSummary } from "../lib/sessionAllowance";
import { SUBSCRIPTION_TIERS, isTierKey, type SubscriptionTierKey } from "../lib/tierLimits";
import { deleteUpload, verifyUpload } from "../lib/fileStore";
import { flagContent } from "../lib/moderation";

const router: IRouter = Router();

/**
 * The tiers themselves live in `lib/tierLimits.ts`, next to the rule that enforces them.
 *
 * They were defined here, in a route file, which meant the prices and the allowance sat in one
 * place and nothing that could read them sat anywhere. Re-exported so existing callers are
 * unaffected.
 */
export { SUBSCRIPTION_TIERS, type SubscriptionTierKey } from "../lib/tierLimits";

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

router.get("/teachers/:id", attachUserIfPresent, async (req, res): Promise<void> => {
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

  /**
   * Whether *this* caller follows this teacher, answered from who they are signed in as.
   *
   * It used to come from a `?studentId=` query parameter, and that was wrong twice over.
   *
   * It never worked: the app sent the student's **profile** row id while this table keys on
   * their **users** row id, so the two matched only by coincidence. The Subscribe button was
   * therefore never green on load — it went green on the tap, from local state, and reverted
   * the moment the screen was rebuilt. Reported exactly that way.
   *
   * And it should never have been a parameter. Anyone could ask whether any student followed
   * any teacher by putting a number in a URL. Identity comes from the token now, so there is
   * nothing to get wrong and nothing to probe.
   */
  let isFollowing = false;
  const viewer = req.user;
  if (viewer && viewer.role === "student") {
    const [follow] = await db.select({ id: studentTeacherSubscriptionsTable.id })
      .from(studentTeacherSubscriptionsTable)
      .where(and(
        eq(studentTeacherSubscriptionsTable.studentId, viewer.userId),
        eq(studentTeacherSubscriptionsTable.teacherId, row.userId),
      ));
    isFollowing = !!follow;
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

  if (typeof updates.bio === "string") {
    await flagContent({ userId: profile.userId, surface: "teacher_bio", subjectId: profile.id, text: updates.bio });
  }

  const [user] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, profile.userId));

  res.json({ ...profile, name: user?.name ?? "", email: user?.email ?? "" });
});

/**
 * Buy or change a teacher's session tier.
 *
 * ### This no longer approves the teacher
 *
 * It used to set `approvalStatus: "approved"` alongside the tier, and that was a hole rather
 * than a shortcut. Registration writes `pending`, `admin.ts` holds a real review queue whose
 * rejection route refuses to proceed without a written reason, and `GET /teachers` lists only
 * approved teachers — so approval is the gate into Discover. Setting it here opened that gate
 * from the inside, and since payment is simulated, any registered teacher could put themselves
 * in front of students for nothing with no agent ever seeing their credentials.
 *
 * Approval now has exactly one door: an agent's decision. A teacher may buy a tier while still
 * pending — there is no reason to make them wait to pay — they simply are not listed until
 * somebody has looked at them.
 *
 * ### And it can no longer take money by accident
 *
 * The charge goes through `chargeForMonthly`, which is the same gate every other payment in the
 * product passes: it approves in simulated mode and logs loudly that no money moved, and it
 * refuses in gateway mode because the eSewa/Khalti branch is not written yet. That refusal is
 * the correct behaviour and the whole point — the alternative is a route that starts charging
 * real customers the moment a provider is configured, through code nobody has tested against a
 * real gateway. See `.agents/memory/payment-mode-trap.md`.
 */
router.post("/teachers/:id/subscribe", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid teacher ID" }); return; }

  const { tier } = req.body as { tier?: string };
  const tierKey: SubscriptionTierKey = isTierKey(tier) ? tier : "base";
  const tierInfo = SUBSCRIPTION_TIERS[tierKey];

  const [existing] = await db.select({ userId: teacherProfilesTable.userId })
    .from(teacherProfilesTable).where(eq(teacherProfilesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Teacher not found" }); return; }
  if (!req.user || req.user.userId !== existing.userId) {
    res.status(403).json({ error: "Not authorized to update this teacher's subscription" });
    return;
  }

  const access = await mayBuyTeacherPlan(existing.userId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.message, code: access.code });
    return;
  }

  const charge = await chargeForMonthly({
    purpose: "teacher-plan",
    referenceId: id,
    userId: existing.userId,
    amount: tierInfo.price,
    method: "tier-subscription",
    log: req.log,
  });
  if (!charge.ok) {
    res.status(402).json({ error: charge.message ?? "Payment could not be taken.", redirectUrl: charge.redirectUrl });
    return;
  }

  const [profile] = await db
    .update(teacherProfilesTable)
    .set({
      subscriptionActive: true,
      subscriptionTier: tierKey,
      maxSessionsPerMonth: tierInfo.sessions,
    })
    .where(eq(teacherProfilesTable.id, id))
    .returning();

  const [user] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, profile.userId));

  res.json({ ...profile, name: user?.name ?? "", email: user?.email ?? "" });
});

/**
 * What the signed-in teacher has left of their allowance.
 *
 * One place for the dashboard to ask, rather than each screen working it out from a tier name
 * and a hard-coded ten. `sessions_this_month` on `teacher_profiles` is not the answer and never
 * was — it has been zero for every teacher since the column was added.
 */
router.get("/teachers/me/allowance", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers have a session allowance" });
    return;
  }
  res.json(await allowanceSummary(user.userId));
});

router.get("/subscription-tiers", (_req, res): void => {
  res.json({ tiers: SUBSCRIPTION_TIERS });
});

const CREDENTIAL_TYPES = ["citizenship", "teaching_license", "university_degree", "professional_certificate"] as const;

function credentialType(value: unknown): (typeof CREDENTIAL_TYPES)[number] | null {
  return typeof value === "string" && CREDENTIAL_TYPES.includes(value as (typeof CREDENTIAL_TYPES)[number])
    ? value as (typeof CREDENTIAL_TYPES)[number]
    : null;
}

router.get("/teachers/me/credentials", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "teacher") { res.status(403).json({ error: "Only teachers have credentials." }); return; }
  const rows = await db
    .select()
    .from(teacherCredentialsTable)
    .where(eq(teacherCredentialsTable.teacherId, req.user!.userId))
    .orderBy(asc(teacherCredentialsTable.documentType), desc(teacherCredentialsTable.id));
  res.json({ credentials: rows.filter((row) => row.status !== "withdrawn") });
});

router.post("/teachers/me/credentials", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "teacher") { res.status(403).json({ error: "Only teachers can submit credentials." }); return; }
  const documentType = credentialType(req.body?.documentType);
  const fileKey = typeof req.body?.fileKey === "string" ? req.body.fileKey.trim() : "";
  const originalName = typeof req.body?.originalName === "string" ? req.body.originalName.trim().slice(0, 180) : "";
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.trim() : "";
  if (!documentType || !fileKey || !originalName || !contentType) {
    res.status(400).json({ error: "Choose a document type and a completed photo or PDF upload." });
    return;
  }
  const verdict = await verifyUpload(fileKey, user.userId);
  if (!verdict.ok) { res.status(400).json({ error: verdict.reason }); return; }

  const existing = await db
    .select({ id: teacherCredentialsTable.id, status: teacherCredentialsTable.status })
    .from(teacherCredentialsTable)
    .where(and(eq(teacherCredentialsTable.teacherId, user.userId), eq(teacherCredentialsTable.documentType, documentType)))
    .orderBy(desc(teacherCredentialsTable.id));
  if (existing.some((row) => ["submitted", "opened", "approved"].includes(row.status))) {
    await deleteUpload(fileKey);
    res.status(409).json({ error: "That document type is already submitted. It can be replaced only before review, or after an operator rejects it." });
    return;
  }

  const [credential] = await db.transaction(async (tx) => {
    await tx
      .update(teacherCredentialsTable)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(and(eq(teacherCredentialsTable.teacherId, user.userId), eq(teacherCredentialsTable.documentType, documentType), eq(teacherCredentialsTable.status, "rejected")));
    const inserted = await tx.insert(teacherCredentialsTable).values({
      teacherId: user.userId,
      documentType,
      fileKey,
      originalName,
      contentType: verdict.contentType,
      status: "submitted",
    }).returning();
    await tx.update(teacherProfilesTable).set({ approvalStatus: "pending" }).where(eq(teacherProfilesTable.userId, user.userId));
    return inserted;
  });
  res.status(201).json({ credential });
});

router.delete("/teachers/me/credentials/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid document id." }); return; }
  const [row] = await db
    .select()
    .from(teacherCredentialsTable)
    .where(and(eq(teacherCredentialsTable.id, id), eq(teacherCredentialsTable.teacherId, req.user!.userId)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Document not found." }); return; }
  if (row.status !== "submitted") {
    res.status(409).json({ error: "An operator has opened this document, so it can no longer be deleted." });
    return;
  }
  const [withdrawn] = await db
    .update(teacherCredentialsTable)
    .set({ status: "withdrawn", updatedAt: new Date() })
    .where(and(eq(teacherCredentialsTable.id, id), eq(teacherCredentialsTable.status, "submitted")))
    .returning({ id: teacherCredentialsTable.id });
  if (!withdrawn) { res.status(409).json({ error: "This document was opened while you were viewing it and can no longer be deleted." }); return; }
  await deleteUpload(row.fileKey);
  res.json({ deleted: true });
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

router.get("/teachers/:id/reviews", attachUserIfPresent, async (req, res): Promise<void> => {
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
  /**
   * Reviews go out without the reviewer.
   *
   * The owner's ask was narrower — "when a student reviews a teacher and the teacher sees it,
   * it should be shown as anonymous" — but hiding the name only from the teacher's own screen
   * would not be anonymity at all. This list is public: a teacher could read it signed out, or
   * from any student account, and see every name. Half-anonymity is worse than none, because
   * the student believes they are protected and they are not.
   *
   * So no name, and no student id either — an id can be matched against the teacher's own
   * enrolment list, which gets to the same place by a longer route.
   *
   * The name is still stored. It is needed to investigate an abusive review, and it is what
   * makes one-review-per-session enforceable. It simply never leaves the server.
   */
  const columns = {
    id: reviewsTable.id,
    rating: reviewsTable.rating,
    comment: reviewsTable.comment,
    createdAt: reviewsTable.createdAt,
    // Only ever compared, never returned: lets a student recognise their own review without
    // telling anybody else whose it is.
    studentId: reviewsTable.studentId,
  };
  const [rows, [{ total }]] = await Promise.all([
    db.select(columns).from(reviewsTable)
      .where(eq(reviewsTable.teacherId, profile.userId))
      .orderBy(desc(reviewsTable.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` })
      .from(reviewsTable)
      .where(eq(reviewsTable.teacherId, profile.userId)),
  ]);

  // This route is open to signed-out visitors, so there may be no reader to compare against.
  const readerId = req.user?.userId ?? null;
  const reviews = rows.map(({ studentId, ...review }) => ({
    ...review,
    /** True only for the person who wrote it, so they can see their own words back. */
    mine: readerId !== null && studentId === readerId,
  }));

  res.json({ reviews, total, page: pageNum, limit: limitNum });
});

export default router;
