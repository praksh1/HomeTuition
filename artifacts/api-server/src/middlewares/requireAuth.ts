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
