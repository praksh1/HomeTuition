import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, usersTable, teacherProfilesTable, studentProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { recordActivity } from "../lib/activityLog";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";

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
  const { name, email, password, role, subject, grade, bio } = req.body as {
    name?: string; email?: string; password?: string; role?: string;
    subject?: string; grade?: string; bio?: string;
  };
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "name, email, password, and role are required" });
    return;
  }
  if (!["teacher", "student"].includes(role)) {
    res.status(400).json({ error: "role must be teacher or student" });
    return;
  }
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    role,
    passwordHash,
    // Same reason as AUTH_COLUMNS: a bare `returning()` asks for every column, so registration
    // would break on a schema change the database has not caught up with yet.
  }).returning(AUTH_COLUMNS);
  if (role === "teacher") {
    await db.insert(teacherProfilesTable).values({
      userId: user.id,
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
    await db.insert(studentProfilesTable).values({
      userId: user.id,
      grade: grade ?? "",
      bio: bio ?? "",
    });
  }
  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  const profile = await buildUserProfile(user);
  res.status(201).json({ token, user: profile });
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
      student: student ?? null,
    };
  }
}

export default router;
