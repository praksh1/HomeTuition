import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Notes who the caller is, if they said, and lets them through either way.
 *
 * For routes that are open to everybody but read slightly differently when they know you —
 * the public list of a teacher's reviews, where a student should be able to recognise their
 * own words without anybody else being told whose they are.
 *
 * Never rejects. A bad or expired token is treated exactly like no token at all, because on
 * these routes there is nothing to protect: the answer for a stranger is already the safe one.
 */
export function attachUserIfPresent(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      req.user = verifyToken(authHeader.slice(7));
    } catch {
      // Signed out is a valid way to read a public page.
    }
  }
  next();
}

/**
 * Refuses anybody who is not a support agent.
 *
 * Runs after `requireAuth`, and re-reads the role from the database rather than trusting the
 * token. A token is issued at sign-in and lives for a long time: an account demoted from admin
 * this morning would otherwise keep every admin power until its token expired, which is
 * exactly backwards for the one role that can suspend other people.
 *
 * There is deliberately no way to *become* an admin through the app. Registration accepts only
 * teacher and student; an agent account is made by the owner directly against the database.
 * A support tool that can create its own operators is one that only has to be breached once.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  try {
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ role: usersTable.role, suspendedAt: usersTable.suspendedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!row || row.role !== "admin" || row.suspendedAt !== null) {
      // Deliberately the same answer as any other unauthorised request. "You are not an admin"
      // confirms that an admin area exists and that this account is not in it.
      res.status(403).json({ error: "You do not have access to this." });
      return;
    }
    next();
  } catch {
    // A lookup that failed is not permission granted.
    res.status(503).json({ error: "Could not check your access. Please try again." });
  }
}
