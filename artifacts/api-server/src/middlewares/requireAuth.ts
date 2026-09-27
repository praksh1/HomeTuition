import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "../lib/auth";
import { activeAccount } from "../lib/activeAccount";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  try {
    const current = await activeAccount(payload);
    if (!current) { res.status(403).json({ error: "This account cannot access Fadko. Please contact support.", code: "ACCOUNT_UNAVAILABLE" }); return; }
    req.user = current;
  } catch {
    res.status(503).json({ error: "Could not check your access. Please try again." });
    return;
  }
  next();
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
export async function attachUserIfPresent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      req.user = (await activeAccount(verifyToken(authHeader.slice(7)))) ?? undefined;
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
    if (process.env.OPERATOR_SITE_ENFORCEMENT_ENABLED === "true") {
      const { operatorByUserId } = await import("../lib/operatorStore");
      const operator = await operatorByUserId(userId);
      if (!operator || operator.disabledAt) {
        res.status(403).json({ error: "This operator account cannot access the desk." });
        return;
      }
      const bootstrapRoute = /^\/api\/operator\/(me|password)\/?$/.test(req.originalUrl.split("?")[0] ?? "");
      if (operator.mustChangePassword && !bootstrapRoute) {
        res.status(403).json({ error: "Change your one-time password before opening the desk.", code: "OPERATOR_PASSWORD_CHANGE_REQUIRED" });
        return;
      }
    }
    next();
  } catch {
    // A lookup that failed is not permission granted.
    res.status(503).json({ error: "Could not check your access. Please try again." });
  }
}
