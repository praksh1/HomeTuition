import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { accountSecurityTable, db, usersTable, teacherProfilesTable, studentProfilesTable, userOnboardingTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { recordActivity } from "../lib/activityLog";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import {
  consumePasswordReset,
  consumeVerificationToken,
  emailVerifiedFor,
  externalProvidersFor,
  onboardingCompleteFor,
  requestPasswordReset,
  sendVerificationEmail,
} from "../lib/accountSecurity";
import { isEmailConfigured } from "../lib/mailer";
import { ageOn } from "../lib/onboardingRules";
import { flagContent } from "../lib/moderation";

const router: IRouter = Router();

/**
 * The columns sign-in needs — named rather than taken with a bare `select()`.
 *
 * A bare select asks for every column the schema declares, so the moment a new column is added
 * to the schema, **logging in fails until the database has been updated**. That was measured,
 * not guessed: with `notification_prefs` in the code and not yet in the database, login and
 * registration both returned 500. The API redeploys itself on every push while `db:push` is a
 * separate step someone has to run, so those two are never in step, and the gap must not be
 * able to take the whole app down.
 *
 * Add a column here only when sign-in actually needs it.
 */
const AUTH_COLUMNS = {
  id: usersTable.id,
  email: usersTable.email,
  name: usersTable.name,
  role: usersTable.role,
  passwordHash: usersTable.passwordHash,
  createdAt: usersTable.createdAt,
  /** Sign-in is where a suspension takes effect, so it has to be read here. */
  suspendedAt: usersTable.suspendedAt,
  suspendedReason: usersTable.suspendedReason,
} as const;

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const [user] = await db.select(AUTH_COLUMNS).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  /**
   * A suspended account cannot sign in, and is told so.
   *
   * Checked after the password rather than before, on purpose: refusing early would let anyone
   * discover which accounts are suspended by trying an email with a wrong password. And the
   * message says what happened and why, because somebody who does not know they have been
   * suspended will simply believe the app is broken and try again all evening.
   */
  if (user.suspendedAt) {
    recordActivity({
      userId: user.id,
      action: "auth.login.refused_suspended",
      subjectType: "user",
      subjectId: user.id,
    });
    res.status(403).json({
      error:
        "This account has been suspended." +
        (user.suspendedReason ? ` Reason: ${user.suspendedReason}` : "") +
        " Please contact support if you think this is a mistake.",
      suspended: true,
    });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  const profile = await buildUserProfile(user);
  res.json({ token, user: profile });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const { name, email, password, role, subject, grade, bio, dateOfBirth, guardianName, guardianEmail, guardianPhone, guardianRelationship } = req.body as {
    name?: string; email?: string; password?: string; role?: string;
    subject?: string; grade?: string; bio?: string; dateOfBirth?: string;
    guardianName?: string; guardianEmail?: string; guardianPhone?: string; guardianRelationship?: string;
  };
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "name, email, password, and role are required" });
    return;
  }
  if (!["teacher", "student"].includes(role)) {
    res.status(400).json({ error: "role must be teacher or student" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Use at least 8 characters for your password" });
    return;
  }
  if (role === "teacher" && (!subject?.trim() || !bio?.trim())) {
    res.status(400).json({ error: "Teachers must choose a subject and write a bio for students." });
    return;
  }
  if (role === "student") {
    const age = dateOfBirth ? ageOn(dateOfBirth) : null;
    if (age === null) {
      res.status(400).json({ error: "Students must enter a valid date of birth." });
      return;
    }
    if (age < 18 && (!guardianName?.trim() || !guardianEmail?.trim() || !guardianPhone?.trim() || !guardianRelationship?.trim())) {
      res.status(400).json({ error: "A parent or guardian must provide their name, email, phone, and relationship for a student under 18." });
      return;
    }
  }
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await db.transaction(async (tx) => {
    const [created] = await tx.insert(usersTable).values({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role,
      passwordHash,
      // Same reason as AUTH_COLUMNS: a bare `returning()` asks for every column, so registration
      // would break on a schema change the database has not caught up with yet.
    }).returning(AUTH_COLUMNS);
    if (!created) throw new Error("User insert returned no row");

    await tx.insert(accountSecurityTable).values({
      userId: created.id,
      emailVerifiedAt: null,
      passwordAuthEnabled: true,
    });
    if (role === "teacher") {
      await tx.insert(teacherProfilesTable).values({
        userId: created.id,
        subject: subject ?? "Mathematics",
        subjects: [],
        bio: bio ?? "",
        approvalStatus: "pending",
        languages: ["Nepali"],
        isOnline: false,
        subscriptionActive: false,
        sessionsThisMonth: 0,
        totalStudents: 0,
        monthlyEarnings: 0,
        rating: 0,
        reviewCount: 0,
      });
    } else {
      await tx.insert(studentProfilesTable).values({
        userId: created.id,
        grade: grade ?? "",
        bio: bio ?? "",
      });
    }
    await tx.insert(userOnboardingTable).values({
      userId: created.id,
      dateOfBirth: role === "student" ? dateOfBirth : null,
      guardianName: role === "student" ? guardianName?.trim() || null : null,
      guardianEmail: role === "student" ? guardianEmail?.trim().toLocaleLowerCase() || null : null,
      guardianPhone: role === "student" ? guardianPhone?.trim() || null : null,
      guardianRelationship: role === "student" ? guardianRelationship?.trim() || null : null,
    });
    return created;
  });
  if (role === "teacher") await flagContent({ userId: user.id, surface: "teacher_bio", text: bio ?? "" });
  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  const profile = await buildUserProfile(user);
  const delivery = await sendVerificationEmail(user);
  res.status(201).json({
    token,
    user: profile,
    verificationRequired: true,
    verificationEmailSent: delivery.sent,
    emailConfigured: isEmailConfigured(),
  });
});

router.post("/auth/verification/resend", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select(AUTH_COLUMNS).from(usersTable).where(eq(usersTable.id, req.user!.userId));
  if (!user) { res.status(404).json({ error: "Account not found" }); return; }
  if (await emailVerifiedFor(user.id)) {
    res.json({ verified: true, sent: false });
    return;
  }
  const delivery = await sendVerificationEmail(user);
  res.status(delivery.rateLimited ? 429 : delivery.sent ? 200 : 503).json({
    verified: false,
    sent: delivery.sent,
    error: delivery.rateLimited
      ? "Please wait a minute before asking for another email."
      : delivery.sent
        ? undefined
        : "Email delivery is not configured yet. Please contact Sikshya support.",
  });
});

router.post("/auth/verification/confirm", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) { res.status(400).json({ error: "The verification link is incomplete." }); return; }
  const userId = await consumeVerificationToken(token);
  if (userId === null) {
    res.status(400).json({ error: "This verification link is invalid or has expired." });
    return;
  }
  recordActivity({ userId, action: "auth.email.verified", subjectType: "user", subjectId: userId });
  res.json({ verified: true });
});

router.post("/auth/password/forgot", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!email) { res.status(400).json({ error: "Enter your email address." }); return; }
  // The same answer whether the address exists or not prevents account discovery.
  await requestPasswordReset(email);
  res.json({
    accepted: true,
    message: "If that email belongs to a password account, a reset link is on its way.",
    emailConfigured: isEmailConfigured(),
  });
});

router.post("/auth/password/reset", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!token) { res.status(400).json({ error: "The reset link is incomplete." }); return; }
  if (password.length < 8) { res.status(400).json({ error: "Use at least 8 characters for your new password." }); return; }
  const changed = await consumePasswordReset(token, await hashPassword(password));
  if (!changed) { res.status(400).json({ error: "This reset link is invalid or has expired." }); return; }
  res.json({ changed: true });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [user] = await db.select(AUTH_COLUMNS).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  const profile = await buildUserProfile(user);
  res.json(profile);
});

async function buildUserProfile(user: { id: number; email: string; name: string; role: string }) {
  const [emailVerified, authProviders, onboardingComplete] = await Promise.all([
    emailVerifiedFor(user.id),
    externalProvidersFor(user.id),
    onboardingCompleteFor(user.id),
  ]);
  if (user.role === "teacher") {
    const [teacher] = await db
      .select()
      .from(teacherProfilesTable)
      .where(eq(teacherProfilesTable.userId, user.id));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified,
      authProviders,
      onboardingComplete,
      teacher: teacher ? { ...teacher, name: user.name, email: user.email } : null,
    };
  } else {
    const [student] = await db
      .select()
      .from(studentProfilesTable)
      .where(eq(studentProfilesTable.userId, user.id));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified,
      authProviders,
      onboardingComplete,
      student: student ?? null,
    };
  }
}

export default router;
