import type { Request, Response, NextFunction } from "express";
import { identityEligible } from "../lib/identityEligibility";
/** Publication only; drafts and recovery/upload screens remain available. */
export async function requireTeachingIdentity(req: Request, res: Response, next: NextFunction) {
  if (!req.user) { res.status(401).json({ error: "Sign in to continue." }); return; }
  try {
    if (!await identityEligible(req.user.userId, "teacher")) {
      res.status(403).json({ code: "IDENTITY_REVIEW_REQUIRED", error: "Your private identity review must be approved before publishing. Your draft is saved; open Profile → Private verification." }); return;
    }
    next();
  } catch { res.status(503).json({ error: "Could not check private verification. Your draft has not been published. Please try again." }); }
}
