import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { accountSecurityTable, db, externalIdentitiesTable, usersTable, teacherProfilesTable, studentProfilesTable, userOnboardingTable } from "@workspace/db";
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
  PASSWORD_RESEND_SECONDS,
} from "../lib/accountSecurity";
import { isEmailConfigured } from "../lib/mailer";
import { ageOn } from "../lib/onboardingRules";
import { flagContent } from "../lib/moderation";
import { socialProviderConfiguration, verifySocialCredential, type SocialProvider } from "../lib/socialIdentity";

const router: IRouter = Router();

router.get("/auth/providers", (_req, res): void => {
  // Client IDs are public OAuth identifiers. Provider secrets and Apple signing keys never
  // leave the server and are deliberately absent from this response.
  res.json(socialProviderConfiguration());
});

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

router.post("/auth/social", async (req, res): Promise<void> => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider as SocialProvider : null;
  const credential = typeof req.body?.credential === "string" ? req.body.credential.trim() : "";
  if (!provider || !["google", "facebook", "apple"].includes(provider) || !credential) {
    res.status(400).json({ error: "Choose a supported sign-in provider." });
    return;
  }
  try {
    const verified = await verifySocialCredential(provider, credential);
    if (!verified) { res.status(401).json({ error: "That provider could not verify this sign-in." }); return; }
    const [identity] = await db
      .select({ userId: externalIdentitiesTable.userId })
      .from(externalIdentitiesTable)
      .where(and(eq(externalIdentitiesTable.provider, provider), eq(externalIdentitiesTable.providerSubject, verified.subject)))
      .limit(1);
    if (!identity) {
      // Never attach a provider to an account merely because an email string matches. The
      // account owner must first sign in with their existing method and explicitly link it.
      res.status(409).json({
        error: "No Sikshya account is linked to this sign-in yet. Create your account first, then link this provider from Profile.",
        code: "SOCIAL_LINK_REQUIRED",
      });
      return;
    }
    const [user] = await db.select(AUTH_COLUMNS).from(usersTable).where(eq(usersTable.id, identity.userId));
    if (!user) { res.status(401).json({ error: "The linked Sikshya account no longer exists." }); return; }
    if (user.suspendedAt) { res.status(403).json({ error: "This account has been suspended." }); return; }
    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.json({ token, user: await buildUserProfile(user) });
  } catch (error) {
    req.log?.warn({ error, provider }, "social sign-in verification failed");
    res.status(401).json({ error: "That provider could not verify this sign-in." });
  }
});

router.post("/auth/social/link", requireAuth, async (req, res): Promise<void> => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider as SocialProvider : null;
  const credential = typeof req.body?.credential === "string" ? req.body.credential.trim() : "";
  if (!provider || !["google", "facebook", "apple"].includes(provider) || !credential) {
    res.status(400).json({ error: "Choose a supported sign-in provider." }); return;
  }
  try {
    const verified = await verifySocialCredential(provider, credential);
    if (!verified) { res.status(401).json({ error: "That provider could not verify this sign-in." }); return; }
    const [[taken], [current]] = await Promise.all([
      db.select({ userId: externalIdentitiesTable.userId }).from(externalIdentitiesTable)
        .where(and(eq(externalIdentitiesTable.provider, provider), eq(externalIdentitiesTable.providerSubject, verified.subject))).limit(1),
      db.select({ providerSubject: externalIdentitiesTable.providerSubject }).from(externalIdentitiesTable)
        .where(and(eq(externalIdentitiesTable.userId, req.user!.userId), eq(externalIdentitiesTable.provider, provider))).limit(1),
    ]);
    if (taken && taken.userId !== req.user!.userId) {
      res.status(409).json({ error: "That provider account is already linked to another Sikshya account." }); return;
    }
    if (current && current.providerSubject !== verified.subject) {
      res.status(409).json({ error: `This Sikshya account already has a different ${provider} sign-in linked.` }); return;
    }
    if (!taken) {
      await db.insert(externalIdentitiesTable).values({
        userId: req.user!.userId, provider, providerSubject: verified.subject, providerEmail: verified.email,
      });
      recordActivity({ userId: req.user!.userId, action: "auth.provider.linked", subjectType: "user", subjectId: req.user!.userId, detail: { provider } });
    }
    res.json({ linked: true, provider });
  } catch (error) {
    req.log?.warn({ error, provider }, "social provider link failed");
    res.status(401).json({ error: "That provider could not verify this sign-in." });
  }
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
    /*
      A constant, not a measurement.

      The server already refuses to issue a second token inside 60 seconds, and this only tells
      the screen how long to wait before offering Resend. It must stay constant: returning the
      *real* remaining cooldown would answer "does this address have an account?" for anybody
      who asked twice, which is exactly the disclosure the generic message above prevents.
    */
    resendAfterSeconds: PASSWORD_RESEND_SECONDS,
  });
});

router.post("/auth/password/reset", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!token) { res.status(400).json({ error: "The reset link is incomplete." }); return; }
  if (password.length < 8) { res.status(400).json({ error: "Use at least 8 characters for your new password." }); return; }
  /*
    The plaintext goes in, not a hash. `consumePasswordReset` has to compare the proposed password
    with the one already on the account, and that comparison must run through `verifyPassword`:
    scrypt salts every hash, so the same password hashes differently each time and comparing two
    hashes would silently never match.
  */
  const outcome = await consumePasswordReset(token, password);
  if (outcome === "same_password") {
    res.status(400).json({
      error: "Choose a password different from your current password.",
      code: "SAME_PASSWORD",
    });
    return;
  }
  if (outcome !== "ok") { res.status(400).json({ error: "This reset link is invalid or has expired." }); return; }
  /*
    Sessions elsewhere are NOT revoked, and this says so rather than implying otherwise.

    Auth here is a stateless JWT with no server-side session record and no version column to bump,
    so a token issued before the reset stays valid until it expires on its own. Revoking properly
    needs a session version on the user row and a check in the auth middleware. That is a schema
    change, so it is written up in HANDOVER section 8 rather than half-done here — and claiming
    "you have been signed out everywhere" without it would be the exact kind of untrue reassurance
    this packet exists to remove.
  */
  res.json({ changed: true, otherSessionsSignedOut: false });
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
